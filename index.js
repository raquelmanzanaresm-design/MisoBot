import { Client, GatewayIntentBits } from 'discord.js';
import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    StreamType
} from '@discordjs/voice';
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot vivo y funcionando'));
app.listen(PORT, () => console.log(`[WEB] Servidor web interno corriendo en el puerto ${PORT}`));

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
        if (!url) return message.reply('❌ Por favor, proporciona un enlace directo.');

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply('❌ ¡Debes unirte primero a un canal de voz!');

        try {
            message.reply('🎵 Conectando al canal de voz y cargando el audio desde la nube...');

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
                connection.on('debug', console.log);
                connection.on('error', console.error);
            });

            const resource = createAudioResource(url, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true
            });

            connection.subscribe(player);
            player.play(resource);

            message.channel.send(`🎵 ¡Reproduciendo música en **${voiceChannel.name}**!`);

        } catch (error) {
            console.error("Error al reproducir el audio:", error);
            message.channel.send('❌ Hubo un error al intentar procesar el archivo de música.');
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
