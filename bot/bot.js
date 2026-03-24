import { Bot, InlineKeyboard } from 'grammy';
import { TonClient, Address, beginCell, toNano, fromNano, WalletContractV4, internal } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import * as dotenv from 'dotenv';
dotenv.config();

// ── Config ────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const TON_ENDPOINT = 'https://testnet.toncenter.com/api/v2/jsonRPC';
const TON_API_KEY = process.env.TON_API_KEY;
const REGISTRY_ADDRESS = Address.parse(process.env.REGISTRY_ADDRESS || 'EQAQUOiEOnWu0mV6P8VMtPxfPp-_TPHUKFVRW4_TVNpVVwap');
const COORDINATOR_ADDRESS = Address.parse(process.env.COORDINATOR_ADDRESS || 'EQDVJJ0XtQWaHBJ7UvD4hYrQ-yNqywn-fD1Ou2kWBchXHFta');
const REPUTATION_ADDRESS = Address.parse(process.env.REPUTATION_ADDRESS || 'EQBi0gTBou0_3DzP9XpNa_0M_f4YbkwVpEPqI3Rxj7QwwqNA');
const MNEMONIC = process.env.BOT_MNEMONIC;

// ── Opcodes ───────────────────────────────────────────────────
const OP_REGISTER_AGENT = 0x1001;
const OP_POST_TASK = 0x2001;
const OP_BID_TASK       = 0x2002;
const OP_ACCEPT_BID     = 0x2003;
const OP_SUBMIT_RESULT  = 0x2004;
const OP_VERIFY_RESULT  = 0x2005;

// ── TON Client & Wallet ───────────────────────────────────────
const ton = new TonClient({ endpoint: TON_ENDPOINT, apiKey: TON_API_KEY });

let keyPair, wallet, contract;
async function initWallet() {
    if (!MNEMONIC) throw new Error('BOT_MNEMONIC not set');
    keyPair = await mnemonicToPrivateKey(MNEMONIC.split(' '));
    wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
    contract = ton.open(wallet);
}

// ── Helpers ───────────────────────────────────────────────────
const CAPABILITIES = {
    '1': 'price_scanner', '2': 'trade_executor', '3': 'strategist',
    '4': 'data_analyst', '5': 'content_creator', '6': 'security_auditor',
    '7': 'arbitrageur'
};

const CAP_BITS = {
    price_scanner: 1, trade_executor: 2, strategist: 4,
    data_analyst: 8, content_creator: 16, security_auditor: 32, arbitrageur: 64
};

function getCapBit(nameOrBit) {
    if (CAP_BITS[nameOrBit]) return CAP_BITS[nameOrBit];
    return parseInt(nameOrBit) || 0;
}

// ── Bot ───────────────────────────────────────────────────────
const bot = new Bot(BOT_TOKEN);

// Initialize wallet before starting
await initWallet();

// /start
bot.command('start', async (ctx) => {
    const keyboard = new InlineKeyboard()
        .text('📊 Swarm Stats', 'stats')
        .text('📋 How It Works', 'howto').row()
        .text('🤖 Agent Info', 'register_info')
        .text('📝 Task Info', 'post_info').row()
        .text('🏦 My Wallet', 'my_wallet')
        .text('📋 Open Tasks', 'list_tasks');

    await ctx.reply(
        `🌐 *TON SwarmOS*
_Personal Swarm Manager_

Your wallet address: \`${wallet.address.toString()}\`

*Commands:*
/register <cap> <price> — Register as agent
/post <cap> <payment> <desc> — Post a new task
/bid <taskId> <amount> — Bid on a task
/accept <taskId> <agentAddr> — Award task
/submit <taskId> — Submit work
/verify <taskId> — Complete & pay
/tasks — List open tasks
/wallet — Show balance`,
        { parse_mode: 'Markdown', reply_markup: keyboard }
    );
});

// /wallet
bot.command('wallet', async (ctx) => {
    const balance = await ton.getBalance(wallet.address);
    await ctx.reply(`🏦 *Wallet Status*\n\nAddress: \`${wallet.address.toString()}\`\nBalance: *${fromNano(balance)} TON*`, { parse_mode: 'Markdown' });
});
bot.callbackQuery('my_wallet', async (ctx) => {
    const balance = await ton.getBalance(wallet.address);
    await ctx.reply(`🏦 *Wallet Status*\n\nAddress: \`${wallet.address.toString()}\`\nBalance: *${fromNano(balance)} TON*`, { parse_mode: 'Markdown' });
});

