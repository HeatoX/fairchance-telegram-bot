// ============================================
// FairChance Lottery - Bot de Alertas Telegram
// ============================================
// Este script monitorea el contrato y envía alertas 
// a un grupo de Telegram cuando alguien compra tickets.
// Versión: Polling (más estable que WebSocket)

require('dotenv').config();
const { ethers } = require('ethers');
const TelegramBot = require('node-telegram-bot-api');

// --- CONFIGURACIÓN ---
const CONFIG = {
    // Tu contrato de lotería en BSC
    CONTRACT_ADDRESS: '0x59d2A5a1518f331550d680A8C777A1c5F0F4D38d',

    // RPC de BSC Mainnet (Ankr es más permisivo con getLogs)
    BSC_RPC: 'https://rpc.ankr.com/bsc',

    // Token del bot de Telegram
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8297009961:AAG7NweIXk5k7ryokbWJ8Elsbqd_oNN4JaE',

    // ID del grupo de Telegram
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '-1003418707047',

    // Precio aproximado de BNB en USD
    BNB_PRICE_USD: 600,

    // Intervalo de polling en ms (15 segundos)
    POLL_INTERVAL: 15000
};

// ABI mínimo para leer eventos
const CONTRACT_ABI = [
    "event NewTicketBought(address indexed player, uint256 amount)",
    "event WinnerPicked(address indexed winner, uint256 prize, uint256 lotteryId)",
    "event LotteryExtended(uint256 newEndTime, uint256 currentPool)"
];

// Provider y contrato
const provider = new ethers.providers.JsonRpcProvider(CONFIG.BSC_RPC);
const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONTRACT_ABI, provider);

// Bot de Telegram
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: false });

// Estado para trackear el último bloque procesado
let lastProcessedBlock = 0;

// --- FUNCIONES ---

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

// Procesar evento de compra de tickets
async function processTicketBought(event) {
    const player = event.args.player;
    const amount = event.args.amount;
    const txHash = event.transactionHash;

    console.log(`🎟️ Nueva compra detectada: ${amount} tickets de ${formatAddress(player)}`);

    // Obtener balance actual
    const balance = await provider.getBalance(CONFIG.CONTRACT_ADDRESS);
    const balanceBNB = parseFloat(ethers.utils.formatEther(balance));
    const balanceUSD = (balanceBNB * CONFIG.BNB_PRICE_USD).toFixed(2);

    const message = `
🎟️ <b>¡NUEVA COMPRA DE TICKETS!</b>

👤 <b>Jugador:</b> <code>${formatAddress(player)}</code>
🎫 <b>Tickets:</b> ${amount.toString()}
💰 <b>Pozo Actual:</b> $${balanceUSD} USD

<a href="https://bscscan.com/tx/${txHash}">🔗 Ver en BscScan</a>
<a href="https://heatox.github.io/loteria-crypto/">🎰 Comprar Tickets</a>
`;

    await sendTelegramMessage(message);
}

// Procesar evento de ganador
async function processWinnerPicked(event) {
    const winner = event.args.winner;
    const prize = event.args.prize;
    const lotteryId = event.args.lotteryId;
    const txHash = event.transactionHash;

    const prizeBNB = parseFloat(ethers.utils.formatEther(prize));
    const prizeUSD = (prizeBNB * CONFIG.BNB_PRICE_USD).toFixed(2);

    console.log(`🏆 Ganador detectado: ${formatAddress(winner)} - $${prizeUSD}`);

    const message = `
🏆🏆🏆 <b>¡TENEMOS GANADOR!</b> 🏆🏆🏆

🎉 <b>Ronda:</b> #${lotteryId.toString()}
👑 <b>Ganador:</b> <code>${formatAddress(winner)}</code>
💵 <b>Premio:</b> <b>$${prizeUSD} USD</b> (${prizeBNB.toFixed(4)} BNB)

¡El dinero ya fue enviado automáticamente!

<a href="https://bscscan.com/tx/${txHash}">✅ Verificar Pago</a>
<a href="https://heatox.github.io/loteria-crypto/">🎰 ¡Nueva Ronda Iniciada!</a>
`;

    await sendTelegramMessage(message);
}

// Función principal de polling
async function pollForEvents() {
    try {
        const currentBlock = await provider.getBlockNumber();

        // Primera ejecución: obtener bloque actual
        if (lastProcessedBlock === 0) {
            lastProcessedBlock = currentBlock - 10; // Empezar 10 bloques atrás
            console.log(`📦 Iniciando desde bloque ${lastProcessedBlock}`);
        }

        // Solo buscar si hay bloques nuevos
        if (currentBlock > lastProcessedBlock) {
            console.log(`🔍 Buscando eventos del bloque ${lastProcessedBlock + 1} al ${currentBlock}`);

            // Buscar eventos NewTicketBought
            const ticketFilter = contract.filters.NewTicketBought();
            const ticketEvents = await contract.queryFilter(ticketFilter, lastProcessedBlock + 1, currentBlock);

            for (const event of ticketEvents) {
                await processTicketBought(event);
            }

            // Buscar eventos WinnerPicked
            const winnerFilter = contract.filters.WinnerPicked();
            const winnerEvents = await contract.queryFilter(winnerFilter, lastProcessedBlock + 1, currentBlock);

            for (const event of winnerEvents) {
                await processWinnerPicked(event);
            }

            // Actualizar último bloque procesado
            lastProcessedBlock = currentBlock;

            if (ticketEvents.length > 0 || winnerEvents.length > 0) {
                console.log(`✅ Procesados ${ticketEvents.length} compras y ${winnerEvents.length} ganadores`);
            }
        }

    } catch (error) {
        console.error('❌ Error en polling:', error.message);
    }
}

// --- INICIO ---
console.log('🤖 Bot de alertas FairChance iniciado...');
console.log('📡 Monitoreando contrato:', CONFIG.CONTRACT_ADDRESS);
console.log('💬 Enviando alertas a Telegram Chat ID:', CONFIG.TELEGRAM_CHAT_ID);
console.log(`⏰ Polling cada ${CONFIG.POLL_INTERVAL / 1000} segundos`);

// Ejecutar polling inmediatamente y luego cada X segundos
pollForEvents();
setInterval(pollForEvents, CONFIG.POLL_INTERVAL);

// Keep-alive log cada 60 segundos
setInterval(() => {
    console.log('💓 Bot activo -', new Date().toISOString());
}, 60000);

// Manejar señales
process.on('SIGINT', () => {
    console.log('👋 Bot detenido');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('👋 Bot terminado');
    process.exit(0);
});
