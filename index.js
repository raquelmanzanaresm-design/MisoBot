// ============================================================
// MISOBOT 2.0
// Discord + Cloudflare R2
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
// 2. VARIABLES DE ENTORNO
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

        console.error(
            `❌ Falta la variable de entorno: ${variable}`
        );

        process.exit(1);
    }
}

console.log("✅ Variables de entorno cargadas.");


// ============================================================
// 3. FFmpeg
// ============================================================

if (!ffmpegPath) {

    console.error("❌ FFmpeg no está disponible.");

    process.exit(1);
}

console.log(`✅ FFmpeg: ${ffmpegPath}`);


// ============================================================
// 4. CLOUDFLARE R2
// ============================================================

const r2Client = new S3Client({

    region: "auto",

    endpoint: process.env.R2_ENDPOINT,

    credentials: {

        accessKeyId:
            process.env.R2_ACCESS_KEY_ID,

        secretAccessKey:
            process.env.R2_SECRET_ACCESS_KEY
    }
});

console.log("✅ Cliente R2 preparado.");


// ============================================================
// 5. CLIENTE DISCORD
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
// 6. ESTADO DE LOS SERVIDORES
// ============================================================

const servidores = new Map();


// ============================================================
// 7. CREAR ESTADO DEL SERVIDOR
// ============================================================

function obtenerEstadoServidor(guildId) {

    if (!servidores.has(guildId)) {

        const player = createAudioPlayer({

            behaviors: {

                noSubscriber:
                    NoSubscriberBehavior.Play
            }
        });


        const estado = {

            connection: null,

            player,

            ffmpeg: null,

            archivoActual: null
        };


        // ----------------------------------------------------
        // ESTADOS DEL REPRODUCTOR
        // ----------------------------------------------------

        player.on(
            AudioPlayerStatus.Idle,
            () => {

                console.log(
                    `[${guildId}] 🎵 PLAYER: IDLE`
                );
            }
        );


        player.on(
            AudioPlayerStatus.Buffering,
            () => {

                console.log(
                    `[${guildId}] ⏳ PLAYER: BUFFERING`
                );
            }
        );


        player.on(
            AudioPlayerStatus.Playing,
            () => {

                console.log(
                    `[${guildId}] 🟢 PLAYER: PLAYING`
                );
            }
        );


        player.on(
            AudioPlayerStatus.Paused,
            () => {

                console.log(
                    `[${guildId}] ⏸️ PLAYER: PAUSED`
                );
            }
        );


        player.on(
            "error",
            (error) => {

                console.error(
                    `[${guildId}] ❌ ERROR PLAYER:`,
                    error
                );
            }
        );


        servidores.set(
            guildId,
            estado
        );
    }

    return servidores.get(guildId);
}


// ============================================================
// 8. OBTENER ARCHIVO DE R2
// ============================================================

async function obtenerArchivoR2(nombreArchivo) {

    console.log(
        `☁️ Descargando desde R2: ${nombreArchivo}`
    );


    const comando =
        new GetObjectCommand({

            Bucket:
                process.env.R2_BUCKET_NAME,

            Key:
                nombreArchivo
        });


    const respuesta =
        await r2Client.send(comando);


    if (!respuesta.Body) {

        throw new Error(
            "R2 no ha devuelto ningún contenido."
        );
    }


    console.log(
        `✅ R2 ha entregado: ${nombreArchivo}`
    );


    return respuesta.Body;
}


// ============================================================
// 9. CREAR FFmpeg
// ============================================================

function crearFFmpeg(r2Stream) {

    console.log("🎧 Iniciando FFmpeg...");


    const ffmpeg = spawn(

        ffmpegPath,

        [

            "-hide_banner",

            "-loglevel",
            "warning",

            "-i",
            "pipe:0",

            // PCM firmado 16-bit little endian
            "-f",
            "s16le",

            // 48 kHz
            "-ar",
            "48000",

            // estéreo
            "-ac",
            "2",

            "pipe:1"
        ],

        {

            stdio: [
                "pipe",
                "pipe",
                "pipe"
            ]
        }
    );


    // --------------------------------------------------------
    // R2 → FFmpeg
    // --------------------------------------------------------

    r2Stream.pipe(
        ffmpeg.stdin
    );


    // --------------------------------------------------------
    // ERRORES FFmpeg
    // --------------------------------------------------------

    ffmpeg.on(
        "error",
        (error) => {

            console.error(
                "❌ FFmpeg error:",
                error
            );
        }
    );


    ffmpeg.stderr.on(
        "data",
        (data) => {

            const texto =
                data.toString().trim();

            if (texto) {

                console.log(
                    `FFmpeg: ${texto}`
                );
            }
        }
    );


    ffmpeg.on(
        "close",
        (code) => {

            console.log(
                `🛑 FFmpeg finalizado. Código: ${code}`
            );
        }
    );


    return ffmpeg;
}


// ============================================================
// 10. DISCORD READY
// ============================================================

client.once(
    Events.ClientReady,
    () => {

        console.log(
            "=========================================="
        );

        console.log(
            "🎵 MISOBOT ESTÁ CONECTADO"
        );

        console.log(
            `🤖 Usuario: ${client.user.tag}`
        );

        console.log(
            "=========================================="
        );
    }
);


// ============================================================
// 11. COMANDO !PLAY
// ============================================================

