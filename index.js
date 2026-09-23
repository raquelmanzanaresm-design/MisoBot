import { Client, GatewayIntentBits } from 'discord.js';
import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    StreamType,
    AudioPlayerStatus
} from '@discordjs/voice';
import express from 'express';

// 1. SERVIDOR WEB PARA MANTENERLO DESPIERTO CON UP_TIME_ROBOT
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot de música activo 24/7'));
app.listen(PORT, () => console.log(`[WEB] Servidor listo en puerto ${PORT}`));

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

// Monitoreo del reproductor en la consola de Render
player.on('error', error => {
    console.error(`[ERROR REPRODUCTOR] Fallo en el flujo: ${error.message}`);
});

player.on(AudioPlayerStatus.Playing, () => {
    console.log('[BOT] ¡Emitiendo sonido correctamente en el canal!');
});

client.once('ready', () => {
    console.log(`[BOT] Conectado a Discord como ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Comando !play
    if (message.content.startsWith('!play')) {
        const url = message.content.replace('!play', '').trim();
        if (!url || !url.startsWith('http')) {
            return message.reply('❌ Por favor, pon una URL válida de Archive.org.');
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

            // 🔥 PARCHE DE RED OBLIGATORIO PARA RENDER
            // Esto reconfigura la red de Discord si se queda congelada al conectar
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

            // Cargamos el recurso de Archive.org usando el FFmpeg nativo del sistema
            const resource = createAudioResource(url, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true
            });

            // Primero vinculamos el reproductor a la llamada, y luego reproducimos
            connection.subscribe(player);
            player.play(resource);

            message.channel.send(`🎵 Reproduciendo en **${voiceChannel.name}**`);

        } catch (error) {
            console.error("[ERROR GENERAL]", error);
            message.channel.send('❌ Hubo un error al intentar reproducir.');
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
