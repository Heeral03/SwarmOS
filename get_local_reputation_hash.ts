import { compile } from '@ton/blueprint';
async function run() {
    const code = await compile('ReputationUpdater');
    console.log('Local ReputationUpdater Code Hash:', code.hash().toString('hex'));
}
run();
