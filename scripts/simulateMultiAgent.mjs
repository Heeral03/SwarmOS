/**
 * SwarmOS Multi-Agent Simulation
 * ──────────────────────────────────────────────────────────────────
 * This script simulates 2 agents competitively bidding on a task.
 * Agent 1 posts a task, Both Agent 1 and Agent 2 bid on it,
 * Agent 1 accepts Agent 2's bid (lower price wins!),
 * Agent 2 submits work, Agent 1 verifies, Reputation scores are shown.
 *
 * Usage: node scripts/simulateMultiAgent.mjs
 */

import { TonClient, WalletContractV4, Address, beginCell, toNano, fromNano, TupleBuilder, internal } from '@ton/ton';
import { mnemonicToPrivateKey, mnemonicNew } from '@ton/crypto';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../bot/.env') });

// ── Config ─────────────────────────────────────────────────────────
const TON_ENDPOINT    = 'https://testnet.toncenter.com/api/v2/jsonRPC';
const TON_API_KEY     = process.env.TON_API_KEY;
const REGISTRY_ADDRESS    = Address.parse(process.env.REGISTRY_ADDRESS    || 'EQAQUOiEOnWu0mV6P8VMtPxfPp-_TPHUKFVRW4_TVNpVVwap');
const REPUTATION_ADDRESS  = Address.parse(process.env.REPUTATION_ADDRESS  || 'EQAmia9mKEfxLxUVofUxzcB18unpmThnsO_VcwH-XAqSl--Z');
const COORDINATOR_ADDRESS = Address.parse(process.env.COORDINATOR_ADDRESS || 'EQAdht45uZopgALhZ-_4oFqyCRrfIG0m3YCM13749UJDi76Y');

// ── Opcodes ─────────────────────────────────────────────────────────
const OP_REGISTER_AGENT = 0x1001;
const OP_POST_TASK      = 0x2001;
const OP_BID_TASK       = 0x2002;
const OP_ACCEPT_BID     = 0x2003;
const OP_SUBMIT_RESULT  = 0x2004;
const OP_VERIFY_RESULT  = 0x2005;

const ton = new TonClient({ endpoint: TON_ENDPOINT, apiKey: TON_API_KEY });

// ── Helpers ─────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(emoji, msg) {
    const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.log(`\n[${time}] ${emoji}  ${msg}`);
}

async function waitForSeqno(contract, prevSeqno, label) {
    console.log(`   ⏳ Waiting for ${label}...`);
    for (let i = 0; i < 40; i++) {
        await sleep(5000);
        try {
            const cur = await contract.getSeqno();
            if (cur > prevSeqno) {
                log('✅', `${label} confirmed!`);
                return;
            }
        } catch (_) {}
        process.stdout.write('.');
    }
    log('⚠️', `${label} took too long — continuing`);
}

async function loadWallet(mnemonicStr, label) {
    const kp  = await mnemonicToPrivateKey(mnemonicStr.split(' '));
    const w   = WalletContractV4.create({ publicKey: kp.publicKey, workchain: 0 });
    const c   = ton.open(w);
    const bal = await ton.getBalance(w.address);
    log('👛', `${label} loaded: ${w.address.toString().slice(0,12)}... | Balance: ${fromNano(bal)} TON`);
    return { kp, wallet: w, contract: c, label };
}

async function getScore(agentAddr, label) {
    const tb = new TupleBuilder();
    tb.writeAddress(agentAddr);
    try {
        const res = await ton.runMethod(REPUTATION_ADDRESS, 'getScore', tb.build());
        return res.stack.readNumber();
    } catch { return 500; }
}

async function send(agent, to, value, body, label) {
    const seqno = await agent.contract.getSeqno();
    await agent.contract.sendTransfer({
        seqno,
        secretKey: agent.kp.secretKey,
        messages: [internal({ to, value, body })]
    });
    await waitForSeqno(agent.contract, seqno, label);
}

