// ============================================
// FairChance Lottery - Bot de Alertas Telegram
// ============================================
// Versión: Block Watcher (100% RPC Público - Sin APIs externas)

require('dotenv').config();
const { ethers } = require('ethers');
const TelegramBot = require('node-telegram-bot-api');

// --- CONFIGURACIÓN ---
const CONFIG = {
    CONTRACT_ADDRESS: '0x59d2A5a1518f331550d680A8C777A1c5F0F4D38d',

    // RPCs de respaldo (Rotación simple)
    RPCS: [
        'https://rpc.ankr.com/bsc',
        'https://bsc-dataseed1.binance.org/',
        'https://bsc-dataseed2.binance.org/'
    ],

    // Token del bot de Telegram
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8297009961:AAG7NweIXk5k7ryokbWJ8Elsbqd_oNN4JaE',

    // ID del grupo de Telegram
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '-1003418707047',

    // Precio aproximado de BNB en USD
    BNB_PRICE_USD: 600,

    // Intervalo de chequeo de bloques (5 segundos)
    POLL_INTERVAL: 5000
};

// ABI para decodificar logs
const CONTRACT_ABI = [
    "event NewTicketBought(address indexed player, uint256 amount)",
    "event WinnerPicked(address indexed winner, uint256 prize, uint256 lotteryId)",
    "event LotteryExtended(uint256 newEndTime, uint256 currentPool)"
];

// Inicializar
let currentRpcIndex = 0;
let provider = new ethers.providers.JsonRpcProvider(CONFIG.RPCS[0]);
let contractInterface = new ethers.utils.Interface(CONTRACT_ABI);
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: false });

// Estado
let lastProcessedBlock = 0;
let isProcessing = false;

// --- FUNCIONES AUXILIARES ---

function getProvider() {
    return provider;
}

function rotateRpc() {
    currentRpcIndex = (currentRpcIndex + 1) % CONFIG.RPCS.length;
    console.log(`🔄 Cambiando a RPC: ${CONFIG.RPCS[currentRpcIndex]}`);
    provider = new ethers.providers.JsonRpcProvider(CONFIG.RPCS[currentRpcIndex]);
}

function formatAddress(address) {
    if (!address) return 'Unknown';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

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

// --- PROCESAMIENTO ---

async function processLog(log, txHash) {
    try {
        const parsedLog = contractInterface.parseLog(log);

        if (parsedLog.name === 'NewTicketBought') {
            const player = parsedLog.args.player;
            const amount = parsedLog.args.amount.toString();

            console.log(`🎟️ Nueva compra detectada: ${amount} tickets de ${formatAddress(player)}`);

            // Obtener balance para mostrar pozo
            let balanceUSD = '0.00';
            try {
                const balance = await provider.getBalance(CONFIG.CONTRACT_ADDRESS);
                const balanceBNB = parseFloat(ethers.utils.formatEther(balance));
                balanceUSD = (balanceBNB * CONFIG.BNB_PRICE_USD).toFixed(2);
            } catch (e) { console.error('Error leyendo balance', e.message); }

            const message = `
🎟️ <b>¡NUEVA COMPRA DE TICKETS!</b>

👤 <b>Jugador:</b> <code>${formatAddress(player)}</code>
🎫 <b>Tickets:</b> ${amount}
💰 <b>Pozo Actual:</b> $${balanceUSD} USD

<a href="https://bscscan.com/tx/${txHash}">🔗 Ver en BscScan</a>
<a href="https://heatox.github.io/loteria-crypto/">🎰 Comprar Tickets</a>
`;
            await sendTelegramMessage(message);

        } else if (parsedLog.name === 'WinnerPicked') {
            const winner = parsedLog.args.winner;
            const prize = parsedLog.args.prize;
            const lotteryId = parsedLog.args.lotteryId.toString();

            const prizeBNB = parseFloat(ethers.utils.formatEther(prize));
            const prizeUSD = (prizeBNB * CONFIG.BNB_PRICE_USD).toFixed(2);

            console.log(`� Ganador detectado: ${formatAddress(winner)}`);

            const message = `
�🏆🏆 <b>¡TENEMOS GANADOR!</b> 🏆🏆🏆

🎉 <b>Ronda:</b> #${lotteryId}
� <b>Ganador:</b> <code>${formatAddress(winner)}</code>
💵 <b>Premio:</b> <b>$${prizeUSD} USD</b> (${prizeBNB.toFixed(4)} BNB)

¡El dinero ya fue enviado automáticamente!

<a href="https://bscscan.com/tx/${txHash}">✅ Verificar Pago</a>
<a href="https://heatox.github.io/loteria-crypto/">🎰 ¡Nueva Ronda Iniciada!</a>
`;
            await sendTelegramMessage(message);
        }

    } catch (e) {
        // El log no pertenece a nuestro ABI, ignorar
    }
}

async function checkNewBlocks() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        const currentBlock = await provider.getBlockNumber();

        // Inicialización
        if (lastProcessedBlock === 0) {
            lastProcessedBlock = currentBlock;
            console.log(`🏁 Iniciando monitoreo desde bloque: ${lastProcessedBlock}`);
            isProcessing = false;
            return;
        }

        // Si no hay bloques nuevos
        if (currentBlock <= lastProcessedBlock) {
            isProcessing = false;
            return;
        }

        // Procesar bloques pendientes (uno por uno para no saturar)
        // Solo procesamos un máximo de 5 bloques de golpe para evitar lag
        const startBlock = lastProcessedBlock + 1;
        const endBlock = Math.min(currentBlock, lastProcessedBlock + 5);

        for (let i = startBlock; i <= endBlock; i++) {
            console.log(`📦 Procesando bloque ${i}...`);

            try {
                // Obtener bloque con transacciones
                const block = await provider.getBlockWithTransactions(i);

                if (block && block.transactions) {
                    // Filtrar transacciones para nuestro contrato
                    const lotteryTxs = block.transactions.filter(tx =>
                        tx.to && tx.to.toLowerCase() === CONFIG.CONTRACT_ADDRESS.toLowerCase()
                    );

                    if (lotteryTxs.length > 0) {
                        console.log(`🔎 Encontradas ${lotteryTxs.length} transacciones al contrato en bloque ${i}`);

                        // Analizar cada transacción
                        for (const tx of lotteryTxs) {
                            const receipt = await provider.getTransactionReceipt(tx.hash);
                            if (receipt && receipt.logs) {
                                for (const log of receipt.logs) {
                                    // Solo logs que emite nuestro contrato
                                    if (log.address.toLowerCase() === CONFIG.CONTRACT_ADDRESS.toLowerCase()) {
                                        await processLog(log, tx.hash);
                                    }
                                }
                            }
                        }
                    }
                }

                lastProcessedBlock = i;

            } catch (err) {
                console.error(`❌ Error procesando bloque ${i}:`, err.message);
                if (err.message.includes('rate limit') || err.message.includes('server error')) {
                    rotateRpc();
                }
            }
        }

    } catch (error) {
        console.error('❌ Error general:', error.message);
        rotateRpc();
    } finally {
        isProcessing = false;
    }
}

// --- INICIO ---
console.log('🤖 Bot FairChance: Modo Block Watcher');
console.log('📡 Contrato:', CONFIG.CONTRACT_ADDRESS);

// Loop principal
setInterval(checkNewBlocks, CONFIG.POLL_INTERVAL);

// Keep-alive logging
setInterval(() => {
    console.log(`💓 Bot vivo - Último bloque: ${lastProcessedBlock} - ${new Date().toISOString()}`);
}, 60000);

// Manejo de señales
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
