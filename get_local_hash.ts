import { compile } from '@ton/blueprint';
import { Cell } from '@ton/core';

async function run() {
    const code = await compile('SwarmCoordinator');
    console.log('Local SwarmCoordinator Code Hash:', code.hash().toString('hex'));
}

run();
