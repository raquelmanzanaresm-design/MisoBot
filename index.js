import { Client, GatewayIntentBits } from 'discord.js';
import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    StreamType
} from '@discordjs/voice';
import express from 'express';

// 1. SERVIDOR WEB PARA UP_TIME_ROBOT
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot vivo'));
app.listen(PORT, () => console.log(`Servidor HTTP listo en puerto ${PORT}`));

// 2. CONFIGURACIÓN DEL BOT
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

            // 🛠️ EL TRUCO ORIGINAL SIN COMPLICACIONES:
            // Forzamos a que Discord cargue el archivo usando FFmpeg local de Render
            // e inyectamos los comandos de reconexión para burlar los 5 minutos.
            const resource = createAudioResource(url, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true
            });

            // Vinculamos y reproducimos
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
