// ============================================
// FairChance Lottery - Bot de Alertas Telegram
// ============================================
// Versión: BscScan API (más estable que RPC)

require('dotenv').config();
const { ethers } = require('ethers');
const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

// --- CONFIGURACIÓN ---
const CONFIG = {
    CONTRACT_ADDRESS: '0x59d2A5a1518f331550d680A8C777A1c5F0F4D38d',

    // Token del bot de Telegram
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8297009961:AAG7NweIXk5k7ryokbWJ8Elsbqd_oNN4JaE',

    // ID del grupo de Telegram
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '-1003418707047',

    // Precio aproximado de BNB en USD
    BNB_PRICE_USD: 600,

    // Intervalo de polling (60 segundos para evitar rate limits de BscScan)
    POLL_INTERVAL: 60000
};

// Topic hash para evento NewTicketBought(address,uint256)
const TICKET_BOUGHT_TOPIC = '0x5aa751d731debbe10def42d9ad6bf03d78e05b6a01826eb28384e11ea05b78c8';

// Bot de Telegram
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: false });

// Estado
let lastProcessedBlock = 0;
let processedTxHashes = new Set();

// --- FUNCIONES ---

function httpGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function sendTelegramMessage(message) {
    try {
        await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, message, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        console.log('✅ Mensaje enviado a Telegram');
        return true;
    } catch (error) {
        console.error('❌ Error enviando mensaje:', error.message);
        return false;
    }
}

function formatAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Obtener balance del contrato
async function getContractBalance() {
    try {
        const url = `https://api.bscscan.com/api?module=account&action=balance&address=${CONFIG.CONTRACT_ADDRESS}&tag=latest`;
        const response = await httpGet(url);
        if (response.status === '1') {
            const balanceWei = response.result;
            const balanceBNB = parseFloat(ethers.utils.formatEther(balanceWei));
            return balanceBNB;
        }
    } catch (error) {
        console.error('Error obteniendo balance:', error.message);
    }
    return 0;
}

// Obtener transacciones recientes al contrato
async function getRecentTransactions() {
    try {
        const url = `https://api.bscscan.com/api?module=account&action=txlist&address=${CONFIG.CONTRACT_ADDRESS}&startblock=0&endblock=99999999&page=1&offset=20&sort=desc`;
        console.log(`📡 Consultando BscScan: ${url}`);

        const response = await httpGet(url);
        console.log('🔍 Respuesta BscScan:', JSON.stringify(response));

        if (response.status === '1' && response.result) {
            return response.result;
        } else {
            console.warn('⚠️ BscScan respuesta no-exitosa:', response.message);
        }
    } catch (error) {
        console.error('Error obteniendo transacciones:', error.message);
    }
    return [];
}

// Procesar nueva compra
async function processTicketPurchase(tx) {
    const player = tx.from;
    const txHash = tx.hash;
    const valueBNB = parseFloat(ethers.utils.formatEther(tx.value));
    const tickets = Math.round(valueBNB / 0.002); // Precio por ticket = 0.002 BNB

    console.log(`🎟️ Nueva compra: ${tickets} tickets de ${formatAddress(player)}`);

    // Obtener balance actual
    const balanceBNB = await getContractBalance();
    const balanceUSD = (balanceBNB * CONFIG.BNB_PRICE_USD).toFixed(2);

    const message = `
🎟️ <b>¡NUEVA COMPRA DE TICKETS!</b>

👤 <b>Jugador:</b> <code>${formatAddress(player)}</code>
🎫 <b>Tickets:</b> ${tickets}
💰 <b>Pozo Actual:</b> $${balanceUSD} USD

<a href="https://bscscan.com/tx/${txHash}">🔗 Ver en BscScan</a>
<a href="https://heatox.github.io/loteria-crypto/">🎰 Comprar Tickets</a>
`;

    await sendTelegramMessage(message);
}

// Función principal de polling
async function pollForTransactions() {
    try {
        console.log('🔍 Buscando nuevas transacciones...');

        const transactions = await getRecentTransactions();

        if (transactions.length === 0) {
            console.log('📭 No hay transacciones recientes');
            return;
        }

        // Obtener el bloque más reciente para inicializar
        if (lastProcessedBlock === 0) {
            lastProcessedBlock = parseInt(transactions[0].blockNumber);
            // Marcar las últimas 5 transacciones como procesadas para no spam inicial
            transactions.slice(0, 5).forEach(tx => processedTxHashes.add(tx.hash));
            console.log(`📦 Iniciando desde bloque ${lastProcessedBlock}`);
            return;
        }

        // Procesar transacciones nuevas (que no hayamos visto)
        for (const tx of transactions) {
            // Solo procesar transacciones entrantes (TO = contrato)
            if (tx.to.toLowerCase() !== CONFIG.CONTRACT_ADDRESS.toLowerCase()) continue;

            // Solo transacciones exitosas
            if (tx.txreceipt_status !== '1') continue;

            // Solo transacciones con valor (compras)
            if (tx.value === '0') continue;

            // No procesar si ya la vimos
            if (processedTxHashes.has(tx.hash)) continue;

            // Marcar como procesada
            processedTxHashes.add(tx.hash);

            // Procesar la compra
            await processTicketPurchase(tx);

            // Actualizar último bloque
            const blockNum = parseInt(tx.blockNumber);
            if (blockNum > lastProcessedBlock) {
                lastProcessedBlock = blockNum;
            }
        }

        // Limpiar hashes viejos (mantener solo los últimos 100)
        if (processedTxHashes.size > 100) {
            const arr = Array.from(processedTxHashes);
            processedTxHashes = new Set(arr.slice(-50));
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
pollForTransactions();
setInterval(pollForTransactions, CONFIG.POLL_INTERVAL);

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