client.on(
    Events.MessageCreate,
    async (message) => {

        try {

            // ------------------------------------------------
            // Ignorar bots
            // ------------------------------------------------

            if (message.author.bot) {
                return;
            }


            // ------------------------------------------------
            // Solo !play
            // ------------------------------------------------

            if (
                !message.content
                    .toLowerCase()
                    .startsWith("!play")
            ) {
                return;
            }


            // ------------------------------------------------
            // Nombre del archivo
            // ------------------------------------------------

            const partes =
                message.content
                    .trim()
                    .split(/\s+/);


            const nombreCancion =
                partes
                    .slice(1)
                    .join(" ");


            if (!nombreCancion) {

                await message.reply(
                    "❌ Escribe el nombre del archivo.\n\n" +
                    "Ejemplo:\n" +
                    "`!play cancion.mp3`"
                );

                return;
            }


            // ------------------------------------------------
            // Canal de voz
            // ------------------------------------------------

            const canalVoz =
                message.member?.voice?.channel;


            if (!canalVoz) {

                await message.reply(
                    "❌ Primero tienes que entrar en un canal de voz."
                );

                return;
            }


            console.log(
                "=========================================="
            );

            console.log(
                `🎵 PLAY: ${nombreCancion}`
            );

            console.log(
                `🔊 Canal: ${canalVoz.name}`
            );

            console.log(
                "=========================================="
            );


            // ------------------------------------------------
            // Estado
            // ------------------------------------------------

            const estado =
                obtenerEstadoServidor(
                    message.guild.id
                );


            // =================================================
            // CONEXIÓN DE VOZ
            // =================================================

            if (
                !estado.connection ||
                estado.connection.state.status ===
                    VoiceConnectionStatus.Destroyed
            ) {

                console.log(
                    "🔊 Creando conexión de voz..."
                );


                estado.connection =
                    joinVoiceChannel({

                        channelId:
                            canalVoz.id,

                        guildId:
                            message.guild.id,

                        adapterCreator:
                            message.guild.voiceAdapterCreator,

                        selfDeaf: false,

                        selfMute: false,

                        // DAVE es necesario para Discord actual
                        daveEncryption: true,

                        debug: true
                    });


                // ------------------------------------------------
                // DEBUG DE VOZ
                // ------------------------------------------------

                estado.connection.on(
                    "debug",
                    (mensaje) => {

                        console.log(
                            `🔎 VOICE DEBUG: ${mensaje}`
                        );
                    }
                );


                estado.connection.on(
                    "error",
                    (error) => {

                        console.error(
                            "❌ VOICE ERROR:",
                            error
                        );
                    }
                );


                estado.connection.on(
                    "stateChange",
                    (
                        oldState,
                        newState
                    ) => {

                        console.log(
                            "🔄 VOICE STATE:",
                            oldState.status,
                            "→",
                            newState.status
                        );
                    }
                );


                // ------------------------------------------------
                // Esperar conexión
                // ------------------------------------------------

                console.log(
                    "⏳ Esperando conexión de voz..."
                );


                try {

                    await entersState(
                        estado.connection,
                        VoiceConnectionStatus.Ready,
                        30000
                    );


                    console.log(
                        "🟢 CONEXIÓN DE VOZ READY"
                    );

                } catch (error) {

                    console.error(
                        "❌ No se pudo establecer la conexión de voz:"
                    );

                    console.error(error);


                    console.error(
                        "Estado actual:",
                        estado.connection.state.status
                    );


                    throw error;
                }
            }


            // =================================================
            // SUSCRIBIR PLAYER
            // =================================================

            console.log(
                "🔗 Conectando AudioPlayer a Discord..."
            );


            estado.connection.subscribe(
                estado.player
            );


            // =================================================
            // DETENER FFmpeg ANTERIOR
            // =================================================

            if (estado.ffmpeg) {

                console.log(
                    "🛑 Deteniendo reproducción anterior..."
                );


                try {

                    estado.ffmpeg.kill(
                        "SIGKILL"
                    );

                } catch {}
            }


            estado.ffmpeg = null;


            // =================================================
            // OBTENER R2
            // =================================================

            const r2Stream =
                await obtenerArchivoR2(
                    nombreCancion
                );


            // =================================================
            // FFmpeg
            // =================================================

            const ffmpeg =
                crearFFmpeg(
                    r2Stream
                );


            estado.ffmpeg =
                ffmpeg;


            estado.archivoActual =
                nombreCancion;


            // =================================================
            // CREAR AUDIO RESOURCE
            // =================================================

            console.log(
                "🎧 Creando recurso PCM..."
            );


            const recurso =
                createAudioResource(
                    ffmpeg.stdout,
                    {
                        inputType:
                            StreamType.Raw,

                        inlineVolume: false
                    }
                );


            // =================================================
            // REPRODUCIR
            // =================================================

            console.log(
                "▶️ Enviando audio al reproductor..."
            );


            estado.player.play(
                recurso
            );


            await message.channel.send(
                `🟢 Reproduciendo: **${nombreCancion}**`
            );


            console.log(
                "✅ PLAY enviado correctamente."
            );

        } catch (error) {

            console.error(
                "=========================================="
            );

            console.error(
                "❌ ERROR GENERAL EN !PLAY"
            );

            console.error(error);

            console.error(
                "=========================================="
            );


            try {

                await message.channel.send(
                    "❌ Ha ocurrido un error al iniciar la reproducción. " +
                    "Mira los Logs de Render para ver el motivo."
                );

            } catch {}
        }
    }
);


// ============================================================
// 12. LOGIN
// ============================================================

client.login(
    process.env.DISCORD_TOKEN
)

.then(() => {

    console.log(
        "🔐 Login de Discord iniciado..."
    );

})

.catch((error) => {

    console.error(
        "❌ Error iniciando sesión en Discord:",
        error
    );
});
