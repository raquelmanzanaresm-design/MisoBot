// ============================================================
// MISOBOT - Discord + Cloudflare R2
// ============================================================

import "dotenv/config";

import {
    Client,
    GatewayIntentBits
} from "discord.js";

import {
    joinVoiceChannel,
    entersState,
    VoiceConnectionStatus,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    StreamType
} from "@discordjs/voice";

import {
    S3Client,
    GetObjectCommand
} from "@aws-sdk/client-s3";

import ffmpegPath from "ffmpeg-static";
import { spawn } from "child_process";
import http from "http";

// ============================================================
// 1. SERVIDOR HTTP PARA RENDER
// ============================================================

const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8"
    });

    res.end("MisoBot está vivo y funcionando.\n");
}).listen(PORT, () => {
    console.log(`🌐 Servidor HTTP escuchando en el puerto ${PORT}`);
});

// ============================================================
// 2. COMPROBACIÓN DE VARIABLES DE ENTORNO
// ============================================================

const variablesNecesarias = [
    "DISCORD_TOKEN",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_ENDPOINT"
];

for (const variable of variablesNecesarias) {
    if (!process.env[variable]) {
        console.error(`❌ Falta la variable de entorno: ${variable}`);
        process.exit(1);
    }
}

console.log("✅ Variables de entorno cargadas correctamente.");

if (!ffmpegPath) {
    console.error("❌ No se ha encontrado FFmpeg.");
    process.exit(1);
}

console.log(`✅ FFmpeg encontrado: ${ffmpegPath}`);

// ============================================================
// 3. CLIENTE CLOUDFLARE R2
// ============================================================

const r2Client = new S3Client({
    region: "auto",

    endpoint: process.env.R2_ENDPOINT,

    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
});

console.log("✅ Cliente de Cloudflare R2 preparado.");

// ============================================================
// 4. CLIENTE DISCORD
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ============================================================
// 5. ESTADO DEL BOT
// ============================================================

// Guardamos una conexión y un reproductor por servidor.
// Esto evita crear conexiones nuevas cada vez que usamos !play.

const servidores = new Map();

// ============================================================
// 6. OBTENER / CREAR ESTADO DEL SERVIDOR
// ============================================================

function obtenerEstadoServidor(guildId) {

    if (!servidores.has(guildId)) {

        const player = createAudioPlayer();

        const estado = {
            connection: null,
            player: player,
            ffmpeg: null,
            archivoActual: null
        };

        // ----------------------------------------------------
        // EVENTOS DEL REPRODUCTOR
        // ----------------------------------------------------

        player.on(AudioPlayerStatus.Idle, () => {
            console.log(`[${guildId}] 🎵 Reproductor: IDLE`);
        });

        player.on(AudioPlayerStatus.Buffering, () => {
            console.log(`[${guildId}] ⏳ Reproductor: BUFFERING`);
        });

        player.on(AudioPlayerStatus.Playing, () => {
            console.log(`[${guildId}] ▶️ Reproductor: PLAYING`);
        });

        player.on(AudioPlayerStatus.Paused, () => {
            console.log(`[${guildId}] ⏸️ Reproductor: PAUSED`);
        });

        player.on(AudioPlayerStatus.AutoPaused, () => {
            console.log(`[${guildId}] ⚠️ Reproductor: AUTOPAUSED`);
        });

        player.on("error", (error) => {
            console.error(
                `[${guildId}] ❌ ERROR DEL REPRODUCTOR:`,
                error
            );
        });

        servidores.set(guildId, estado);
    }

    return servidores.get(guildId);
}

// ============================================================
// 7. OBTENER ARCHIVO DESDE R2
// ============================================================

async function obtenerArchivoR2(nombreArchivo) {

    console.log(`☁️ Solicitando a R2: ${nombreArchivo}`);

    const comando = new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: nombreArchivo
    });

    const respuesta = await r2Client.send(comando);

    console.log(`✅ R2 ha respondido para: ${nombreArchivo}`);

    if (!respuesta.Body) {
        throw new Error("R2 no ha devuelto ningún contenido.");
    }

    console.log(
        `📦 Content-Type de R2: ${respuesta.ContentType || "desconocido"}`
    );

    console.log(
        `📦 Tamaño del archivo: ${respuesta.ContentLength || "desconocido"} bytes`
    );

    return respuesta.Body;
}

