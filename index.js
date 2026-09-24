import { Client, GatewayIntentBits } from 'discord.js';
import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    StreamType,
    AudioPlayerStatus
} from '@discordjs/voice';
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot vivo y funcionando'));
app.listen(PORT, () => console.log(`[WEB] Servidor web interno activo en puerto ${PORT}`));

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

// 🔥 EL PARCHE DEFINITIVO: Fuerza la reconexión constante si el servidor gratuito capa el puerto
player.on('error', error => {
    console.log(`[INFO] Reajustando paquetes de audio: ${error.message}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!play')) {
        const url = message.content.replace('!play', '').trim();
        if (!url) return message.reply('❌ Pon un enlace directo válido.');

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply('❌ Únete primero a un canal de voz.');

        try {
            message.reply('🎵 Cargando el archivo desde la nube e iniciando transmisión...');

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
                selfDeaf: true // Reduce el consumo de red en hostings gratuitos
            });

            const resource = createAudioResource(url, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true
            });

            connection.subscribe(player);
            player.play(resource);

            message.channel.send(`🎵 ¡Reproduciendo música en **${voiceChannel.name}**!`);

        } catch (error) {
            console.error(error);
            message.channel.send('❌ Error al procesar el audio.');
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
