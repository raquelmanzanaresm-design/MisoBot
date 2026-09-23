import { Client, GatewayIntentBits } from 'discord.js';
import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    StreamType,
    entersState,
    VoiceConnectionStatus
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
            message.reply('⏳ Descargando de Archive.org y forzando enlace de voz seguro...');

            if (fs.existsSync(ARCHIVO_RUTA)) {
                try { fs.unlinkSync(ARCHIVO_RUTA); } catch(e){}
            }

            const fileStream = fs.createWriteStream(ARCHIVO_RUTA);

            https.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
            }, (response) => {
                response.pipe(fileStream);

                fileStream.on('finish', async () => {
                    fileStream.close();

                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: message.guild.id,
                        adapterCreator: message.guild.voiceAdapterCreator,
                        selfDeaf: false, 
                    });

                    // ◄ PARCHE DE RED: Forzar la comunicación entre Render y Discord
                    connection.on('stateChange', (oldState, newState) => {
                        const oldNetworking = Reflect.get(oldState, 'networking');
                        const newNetworking = Reflect.get(newState, 'networking');
                        const networkStateChangeHandler = (oldNetworkState, newNetworkState) => {
                            const newUDP = Reflect.get(newNetworkState, 'udp');
                            clearInterval(newUDP?.keepAliveInterval);
                        };
                        oldNetworking?.off('stateChange', networkStateChangeHandler);
                        newNetworking?.on('stateChange', networkStateChangeHandler);
                    });

                    // ◄ CONTROL DE ESTADO: Esperamos a que la conexión esté lista antes de reproducir
                    await entersState(connection, VoiceConnectionStatus.Ready, 15000);
                    connection.subscribe(player);

                    const miUrlDeRender = `http://127.0.0.1:${PORT}/stream.mp3`;
                    
                    const resource = createAudioResource(miUrlDeRender, {
                        inputType: StreamType.Arbitrary
                    });

                    player.play(resource);

                    message.channel.send(`🎵 ¡Música estabilizada! Escuchando transmisión local sin cortes en **${voiceChannel.name}**.`);
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

client.login(process.env.DISCORD_TOKEN);
