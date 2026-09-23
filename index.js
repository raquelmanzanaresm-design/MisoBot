import { Client, GatewayIntentBits } from 'discord.js';
import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    StreamType
} from '@discordjs/voice';
import express from 'express'; 
import { fetch } from 'undici'; // Usamos la librería nativa de Node para conexiones estables

// ==========================================
// 1. MINI SERVIDOR WEB PARA MANTENERLO VIVO 24/7
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

// Render visitará esta ruta para verificar que el bot sigue despierto
app.get('/', (req, res) => {
    res.send('🤖 ¡El Bot de Música está encendido y funcionando 24/7!');
});

app.listen(PORT, () => {
    console.log(`[WEB] Servidor web interno corriendo en el puerto ${PORT}`);
});

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

    // El comando se usará así en Discord: !play https://archive.org
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
            message.reply('⏳ Conectando al canal de voz y cargando el audio desde la nube de forma estable...');

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            // PARCHE CLAVE: Hacemos la petición a Archive simulando un navegador real con conexión persistente
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'audio/mpeg, audio/*;q=0.9, */*;q=0.5',
                    'Connection': 'keep-alive'
                }
            });

            if (!response.ok) {
                return message.channel.send('❌ No se pudo conectar con Archive.org. Verifica el enlace.');
            }

            // Cargamos el flujo de datos directamente desde el cuerpo de la respuesta web segura
            const resource = createAudioResource(response.body, {
                inputType: StreamType.Arbitrary
            });

            player.play(resource);
            connection.subscribe(player);

            message.channel.send(`🎵 Reproduciendo audio de Archive.org en **${voiceChannel.name}**`);

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

// Coloca aquí tu token real del portal de desarrolladores de Discord
client.login(process.env.DISCORD_TOKEN);
