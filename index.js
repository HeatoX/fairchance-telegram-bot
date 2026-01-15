// ============================================
// FairChance Lottery - Bot de Alertas Telegram
// ============================================
// Este script monitorea el contrato y envía alertas 
// a un grupo de Telegram cuando alguien compra tickets.

require('dotenv').config();
const { ethers } = require('ethers');
const TelegramBot = require('node-telegram-bot-api');

// --- CONFIGURACIÓN ---
const CONFIG = {
    // Tu contrato de lotería en BSC
    CONTRACT_ADDRESS: '0x59d2A5a1518f331550d680A8C777A1c5F0F4D38d',

    // RPC de BSC Mainnet
    BSC_RPC: 'https://bsc-dataseed1.binance.org/',

    // Token del bot de Telegram (obtenerlo de @BotFather)
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8297009961:AAG7NweIXk5k7ryokbWJ8Elsbqd_oNN4JaE',

    // ID del grupo/canal de Telegram donde enviar alertas
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '-1003418707047',

    // Precio aproximado de BNB en USD
    BNB_PRICE_USD: 600
};

// ABI mínimo para escuchar eventos
const CONTRACT_ABI = [
    "event NewTicketBought(address indexed player, uint256 amount)",
    "event WinnerPicked(address indexed winner, uint256 prize, uint256 lotteryId)",
    "event LotteryExtended(uint256 newEndTime, uint256 currentPool)"
];

// Provider HTTP para leer balance (más confiable)
const httpProvider = new ethers.providers.JsonRpcProvider(CONFIG.BSC_RPC);

// WebSocket Provider para eventos en tiempo real
const BSC_WSS = 'wss://bsc-ws-node.nariox.org:443';

let wsProvider;
let contract;

// Función para conectar WebSocket con reconexión automática
async function connectWebSocket() {
    console.log('🔌 Conectando a WebSocket BSC...');

    wsProvider = new ethers.providers.WebSocketProvider(BSC_WSS);
    contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONTRACT_ABI, wsProvider);

    // Manejar desconexión
    wsProvider._websocket.on('close', () => {
        console.log('⚠️ WebSocket desconectado, reconectando en 5 segundos...');
        setTimeout(connectWebSocket, 5000);
    });

    wsProvider._websocket.on('error', (error) => {
        console.error('❌ Error de WebSocket:', error.message);
    });

    // Configurar listeners de eventos
    setupEventListeners();

    console.log('✅ WebSocket conectado, escuchando eventos...');
}

// Inicializar bot de Telegram
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: false });

// --- FUNCIONES DE ALERTA ---

async function sendTelegramMessage(message) {
    try {
        await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, message, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        console.log('✅ Mensaje enviado a Telegram');
    } catch (error) {
        console.error('❌ Error enviando mensaje:', error.message);
    }
}

function formatAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// --- FUNCIÓN PARA CONFIGURAR LISTENERS ---
function setupEventListeners() {
    // Cuando alguien compra tickets
    contract.on('NewTicketBought', async (player, amount, event) => {
        console.log(`🎟️ Nueva compra detectada: ${amount} tickets`);

        // Obtener balance actual del contrato (usar HTTP provider, más confiable)
        const balance = await httpProvider.getBalance(CONFIG.CONTRACT_ADDRESS);
        const balanceBNB = parseFloat(ethers.utils.formatEther(balance));
        const balanceUSD = (balanceBNB * CONFIG.BNB_PRICE_USD).toFixed(2);

        const message = `
🎟️ <b>¡NUEVA COMPRA DE TICKETS!</b>

👤 <b>Jugador:</b> <code>${formatAddress(player)}</code>
🎫 <b>Tickets:</b> ${amount.toString()}
💰 <b>Pozo Actual:</b> $${balanceUSD} USD

<a href="https://bscscan.com/tx/${event.transactionHash}">🔗 Ver en BscScan</a>
<a href="https://heatox.github.io/loteria-crypto/">🎰 Comprar Tickets</a>
`;

        await sendTelegramMessage(message);
    });

    // Cuando se elige un ganador
    contract.on('WinnerPicked', async (winner, prize, lotteryId, event) => {
        const prizeBNB = parseFloat(ethers.utils.formatEther(prize));
        const prizeUSD = (prizeBNB * CONFIG.BNB_PRICE_USD).toFixed(2);

        const message = `
🏆🏆🏆 <b>¡TENEMOS GANADOR!</b> 🏆🏆🏆

🎉 <b>Ronda:</b> #${lotteryId.toString()}
👑 <b>Ganador:</b> <code>${formatAddress(winner)}</code>
💵 <b>Premio:</b> <b>$${prizeUSD} USD</b> (${prizeBNB.toFixed(4)} BNB)

¡El dinero ya fue enviado automáticamente!

<a href="https://bscscan.com/tx/${event.transactionHash}">✅ Verificar Pago</a>
<a href="https://heatox.github.io/loteria-crypto/">🎰 ¡Nueva Ronda Iniciada!</a>
`;

        await sendTelegramMessage(message);
    });

    // Cuando se extiende la lotería
    contract.on('LotteryExtended', async (newEndTime, currentPool, event) => {
        const poolBNB = parseFloat(ethers.utils.formatEther(currentPool));
        const poolUSD = (poolBNB * CONFIG.BNB_PRICE_USD).toFixed(2);
        const endDate = new Date(newEndTime.toNumber() * 1000).toLocaleString('es-ES');

        const message = `
⏰ <b>RONDA EXTENDIDA</b>

El pozo no alcanzó el mínimo, así que la ronda se ha extendido.

💰 <b>Pozo Actual:</b> $${poolUSD} USD
📅 <b>Nuevo Cierre:</b> ${endDate}

¡Tus tickets siguen participando! Invita a más amigos 🚀

<a href="https://heatox.github.io/loteria-crypto/">🎰 Comprar Más Tickets</a>
`;

        await sendTelegramMessage(message);
    });
}

// --- INICIO ---
async function main() {
    console.log('🤖 Bot de alertas FairChance iniciado...');
    console.log('📡 Escuchando eventos del contrato:', CONFIG.CONTRACT_ADDRESS);
    console.log('💬 Enviando alertas a Telegram Chat ID:', CONFIG.TELEGRAM_CHAT_ID);

    // Conectar WebSocket
    await connectWebSocket();

    // Keep-alive: hacer ping cada 30 segundos para mantener el proceso vivo
    setInterval(() => {
        console.log('💓 Bot activo...', new Date().toISOString());
    }, 30000);
}

// Manejar señales de terminación
process.on('SIGINT', () => {
    console.log('👋 Bot detenido');
    process.exit();
});

process.on('SIGTERM', () => {
    console.log('👋 Bot terminado por Railway');
    process.exit();
});

// Iniciar
main().catch(console.error);