// ============================================================
// 8. CONVERTIR AUDIO CON FFMPEG
// ============================================================

function crearStreamAudio(streamR2, nombreArchivo) {

    console.log(`🎛️ Iniciando FFmpeg para: ${nombreArchivo}`);

    const ffmpeg = spawn(ffmpegPath, [
        "-hide_banner",
        "-loglevel", "warning",

        // Entrada
        "-i", "pipe:0",

        // Salida PCM compatible con Discord
        "-f", "s16le",
        "-ar", "48000",
        "-ac", "2",

        "pipe:1"
    ], {
        stdio: [
            "pipe",
            "pipe",
            "pipe"
        ]
    });

    // --------------------------------------------------------
    // ERRORES / INFORMACIÓN DE FFMPEG
    // --------------------------------------------------------

    ffmpeg.stderr.on("data", (data) => {
        const texto = data.toString().trim();

        if (texto) {
            console.log(`🎛️ FFmpeg: ${texto}`);
        }
    });

    ffmpeg.on("error", (error) => {
        console.error("❌ No se pudo iniciar FFmpeg:", error);
    });

    ffmpeg.on("close", (code, signal) => {
        console.log(
            `🎛️ FFmpeg finalizado. Código: ${code}, señal: ${signal}`
        );
    });

    // --------------------------------------------------------
    // ENVIAMOS EL ARCHIVO DE R2 A FFMPEG
    // --------------------------------------------------------

    streamR2.on("error", (error) => {
        console.error("❌ Error leyendo el archivo desde R2:", error);

        try {
            ffmpeg.stdin.destroy(error);
        } catch {}
    });

    streamR2.pipe(ffmpeg.stdin);

    return {
        stream: ffmpeg.stdout,
        process: ffmpeg
    };
}

// ============================================================
// 9. EVENTO READY
// ============================================================

client.once("ready", () => {

    console.log("==========================================");
    console.log("🎵 MISOBOT ESTÁ CONECTADO");
    console.log(`🤖 Usuario: ${client.user.tag}`);
    console.log("==========================================");
});

// ============================================================
// 10. COMANDOS
// ============================================================