// /register <cap> <price>
bot.command('register', async (ctx) => {
    const args = ctx.match.split(' ');
    if (args.length < 2) return ctx.reply('Usage: `/register <capability> <price_ton>`\nExample: `/register price_scanner 0.1`', { parse_mode: 'Markdown' });

    const cap = getCapBit(args[0]);
    const price = toNano(args[1]);

    // Check balance first
    const balance = await ton.getBalance(wallet.address);
    if (balance < toNano('1.1')) {
        return ctx.reply(
            `❌ *Insufficient Balance!*\n\nBot wallet needs at least *1.1 TON* to register (1 TON stake + gas).\n\nCurrent balance: *${fromNano(balance)} TON*\n\nPlease top up: \`${wallet.address.toString()}\``,
            { parse_mode: 'Markdown' }
        );
    }

    const seqno = await contract.getSeqno();
    await contract.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [
            internal({
                to: REGISTRY_ADDRESS,
                value: toNano('1.0'), // 1 TON for registration + stake
                body: beginCell()
                    .storeUint(OP_REGISTER_AGENT, 32)
                    .storeUint(cap, 8)
                    .storeCoins(price)
                    .storeUint(0, 256) // empty endpoint hash
                    .endCell()
            })
        ]
    });
    await ctx.reply('🚀 *Registration Sent!*\nWaiting for blockchain confirmation...', { parse_mode: 'Markdown' });
});

// /post <cap> <payment> <desc>
bot.command('post', async (ctx) => {
    const args = ctx.match.split(' ');
    if (args.length < 3) return ctx.reply('Usage: `/post <cap> <payment_ton> <desc...>`\nExample: `/post 1 5.0 Need price scan`', { parse_mode: 'Markdown' });

    const cap = getCapBit(args[0]);
    const payment = toNano(args[1]);
    const desc = args.slice(2).join(' ');

    // Check balance first
    const balance = await ton.getBalance(wallet.address);
    const required = payment + toNano('0.1');
    if (balance < required) {
        return ctx.reply(
            `❌ *Insufficient Balance!*\n\nNeed at least *${fromNano(required)} TON* to post this task.\n\nCurrent balance: *${fromNano(balance)} TON*\n\nPlease top up: \`${wallet.address.toString()}\``,
            { parse_mode: 'Markdown' }
        );
    }

    const seqno = await contract.getSeqno();
    await contract.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        messages: [
            internal({
                to: COORDINATOR_ADDRESS,
                value: payment + toNano('0.05'), // payment + gas
                body: beginCell()
                    .storeUint(OP_POST_TASK, 32)
                    .storeUint(0, 256) // desc hash dummy
                    .storeUint(cap, 8)
                    .storeUint(3600 * 24, 32) // 24h deadline
                    .endCell()
            })
        ]
    });
    await ctx.reply('📝 *Task Posting Sent!*\nLocked payment in escrow.\nWaiting for confirmation...', { parse_mode: 'Markdown' });
});

