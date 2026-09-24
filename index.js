// ============================================================
// MISOBOT - Discord + Cloudflare R2
// ============================================================

import "dotenv/config";

import {
    Client,
    GatewayIntentBits,
    Events
} from "discord.js";

import {
    joinVoiceChannel,
    VoiceConnectionStatus,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    demuxProbe
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

const servidores = new Map();

// ============================================================
// 6. OBTENER / CREAR ESTADO DEL SERVIDOR
// ============================================================

function obtenerEstadoServidor(guildId) {

    if (!servidores.has(guildId)) {

        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play
            }
        });

        const estado = {
            connection: null,
            player: player,
            ffmpeg: null,
            archivoActual: null
        };

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
            console.error(`[${guildId}] ❌ ERROR DEL REPRODUCTOR:`, error);
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

    return respuesta.Body;
}

// ============================================================
// 8. CONVERTIR AUDIO CON FFMPEG
// ============================================================

function crearStreamAudio(streamR2, nombreArchivo) {

    console.log(`🎛️ Iniciando FFmpeg para: ${nombreArchivo}`);

    const ffmpeg = spawn(ffmpegPath, [
        "-i", "pipe:0",
        "-f", "s16le",
        "-ar", "48000",
        "-ac", "2",
        "pipe:1"
    ], {
        stdio: ["pipe", "pipe", "pipe"]
    });

    ffmpeg.stderr.on("data", (data) => {
        const texto = data.toString().trim();
        if (texto.includes("time=")) {
            // Silenciamos logs repetitivos para reducir carga de CPU en Render
        }
    });

    ffmpeg.on("error", (error) => {
        console.error("❌ No se pudo iniciar FFmpeg:", error);
    });

    ffmpeg.on("close", (code, signal) => {
        console.log(`🎛️ FFmpeg finalizado. Código: ${code}, señal: ${signal}`);
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

client.once(Events.ClientReady, () => {
    console.log("==========================================");
    console.log("🎵 MISOBOT ESTÁ CONECTADO");
    console.log(`🤖 Usuario: ${client.user.tag}`);
    console.log("==========================================");
});

// ============================================================
// 10. COMANDOS
// ============================================================

client.on(Events.MessageCreate, async (message) => {

    try {
        if (message.author.bot) return;
        if (!message.content.startsWith("!play")) return;

        const partes = message.content.trim().split(/\s+/);
        const nombreCancion = partes.slice(1).join(" ");

        if (!nombreCancion) {
            await message.reply("❌ Escribe el nombre del archivo. Ejemplo:\n`!play cancion.mp3`");
            return;
        }

        const canalVoz = message.member?.voice?.channel;

        if (!canalVoz) {
            await message.reply("❌ Primero tienes que entrar en un canal de voz.");
            return;
        }

        console.log("==========================================");
        console.log(`🎵 Nueva reproducción solicitada: ${nombreCancion}`);
        console.log(`🏠 Servidor: ${message.guild.name} | 🔊 Canal: ${canalVoz.name}`);
        console.log("==========================================");

        await message.reply(`⏳ Preparando **${nombreCancion}**...`);

        const estado = obtenerEstadoServidor(message.guild.id);

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

            estado.connection.on(VoiceConnectionStatus.Ready, () => {
                console.log("✅ Conexión de voz: READY");
            });

            estado.connection.on(VoiceConnectionStatus.Disconnected, () => {
                console.log("⚠️ Conexión de voz: DISCONNECTED");
            });

            estado.connection.on("error", (err) => {
                console.error("❌ ERROR EN LA CONEXIÓN DE VOZ:", err);
            });
        }

        estado.connection.subscribe(estado.player);

        if (estado.ffmpeg) {
            console.log("🛑 Deteniendo FFmpeg anterior...");
            try { estado.ffmpeg.kill("SIGKILL"); } catch {}
            estado.ffmpeg = null;
        }

        const streamR2 = await obtenerArchivoR2(nombreCancion);
        const audio = crearStreamAudio(streamR2, nombreCancion);

        estado.ffmpeg = audio.process;
        estado.archivoActual = nombreCancion;

        console.log("🎧 Inspeccionando y creando recurso de audio de forma segura...");

        // Analiza el flujo dinámicamente para ajustar los búferes y evitar el error TimeoutNegativeWarning
        const { stream, type } = await demuxProbe(audio.stream);

        const recursoAudio = createAudioResource(stream, {
            inputType: type
        });

        estado.player.play(recursoAudio);
        console.log("▶️ Comando PLAY enviado al reproductor.");

        await message.channel.send(`▶️ Reproduciendo: **${nombreCancion}**`);

    } catch (error) {
        console.error("==========================================");
        console.error("❌ ERROR GENERAL EN !play", error);
        console.error("==========================================");

        try {
            await message.channel.send("❌ Error al procesar el audio de R2.");
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
