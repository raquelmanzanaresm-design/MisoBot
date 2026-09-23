import { Client, GatewayIntentBits } from 'discord.js';
import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    StreamType,
    AudioPlayerStatus
} from '@discordjs/voice';
import express from 'express'; 
import https from 'https'; // Usamos el módulo nativo HTTPS para saltar el bloqueo UDP de Render

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🤖 ¡Bot en Render funcionando!'));
app.listen(PORT);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates 
    ]
});

const player = createAudioPlayer();

client.on('messageCreate', async (message) => {
    if (message.author.bot) return; 

    if (message.content.startsWith('!play')) {
        const url = message.content.replace('!play', '').trim();
        if (!url) return;

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply('❌ ¡Únete a un canal de voz!');

        try {
            message.reply('⏳ Conectando flujo web...');

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            connection.subscribe(player);

            // Creamos una petición HTTP directa con cabeceras de navegador
            https.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
                    'Connection': 'keep-alive'
                }
            }, (stream) => {
                const resource = createAudioResource(stream, {
                    inputType: StreamType.Arbitrary
                });
                player.play(resource);
                message.channel.send(`🎵 Reproduciendo de forma directa.`);
            });

        } catch (error) {
            message.channel.send('❌ Error de conexión.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
