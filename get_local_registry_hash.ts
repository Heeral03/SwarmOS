import { compile } from '@ton/blueprint';
import { Cell } from '@ton/core';

async function run() {
    const code = await compile('AgentRegistry');
    console.log('Local AgentRegistry Code Hash:', code.hash().toString('hex'));
}

run();