// /tasks
bot.command('tasks', async (ctx) => {
    await ctx.reply('⏳ Fetching tasks...');
    try {
        const nextId = await ton.runMethod(COORDINATOR_ADDRESS, 'getNextTaskId');
        const count = nextId.stack.readBigNumber();
        let taskText = '';
        let openTaskCount = 0;

        for (let i = 0n; i < count; i++) {
            const res = await ton.runMethod(COORDINATOR_ADDRESS, 'getTask', [{ type: 'int', value: i }]);
            const cell = res.stack.readCellOpt();
            if (cell) {
                const sc = cell.beginParse();
                sc.loadUintBig(64); // taskId
                const poster = sc.loadAddress();
                sc.loadUint(8); // cap
                const budget = sc.loadCoins();
                const state = sc.loadUint(8);

                const status = ['OPEN', 'ASSIGNED', 'VERIFYING', 'COMPLETED', 'DISPUTED', 'EXPIRED', 'CANCELLED'][state];
                if (['OPEN', 'ASSIGNED', 'VERIFYING'].includes(status)) {
                    openTaskCount++;
                    taskText += `🔹 *ID: ${i}* | Status: \`${status}\` | Budget: *${fromNano(budget)} TON*\n`;
                    taskText += `   Poster: \`${poster.toString().slice(0, 6)}...${poster.toString().slice(-4)}\`\n\n`;
                }
            }
            if (openTaskCount >= 5) break; // restrict to showing max 5 tasks
        }
        let text = `📋 *Active Tasks (${openTaskCount})*\n\n` + taskText;
        if (openTaskCount === 0) text = "📋 *No active tasks found.*";
        await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (e) {
        await ctx.reply('❌ Error: ' + e.message);
    }
});
bot.callbackQuery('list_tasks', async (ctx) => {
    ctx.answerCallbackQuery();
    await ctx.reply('⏳ Fetching tasks...');
    const nextId = await ton.runMethod(COORDINATOR_ADDRESS, 'getNextTaskId');
    await ctx.reply(`📋 Total Tasks: *${nextId.stack.readBigNumber()}*\nCheck /tasks for list.`, { parse_mode: 'Markdown' });
});

// /bid <taskId> <amount>
bot.command('bid', async (ctx) => {
    const args = ctx.match.split(' ');
    if (args.length < 2) return ctx.reply('Usage: `/bid <id> <ton>`');
    const id = BigInt(args[0]);
    const amt = toNano(args[1]);
    const seqno = await contract.getSeqno();
    await contract.sendTransfer({
        seqno, secretKey: keyPair.secretKey,
        messages: [internal({
            to: COORDINATOR_ADDRESS, value: toNano('0.05'),
            body: beginCell().storeUint(OP_BID_TASK, 32).storeUint(id, 64).storeCoins(amt).storeUint(3600, 32).storeUint(0, 256).endCell()
        })]
    });
    ctx.reply('🔨 *Bid Sent!*');
});

// /accept <taskId> <agent>
bot.command('accept', async (ctx) => {
    const args = ctx.match.split(' ');
    if (args.length < 2) return ctx.reply('Usage: `/accept <id> <address>`');
    const id = BigInt(args[0]);
    const agent = Address.parse(args[1]);
    const seqno = await contract.getSeqno();
    await contract.sendTransfer({
        seqno, secretKey: keyPair.secretKey,
        messages: [internal({
            to: COORDINATOR_ADDRESS, value: toNano('0.05'),
            body: beginCell().storeUint(OP_ACCEPT_BID, 32).storeUint(id, 64).storeAddress(agent).endCell()
        })]
    });
    ctx.reply('🤝 *Bid Accepted!*');
});

// /submit <taskId>
bot.command('submit', async (ctx) => {
    const id = BigInt(ctx.match);
    if (!id && id !== 0n) return ctx.reply('Usage: `/submit <id>`');
    const seqno = await contract.getSeqno();
    await contract.sendTransfer({
        seqno, secretKey: keyPair.secretKey,
        messages: [internal({
            to: COORDINATOR_ADDRESS, value: toNano('0.05'),
            body: beginCell().storeUint(OP_SUBMIT_RESULT, 32).storeUint(id, 64).storeUint(0, 256).endCell() // dummy result hash
        })]
    });
    ctx.reply('📤 *Work Submitted!* Waiting for verification from poster.');
});

// /verify <taskId>
bot.command('verify', async (ctx) => {
    const id = BigInt(ctx.match);
    if (!id && id !== 0n) return ctx.reply('Usage: `/verify <id>`');
    const seqno = await contract.getSeqno();
    await contract.sendTransfer({
        seqno, secretKey: keyPair.secretKey,
        messages: [internal({
            to: COORDINATOR_ADDRESS, value: toNano('0.05'),
            body: beginCell().storeUint(OP_VERIFY_RESULT, 32).storeUint(id, 64).endCell()
        })]
    });
    ctx.reply('✅ *Work Verified!* Payment released.');
});

// Existing commands integration
bot.command('stats', async (ctx) => {
    const s = await getStats();
    ctx.reply(`📊 *Stats*\nAgents: ${s.agents}\nTasks: ${s.tasks}\nStake: ${s.stake} TON`, { parse_mode: 'Markdown' });
});

async function getStats() {
    const [agents, tasks, stake] = await Promise.all([
        ton.runMethod(REGISTRY_ADDRESS, 'getAgentCount').then(r => r.stack.readNumber()),
        ton.runMethod(COORDINATOR_ADDRESS, 'getNextTaskId').then(r => r.stack.readBigNumber()),
        ton.runMethod(REGISTRY_ADDRESS, 'getTotalStake').then(r => fromNano(r.stack.readBigNumber())),
    ]);
    return { agents, tasks: tasks.toString(), stake };
}

bot.start();
console.log('🤖 TON SwarmOS Bot running — @tonswarm_bot');