client.on("messageCreate", async (message) => {

    try {

        // Ignorar mensajes de otros bots
        if (message.author.bot) return;

        // Solo nos interesa !play
        if (!message.content.startsWith("!play")) return;

        // ----------------------------------------------------
        // OBTENER NOMBRE DEL ARCHIVO
        // ----------------------------------------------------

        const partes = message.content.trim().split(/\s+/);

        const nombreCancion = partes.slice(1).join(" ");

        if (!nombreCancion) {

            await message.reply(
                "❌ Escribe el nombre del archivo. Ejemplo:\n" +
                "`!play cancion.mp3`"
            );

            return;
        }

        // ----------------------------------------------------
        // COMPROBAR CANAL DE VOZ
        // ----------------------------------------------------

        const canalVoz = message.member?.voice?.channel;

        if (!canalVoz) {

            await message.reply(
                "❌ Primero tienes que entrar en un canal de voz."
            );

            return;
        }

        console.log("==========================================");
        console.log(`🎵 Nueva reproducción solicitada`);
        console.log(`📁 Archivo: ${nombreCancion}`);
        console.log(`🏠 Servidor: ${message.guild.name}`);
        console.log(`🔊 Canal: ${canalVoz.name}`);
        console.log("==========================================");

        await message.reply(
            `⏳ Preparando **${nombreCancion}**...`
        );

        // ----------------------------------------------------
        // OBTENER ESTADO DEL SERVIDOR
        // ----------------------------------------------------

        const estado = obtenerEstadoServidor(message.guild.id);

        // ----------------------------------------------------
        // CONECTAR A VOZ
        // ----------------------------------------------------

        if (
            !estado.connection ||
            estado.connection.state.status === VoiceConnectionStatus.Destroyed
        ) {

            console.log("🔊 Creando conexión de voz...");

            estado.connection = joinVoiceChannel({
                channelId: canalVoz.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,

                selfDeaf: false,
                selfMute: false
            });

            estado.connection.on(
                VoiceConnectionStatus.Ready,
                () => {
                    console.log("✅ Conexión de voz: READY");
                }
            );

            estado.connection.on(
                VoiceConnectionStatus.Disconnected,
                () => {
                    console.log("⚠️ Conexión de voz: DISCONNECTED");
                }
            );

            estado.connection.on(
                VoiceConnectionStatus.Destroyed,
                () => {
                    console.log("🛑 Conexión de voz: DESTROYED");
                }
            );

            estado.connection.on("error", (error) => {
                console.error(
                    "❌ ERROR EN LA CONEXIÓN DE VOZ:",
                    error
                );
            });
        }

        // ----------------------------------------------------
        // ESPERAR A QUE DISCORD ESTÉ REALMENTE CONECTADO
        // ----------------------------------------------------

        console.log("⏳ Esperando conexión de voz...");

        try {

            await entersState(
                estado.connection,
                VoiceConnectionStatus.Ready,
                15000
            );

            console.log("✅ Discord está listo para recibir audio.");

        } catch (error) {

            console.error(
                "❌ Discord no consiguió establecer la conexión de voz:",
                error
            );

            await message.channel.send(
                "❌ No he podido establecer correctamente la conexión de voz."
            );

            return;
        }

        // ----------------------------------------------------
        // PARAR FFMPEG ANTERIOR SI EXISTE
        // ----------------------------------------------------

        if (estado.ffmpeg) {

            console.log("🛑 Deteniendo FFmpeg anterior...");

            try {
                estado.ffmpeg.kill("SIGKILL");
            } catch {}

            estado.ffmpeg = null;
        }

        // ----------------------------------------------------
        // OBTENER ARCHIVO DESDE R2
        // ----------------------------------------------------

        const streamR2 = await obtenerArchivoR2(nombreCancion);

        // ----------------------------------------------------
        // PASAR R2 A FFMPEG
        // ----------------------------------------------------

        const audio = crearStreamAudio(
            streamR2,
            nombreCancion
        );

        estado.ffmpeg = audio.process;
        estado.archivoActual = nombreCancion;

        // ----------------------------------------------------
        // CREAR RECURSO DE DISCORD
        // ----------------------------------------------------

        console.log("🎧 Creando recurso de audio...");

        const recursoAudio = createAudioResource(
            audio.stream,
            {
                inputType: StreamType.Raw,

                metadata: {
                    nombre: nombreCancion
                }
            }
        );

        // ----------------------------------------------------
        // SUSCRIBIR REPRODUCTOR A DISCORD
        // ----------------------------------------------------

        estado.connection.subscribe(estado.player);

        console.log("🔗 Reproductor conectado a Discord.");

        // ----------------------------------------------------
        // REPRODUCIR
        // ----------------------------------------------------

        estado.player.play(recursoAudio);

        console.log("▶️ Comando PLAY enviado al reproductor.");

        await message.channel.send(
            `▶️ Reproduciendo: **${nombreCancion}**`
        );

    } catch (error) {

        console.error("==========================================");
        console.error("❌ ERROR GENERAL EN !play");
        console.error(error);
        console.error("==========================================");

        try {

            await message.channel.send(
                "❌ Ha ocurrido un error al intentar reproducir el archivo. " +
                "Mira los logs de Render para ver dónde se ha producido."
            );

        } catch {}
    }
});

// ============================================================
// 11. LOGIN
// ============================================================

client.login(process.env.DISCORD_TOKEN)
    .then(() => {
        console.log("🔐 Login de Discord iniciado...");
    })
    .catch((error) => {
        console.error("❌ Error iniciando sesión en Discord:", error);
    });
