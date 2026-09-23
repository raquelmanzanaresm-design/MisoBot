import { Client, GatewayIntentBits } from 'discord.js';
import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    StreamType,
    AudioPlayerStatus,
    VoiceConnectionStatus
} from '@discordjs/voice';
import express from 'express'; 
import prism from 'prism-media'; 
import ffmpegPath from 'ffmpeg-static'; 

// ==========================================
// 1. MINI SERVIDOR WEB PARA MANTENERLO VIVO 24/7
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🤖 ¡El Bot de Música está encendido y funcionando!');
});

app.listen(PORT, () => {
    console.log(`[WEB] Servidor web interno corriendo en el puerto ${PORT}`);
});

// ==========================================
// 2. CONFIGURACIÓN DEL BOT DE DISCORD
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates 
    ]
});

const player = createAudioPlayer();

// Logs para saber exactamente qué está haciendo el reproductor en Render
player.on(AudioPlayerStatus.Playing, () => console.log('[REPRODUCTOR] ¡Sonido enviado con éxito!'));
player.on('error', error => console.error('[REPRODUCTOR ERROR]', error.message));

client.once('ready', () => {
    console.log(`[BOT] Conectado con éxito a Discord como ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return; 

    if (message.content.startsWith('!play')) {
        const url = message.content.replace('!play', '').trim();

        if (!url || !url.startsWith('http')) {
            return message.reply('❌ Por favor, proporciona un enlace directo a tu MP3 de Archive.org.');
        }

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            return message.reply('❌ ¡Debes unirte primero a un canal de voz!');
        }

        try {
            message.reply('⏳ Conectando y activando transmisión estable...');

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            // Forzar suscripción inmediata
            connection.subscribe(player);

            // PARCHE CRÍTICO: Forzar a Discord a abrir los puertos de audio
            connection.on(VoiceConnectionStatus.Ready, () => {
                console.log('[CONEXIÓN] Canal de voz listo para recibir audio.');
            });

            // Configurar transmisión FFmpeg con autoreconexión de red
            const ffmpegStream = new prism.FFmpeg({
                binary: ffmpegPath,
                args: [
                    '-reconnect', '1',
                    '-reconnect_streamed', '1',
                    '-reconnect_delay_max', '4',
                    '-headers', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n',
                    '-i', url,
                    '-analyze2pass', '0',
                    '-loglevel', '0',
                    '-f', 's16le',
                    '-ar', '48000',
                    '-ac', '2',
                ],
            });

            const resource = createAudioResource(ffmpegStream, {
                inputType: StreamType.Raw
            });

            // Reproducir el recurso
            player.play(resource);

            message.channel.send(`🎵 Transmitiendo audio de Archive.org en **${voiceChannel.name}**`);

        } catch (error) {
            console.error("Error al reproducir el audio:", error);
            message.channel.send('❌ Hubo un error al intentar procesar el archivo.');
        }
    }

    if (message.content === '!stop') {
        player.stop();
        const connection = joinVoiceChannel({
            channelId: message.member.voice.channel?.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });
        if (connection) connection.destroy();
        message.reply('⏹️ Música detenida.');
    }
});

client.login(process.env.DISCORD_TOKEN);
