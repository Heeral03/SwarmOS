import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano, Address } from '@ton/core';
import { SwarmCoordinator } from './wrappers/SwarmCoordinator';
import { compile } from '@ton/blueprint';

async function run() {
    const code = await compile('SwarmCoordinator');
    const chain = await Blockchain.create();
    const deployer = await chain.treasury('deployer');
    const poster = await chain.treasury('poster');

    const coordinator = chain.openContract(
        SwarmCoordinator.createFromConfig({
            owner:             deployer.address,
            registryAddress:   Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c'),
            reputationAddress: Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c'),
        }, code)
    );
    await coordinator.sendDeploy(deployer.getSender(), toNano('0.1'));

    console.log('Posting task...');
    await coordinator.sendPostTask(poster.getSender(), {
        descriptionHash: 123n,
        requiredCapability: 1,
        workDeadlineDelta: 3600,
        payment: toNano('1'),
    });

    console.log('Next Task ID:', await coordinator.getNextTaskId());

    console.log('Calling getTask(0)...');
    try {
        // Since getTask is not in the wrapper, we call it manually
        const result = await chain.runGetMethod(coordinator.address, 'getTask', [{ type: 'int', value: 0n }]);
        console.log('Result:', result);
    } catch (e) {
        console.error('Error calling getTask:', e);
    }
}

run();
