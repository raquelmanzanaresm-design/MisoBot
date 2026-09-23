import { Client, GatewayIntentBits } from 'discord.js';
import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    StreamType
} from '@discordjs/voice';
import express from 'express'; 
import fs from 'fs';
import https from 'https';
import path from 'path';

// ==========================================
// 1. SERVIDOR WEB DINÁMICO (RADIO LOCAL TCP)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
const ARCHIVO_RUTA = path.join('/tmp', 'cancion_actual.mp3');

// Render servirá la canción a través de este enlace web clásico (TCP)
app.get('/stream.mp3', (req, res) => {
    if (fs.existsSync(ARCHIVO_RUTA)) {
        const stat = fs.statSync(ARCHIVO_RUTA);
        res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': stat.size,
            'Accept-Ranges': 'bytes'
        });
        const readStream = fs.createReadStream(ARCHIVO_RUTA);
        readStream.pipe(res);
    } else {
        res.status(404).send('No hay música en reproducción.');
    }
});

app.get('/', (req, res) => res.send('🤖 ¡Radio del Bot en Render Activa!'));
app.listen(PORT, () => console.log(`[WEB] Radio online en puerto ${PORT}`));

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
            return message.reply('❌ Proporciona un enlace directo a tu MP3 de Archive.org.');
        }

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply('❌ ¡Únete primero a un canal de voz!');

        try {
            message.reply('⏳ Descargando de Archive.org y generando enlace web de transmisión segura...');

            // Limpieza preventiva
            if (fs.existsSync(ARCHIVO_RUTA)) {
                try { fs.unlinkSync(ARCHIVO_RUTA); } catch(e){}
            }

            const fileStream = fs.createWriteStream(ARCHIVO_RUTA);

            // Descargamos de Archive como navegador web normal
            https.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
            }, (response) => {
                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close();

                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: message.guild.id,
                        adapterCreator: message.guild.voiceAdapterCreator,
                    });

                    // IMPORTANTE: Le pedimos al recurso de Discord que consuma la canción 
                    // llamando a la propia URL del servidor web interno en lugar de usar la red UDP directa
                    const miUrlDeRender = `http://127.0.0.1:${PORT}/stream.mp3`;
                    
                    const resource = createAudioResource(miUrlDeRender, {
                        inputType: StreamType.Arbitrary
                    });

                    player.play(resource);
                    connection.subscribe(player);

                    message.channel.send(`🎵 ¡Música estabilizada! Escuchando transmisión local en **${voiceChannel.name}**.`);
                });
            });

        } catch (error) {
            console.error(error);
            message.channel.send('❌ Error al procesar la radio interna.');
        }
    }

    if (message.content === '!stop') {
        player.stop();
        if (fs.existsSync(ARCHIVO_RUTA)) {
            try { fs.unlinkSync(ARCHIVO_RUTA); } catch (e) {}
        }
        message.reply('⏹️ Música detenida.');
    }
});

client.login(process.env.DISCORD_TOKEN);
