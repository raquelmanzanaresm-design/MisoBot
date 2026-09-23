import { Client, GatewayIntentBits } from 'discord.js';
import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    StreamType,
    VoiceConnectionStatus
} from '@discordjs/voice';
import express from 'express';
import prism from 'prism-media'; 

// 1. MINI SERVIDOR WEB PARA MANTENERLO VIVO 24/7 (Para UptimeRobot)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('¡El Bot de Música está encendido y funcionando 24/7!');
});

app.listen(PORT, () => {
    console.log(`[WEB] Servidor web interno corriendo en el puerto ${PORT}`);
});

// 2. CONFIGURACIÓN DEL BOT DE DISCORD
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

    // Comando !play
    if (message.content.startsWith('!play')) {
        const url = message.content.replace('!play', '').trim();

        if (!url || !url.startsWith('http')) {
            return message.reply('❌ Por favor, proporciona un enlace directo a tu MP3 de Archive.org. Ejemplo: `!play URL`');
        }

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            return message.reply('❌ ¡Debes unirte primero a un canal de voz!');
        }

        try {
            message.reply('🎵 Conectando al canal de voz y cargando el audio desde la nube...');

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            // 🔥 PARCHE DE RED: Corrige el bug que deja al bot congelado en Render
            connection.on('stateChange', (oldState, newState) => {
                const oldNetworking = Reflect.get(oldState, 'networking');
                const newNetworking = Reflect.get(newState, 'networking');
                
                const networkStateChangeHandler = (oldNetworkState, newNetworkState) => {
                    const newReason = Reflect.get(newNetworkState, 'reason');
                    if (newReason === 'close' && Reflect.get(newNetworkState, 'code') === 4014) {
                        connection.configureNetworking();
                    }
                };
                
                if (oldNetworking) oldNetworking.off('stateChange', networkStateChangeHandler);
                if (newNetworking) newNetworking.on('stateChange', networkStateChangeHandler);
            });

            // Configuración directa y segura de reproducción
            console.log('[BOT] Iniciando transmisión desde Archive.org...');

            const ffmpegStream = new prism.FFmpeg({
                args: [
                    '-reconnect', '1',
                    '-reconnect_streamed', '1',
                    '-reconnect_delay_max', '5',
                    '-i', url,
                    '-analyze_duration', '0',
                    '-loglevel', '0',
                    '-acodec', 'libopus',
                    '-f', 'opus',
                    '-ar', '48000',
                    '-ac', '2',
                ],
            });

            const opusStream = ffmpegStream.pipe(new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 }));

            const resource = createAudioResource(opusStream, {
                inputType: StreamType.Opus
            });

            player.play(resource);
            connection.subscribe(player);

            message.channel.send(`🎵 Reproduciendo audio de Archive.org en **${voiceChannel.name}**`);

        } catch (error) {
            console.error("Error al reproducir el audio:", error);
            message.channel.send('❌ Hubo un error al intentar procesar el archivo de música.');
        }
    }

    // Comando !stop
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
