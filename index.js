// 1. IMPORTAR LIBRERÍAS (Formato ES Modules)
import 'dotenv/config'; 
import { Client, GatewayIntentBits } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType } from '@discordjs/voice';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import http from 'http'; // Librería nativa de Node.js para crear servidores web

// ==========================================
// TRUCO PARA RENDER GRATIS: SERVIDOR WEB FALSO
// ==========================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('MisoBot esta vivo y funcionando!\n');
}).listen(PORT, () => {
    console.log(`Servidor web falso escuchando en el puerto ${PORT}`);
});
// ==========================================

// 2. CONFIGURAR CLIENTE DE CLOUDFLARE R2
const r2Client = new S3Client({
    region: "auto", 
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

// 3. INICIALIZAR EL BOT DE DISCORD
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const reproductor = createAudioPlayer();

// 4. FUNCIÓN PARA BUSCAR LA CANCIÓN EN CLOUDFLARE R2
async function obtenerStreamDeMusica(nombreArchivo) {
    try {
        const comando = new GetObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: nombreArchivo
        });

        const respuesta = await r2Client.send(comando);
        return respuesta.Body; 
    } catch (error) {
        console.error("Error al conectar con Cloudflare R2:", error);
        throw error;
    }
}

// 5. EVENTO CUANDO EL BOT SE ENCIENDE
client.once('ready', () => {
    console.log(`¡Bot de música listo! Conectado como ${client.user.tag}`);
});

// 6. ESCUCHAR COMANDOS EN EL CHAT
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!play')) return;

    const args = message.content.split(' ');
    const nombreCancion = args[1]; 

    if (!nombreCancion) {
        return message.reply('❌ Por favor, dime el nombre del archivo. Ejemplo: `!play cancion.mp3`');
    }

    const canalVoz = message.member.voice.channel;
    if (!canalVoz) {
        return message.reply('❌ ¡Debes estar en un canal de voz para reproducir música!');
    }

    try {
        message.reply(`⏳ Conectando a Cloudflare R2 para transmitir: **${nombreCancion}**...`);

        const conexionVoz = joinVoiceChannel({
            channelId: canalVoz.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        const streamDeAudio = await obtenerStreamDeMusica(nombreCancion);

          const recursoAudio = createAudioResource(streamDeAudio, {
            inputType: StreamType.Arbitrary,
        });

        reproductor.play(recursoAudio);
        conexionVoz.subscribe(reproductor);

        message.channel.send(`▶️ Reproduciendo ahora desde R2: **${nombreCancion}**`);

    } catch (error) {
        console.error("Error detallado en la reproducción:", error);
        message.channel.send(`❌ Error: No se pudo reproducir la canción.`);
    }
});

reproductor.on('error', error => {
    console.error(`Error en el reproductor de audio: ${error.message}`);
});

// 7. INICIAR SESIÓN
client.login(process.env.DISCORD_TOKEN);
