import { Client, GatewayIntentBits } from 'discord.js';
import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    StreamType
} from '@discordjs/voice';
import express from 'express'; 
import prism from 'prism-media'; // Importamos prism-media para el control total de FFmpeg

// ==========================================
// 1. MINI SERVIDOR WEB PARA MANTENERLO VIVO 24/7
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🤖 ¡El Bot de Música está encendido y funcionando con reconexión activa!');
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
            message.reply('⏳ Conectando al canal de voz y activando transmisión con autoreconexión...');

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            // Creamos un proceso de FFmpeg con argumentos de reconexión forzada y simulación de navegador
            const ffmpegStream = new prism.FFmpeg({
                args: [
                    '-reconnect', '1',                  // Fuerza a reconectar si se corta
                    '-reconnect_streamed', '1',         // Específico para enlaces de música en la nube
                    '-reconnect_delay_max', '4',        // Tiempo máximo de espera para reconectar (4 segundos)
                    '-headers', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\n',
                    '-i', url,                          // La URL de Archive.org
                    '-analyze2pass', '0',
                    '-loglevel', '0',
                    '-f', 's16le',                      // Formato PCM requerido por Discord.js
                    '-ar', '48000',
                    '-ac', '2',
                ],
            });

            // Convertimos el proceso FFmpeg en un recurso de audio compatible con Discord
            const resource = createAudioResource(ffmpegStream, {
                inputType: StreamType.Raw // Usamos RAW porque FFmpeg ya lo convierte a PCM
            });

            player.play(resource);
            connection.subscribe(player);

            message.channel.send(`🎵 Reproduciendo audio con protección anticortes en **${voiceChannel.name}**`);

        } catch (error) {
            console.error("Error al reproducir el audio:", error);
            message.channel.send('❌ Hubo un error al intentar procesar el archivo con FFmpeg.');
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