// ── Main Simulation ─────────────────────────────────────────────────
async function main() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🤖 SwarmOS Multi-Agent Simulation');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // ── Agent 1 = your existing bot wallet (poster + first bidder)
    const MNEMONIC_A1 = process.env.BOT_MNEMONIC;
    if (!MNEMONIC_A1) throw new Error('BOT_MNEMONIC not set in bot/.env');

    // ── Agent 2 = second wallet. Auto-generated or from AGENT2_MNEMONIC env var
    let MNEMONIC_A2 = process.env.AGENT2_MNEMONIC;
    if (!MNEMONIC_A2) {
        log('🆕', 'No AGENT2_MNEMONIC found — generating a fresh wallet for Agent 2...');
        const words = await mnemonicNew(24);
        MNEMONIC_A2 = words.join(' ');
        // Save for future runs
        fs.appendFileSync(join(__dirname, '../bot/.env'), `\nAGENT2_MNEMONIC="${MNEMONIC_A2}"\n`);
        log('💾', 'Saved AGENT2_MNEMONIC to bot/.env for future runs');
    }

    const agent1 = await loadWallet(MNEMONIC_A1, 'Agent 1 (Poster)');
    const agent2 = await loadWallet(MNEMONIC_A2, 'Agent 2 (Bidder)');

    // Check Agent 2 balance
    const bal2 = await ton.getBalance(agent2.wallet.address);
    if (bal2 < toNano('1.3')) {
        log('💸', `Agent 2 needs testnet TON! Send at least 1.5 TON to:\n   ${agent2.wallet.address.toString()}`);
        log('🔗', 'Get free testnet TON from: https://t.me/testgiver_ton_bot');
        log('❌', 'Aborting. Fund Agent 2, then re-run.');
        return;
    }

    // ── Score snapshot before
    const scoreA1_before = await getScore(agent1.wallet.address, 'Agent 1');
    const scoreA2_before = await getScore(agent2.wallet.address, 'Agent 2');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📊 STARTING REPUTATION SCORES');
    console.log(`     Agent 1: ${scoreA1_before}`);
    console.log(`     Agent 2: ${scoreA2_before}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // ── Step 1: Register both agents
    log('📋', 'STEP 1: Registering Agent 1...');
    await send(agent1, REGISTRY_ADDRESS, toNano('1.05'),
        beginCell()
            .storeUint(OP_REGISTER_AGENT, 32)
            .storeUint(1, 8)            // capability: price_scanner
            .storeCoins(toNano('0.05')) // price per unit
            .storeUint(0, 256)
            .endCell(),
        'Agent 1 Registration');

    log('📋', 'STEP 1b: Registering Agent 2...');
    await send(agent2, REGISTRY_ADDRESS, toNano('1.05'),
        beginCell()
            .storeUint(OP_REGISTER_AGENT, 32)
            .storeUint(1, 8)
            .storeCoins(toNano('0.03')) // cheaper price — more competitive
            .storeUint(0, 256)
            .endCell(),
        'Agent 2 Registration');

    // ── Step 2: Get next task ID so we know what ID our task will be
    const nextIdRes = await ton.runMethod(COORDINATOR_ADDRESS, 'getNextTaskId');
    const taskId = nextIdRes.stack.readBigNumber();
    log('🆔', `New task will have ID: ${taskId}`);

    // ── Step 3: Agent 1 posts a task
    const taskBudget = toNano('0.5');
    log('📝', `STEP 2: Agent 1 posts a task with budget 0.5 TON...`);
    await send(agent1, COORDINATOR_ADDRESS, taskBudget + toNano('0.05'),
        beginCell()
            .storeUint(OP_POST_TASK, 32)
            .storeUint(0, 256)       // description hash
            .storeUint(1, 8)         // required capability
            .storeUint(3600 * 24, 32) // 24h work deadline
            .endCell(),
        'Task Posted');

    // ── Step 4: Both agents bid
    log('🔨', `STEP 3: Agent 1 bids 0.45 TON on Task ${taskId}...`);
    await send(agent1, COORDINATOR_ADDRESS, toNano('0.05'),
        beginCell()
            .storeUint(OP_BID_TASK, 32)
            .storeUint(taskId, 64)
            .storeCoins(toNano('0.45'))  // Agent 1 bids 0.45
            .storeUint(3600 * 12, 32)    // 12h delivery
            .storeUint(0, 256)
            .endCell(),
        'Agent 1 Bid');

    log('🔨', `STEP 3b: Agent 2 bids 0.35 TON on Task ${taskId} (lower = better)...`);
    await send(agent2, COORDINATOR_ADDRESS, toNano('0.05'),
        beginCell()
            .storeUint(OP_BID_TASK, 32)
            .storeUint(taskId, 64)
            .storeCoins(toNano('0.35'))  // Agent 2 bids lower — wins!
            .storeUint(3600 * 8, 32)     // 8h delivery — faster too!
            .storeUint(0, 256)
            .endCell(),
        'Agent 2 Bid');

    log('✅', `Both bids placed! Agent 2 has the better (lower) offer.`);

    // ── Step 5: Agent 1 (as poster) accepts Agent 2's bid
    log('🤝', `STEP 4: Agent 1 accepts Agent 2's bid...`);
    await send(agent1, COORDINATOR_ADDRESS, toNano('0.05'),
        beginCell()
            .storeUint(OP_ACCEPT_BID, 32)
            .storeUint(taskId, 64)
            .storeAddress(agent2.wallet.address)
            .endCell(),
        'Bid Accepted');

    // ── Step 6: Agent 2 submits work
    log('📤', `STEP 5: Agent 2 submits work...`);
    await send(agent2, COORDINATOR_ADDRESS, toNano('0.05'),
        beginCell()
            .storeUint(OP_SUBMIT_RESULT, 32)
            .storeUint(taskId, 64)
            .storeUint(0xDEADBEEFn, 256) // dummy result hash
            .endCell(),
        'Work Submitted');

    // ── Step 7: Agent 1 verifies and releases payment
    log('✅', `STEP 6: Agent 1 verifies work + releases payment...`);
    await send(agent1, COORDINATOR_ADDRESS, toNano('0.05'),
        beginCell()
            .storeUint(OP_VERIFY_RESULT, 32)
            .storeUint(taskId, 64)
            .endCell(),
        'Work Verified — Payment Released!');

    // Give the blockchain a moment to process the reputation update
    log('⏳', 'Waiting 10 seconds for reputation update to propagate...');
    await sleep(10000);

    // ── Final: Show reputation scores
    const scoreA1_after = await getScore(agent1.wallet.address, 'Agent 1');
    const scoreA2_after = await getScore(agent2.wallet.address, 'Agent 2');
    const balA2_after = await ton.getBalance(agent2.wallet.address);

    console.log('\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🏆 SIMULATION COMPLETE — FINAL RESULTS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n  AGENT 1 (Poster — bid was NOT chosen)`);
    console.log(`  Reputation: ${scoreA1_before} → ${scoreA1_after}  (${scoreA1_after >= scoreA1_before ? '+' : ''}${scoreA1_after - scoreA1_before})`);
    console.log(`\n  AGENT 2 (Bidder — bid WAS chosen & work verified) 🎉`);
    console.log(`  Reputation: ${scoreA2_before} → ${scoreA2_after}  (${scoreA2_after >= scoreA2_before ? '+' : ''}${scoreA2_after - scoreA2_before})`);
    console.log(`  Earned: 0.35 TON payment released to wallet`);
    console.log(`  Wallet balance: ${fromNano(balA2_after)} TON`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Task → https://testnet.tonscan.org/address/' + COORDINATOR_ADDRESS.toString());
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(e => { console.error('Fatal error:', e.message); process.exit(1); });
