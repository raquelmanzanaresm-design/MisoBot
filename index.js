import { Client, GatewayIntentBits } from 'discord.js';
import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    StreamType,
    AudioPlayerStatus
} from '@discordjs/voice';
import express from 'express'; 
import fs from 'fs';
import https from 'https';
import path from 'path';

// ==========================================
// 1. MINI SERVIDOR WEB PARA MANTENERLO VIVO 24/7
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🤖 ¡Bot de Descarga Temporal en Render Activo y Gratis!'));
app.listen(PORT);

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
let archivoActual = null; // Guardará la ruta de la canción para poder borrarla luego

client.once('ready', () => {
    console.log(`[BOT] Conectado con éxito a Discord como ${client.user.tag}`);
});

// Evento que detecta cuando una canción termina para borrar el archivo del disco de Render
player.on(AudioPlayerStatus.Idle, () => {
    if (archivoActual && fs.existsSync(archivoActual)) {
        try {
            fs.unlinkSync(archivoActual);
            console.log('[DISCO] Archivo temporal eliminado con éxito tras terminar la canción.');
            archivoActual = null;
        } catch (err) {
            console.error('Error al eliminar archivo automático:', err);
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return; 

    if (message.content.startsWith('!play')) {
        const url = message.content.replace('!play', '').trim();

        if (!url || !url.startsWith('http')) {
            return message.reply('❌ Por favor, proporciona un enlace directo a tu MP3 de Archive.org.');
        }

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply('❌ ¡Debes unirte primero a un canal de voz!');

        try {
            // Si había una canción sonando antes, la borramos para no acumular basura
            if (archivoActual && fs.existsSync(archivoActual)) {
                fs.unlinkSync(archivoActual);
            }

            // Definimos la ruta en la carpeta /tmp de Linux (Render permite escribir aquí de forma gratuita)
            archivoActual = path.join('/tmp', `music_${message.guild.id}.mp3`);
            const fileStream = fs.createWriteStream(archivoActual);

            message.reply('⏳ Descargando pista completa a Render para saltar el límite de 5 minutos. Por favor, espera un momento...');

            // Descarga express directa como navegador web
            https.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
            }, (response) => {
                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close();

                    // Una vez guardado en el disco de Render, nos conectamos a Discord
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: message.guild.id,
                        adapterCreator: message.guild.voiceAdapterCreator,
                    });

                    // Leemos el archivo local nativo (Render procesa esto de forma instantánea)
                    const resource = createAudioResource(archivoActual, {
                        inputType: StreamType.Arbitrary
                    });

                    player.play(resource);
                    connection.subscribe(player);

                    message.channel.send(`🎵 ¡Descarga completada! Reproduciendo localmente en **${voiceChannel.name}** de forma indefinida.`);
                });
            });

        } catch (error) {
            console.error("Error en descarga local:", error);
            message.channel.send('❌ Hubo un error al intentar descargar el archivo al servidor.');
        }
    }

    if (message.content === '!stop') {
        player.stop();
        // Borramos el archivo inmediatamente si el usuario detiene el bot manualmente
        if (archivoActual && fs.existsSync(archivoActual)) {
            try {
                fs.unlinkSync(archivoActual);
                archivoActual = null;
            } catch (e) {}
        }
        
        const connection = joinVoiceChannel({
            channelId: message.member.voice.channel?.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });
        if (connection) connection.destroy();
        message.reply('⏹️ Música detenida y almacenamiento limpio.');
    }
});

client.login(process.env.DISCORD_TOKEN);

// Coloca aquí tu token real del portal de desarrolladores de Discord
client.login(process.env.DISCORD_TOKEN);
