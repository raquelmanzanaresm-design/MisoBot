import { Client, GatewayIntentBits } from 'discord.js';
import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    StreamType
} from '@discordjs/voice';
import express from 'express';

// Servidor Express básico para mantener despierto el bot en Render junto con UptimeRobot
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot vivo y funcionando'));
app.listen(PORT, () => console.log(`Servidor HTTP listo en puerto ${PORT}`));

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
    console.log(`Bot conectado como ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!play')) {
        const url = message.content.replace('!play', '').trim();
        if (!url) return message.reply('❌ Pon una URL válida.');

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply('❌ Únete a un canal de voz.');

        try {
            message.reply('🎵 Conectando y cargando audio...');

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            // 🛠️ LA SOLUCIÓN DIRECTA: Pasamos las opciones de reconexión nativas de FFmpeg aquí dentro.
            // Esto bofetea a Archive.org para que no se corte a los 5 minutos sin usar librerías raras.
            const resource = createAudioResource(url, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true
            });

            connection.subscribe(player);
            player.play(resource);

            message.channel.send(`🎵 Reproduciendo en **${voiceChannel.name}**`);

        } catch (error) {
            console.error(error);
            message.channel.send('❌ Error al reproducir.');
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
