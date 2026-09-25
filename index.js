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
    StreamType,
    entersState
} from "@discordjs/voice";

import {
    S3Client,
    GetObjectCommand
} from "@aws-sdk/client-s3";

import ffmpegPath from "ffmpeg-static";
import prism from "prism-media";
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
            ffmpegStream: null,
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
// 7. OBTENER STREAM DESDE R2
// ============================================================

async function obtenerArchivoR2Stream(nombreArchivo) {

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
// 8. EVENTO READY
// ============================================================

client.once(Events.ClientReady, () => {
    console.log("==========================================");
    console.log("🎵 MISOBOT ESTÁ CONECTADO");
    console.log(`🤖 Usuario: ${client.user.tag}`);
    console.log("==========================================");
});

// ============================================================
// 9. COMANDOS
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

            // Manejo de reconexiones automáticas si Discord cambia de servidor de voz
            estado.connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    await Promise.race([
                        entersState(estado.connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(estado.connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                } catch (error) {
                    try { estado.connection.destroy(); } catch {}
                    estado.connection = null;
                }
            });

            estado.connection.on("error", (err) => {
                console.error("❌ ERROR EN LA CONEXIÓN DE VOZ:", err);
            });
        }

        // Vincular el reproductor a la conexión
        estado.connection.subscribe(estado.player);

        if (estado.ffmpegStream) {
            console.log("🛑 Deteniendo stream anterior...");
            try { estado.ffmpegStream.destroy(); } catch {}
            estado.ffmpegStream = null;
        }

        const r2Stream = await obtenerArchivoR2Stream(nombreCancion);

        const ffmpegStream = new prism.FFmpeg({
            args: [
                "-i", "pipe:0",
                "-acodec", "libopus",
                "-f", "opus",
                "-ar", "48000",
                "-ac", "2"
            ]
        });

        ffmpegStream.on("error", (err) => {
            console.error("❌ Error en FFmpeg Stream:", err);
        });

        estado.ffmpegStream = ffmpegStream;
        estado.archivoActual = nombreCancion;

        const audioPipe = r2Stream.pipe(ffmpegStream);

        console.log("🎧 Creando recurso de audio en formato OggOpus...");

        const recursoAudio = createAudioResource(audioPipe, {
            inputType: StreamType.OggOpus
        });

        estado.player.play(recursoAudio);
        console.log("▶️ Comando PLAY enviado al reproductor.");

        await message.channel.send(`▶️ Reproduciendo: **${nombreCancion}**`);

    } catch (error) {
        console.error("==========================================");
        console.error("❌ ERROR GENERAL EN !play", error);
        console.error("==========================================");

        try {
            await message.channel.send("❌ Error al procesar el archivo de R2.");
        } catch {}
    }
});

// ============================================================
// 10. LOGIN
// ============================================================

client.login(process.env.DISCORD_TOKEN)
    .then(() => {
        console.log("🔐 Login de Discord iniciado...");
    })
    .catch((error) => {
        console.error("❌ Error iniciando sesión en Discord:", error);
    });
