import { toNano } from '@ton/core';
import { AgentRegistry } from '../wrappers/AgentRegistry';
import { SwarmCoordinator } from '../wrappers/SwarmCoordinator';
import { ReputationUpdater } from '../wrappers/ReputationUpdater';
import { compile, NetworkProvider } from '@ton/blueprint';

// Deploys all 3 SwarmOS contracts in one run.
//
// Order matters:
//   1. Compile all three to get deterministic addresses
//   2. Deploy AgentRegistry
//   3. Deploy ReputationUpdater (with pre-calculated coordinator address)
//   4. Deploy SwarmCoordinator
//
// Because TON contract addresses are deterministic (hash of code + data),
// we can calculate SwarmCoordinator's address BEFORE deploying it,
// and use it when deploying ReputationUpdater. No chicken-and-egg problem.

export async function run(provider: NetworkProvider) {
    const deployer = provider.sender().address!;

    console.log('🚀 TON SwarmOS — Full Deployment');
    console.log('👤 Deployer:', deployer.toString());
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Compile all three first
    const [registryCode, reputationCode, coordinatorCode] = await Promise.all([
        compile('AgentRegistry'),
        compile('ReputationUpdater'),
        compile('SwarmCoordinator'),
    ]);

    // ── Step 1: Deploy AgentRegistry ─────────────────────────
    console.log('\n[1/3] Deploying AgentRegistry...');

    const registry = provider.open(
        AgentRegistry.createFromConfig({ owner: deployer }, registryCode)
    );
    await registry.sendDeploy(provider.sender(), toNano('0.05'));
    await provider.waitForDeploy(registry.address);
    console.log('✅', registry.address.toString());

    // ── Step 2: Pre-calculate ReputationUpdater address ───────
    // Deploy ReputationUpdater with deployer as a temporary coordinator.
    const reputation = provider.open(
        ReputationUpdater.createFromConfig(
            {
                owner:              deployer,
                coordinatorAddress: deployer, // Temp placeholder
            },
            reputationCode,
        )
    );

    // ── Step 3: Deploy ReputationUpdater ─────────────────────
    console.log('\n[2/3] Deploying ReputationUpdater...');
    await reputation.sendDeploy(provider.sender(), toNano('0.05'));
    await provider.waitForDeploy(reputation.address);
    console.log('✅', reputation.address.toString());


    // ── Step 4: Deploy SwarmCoordinator ──────────────────────
    // Coordinator needs the real ReputationUpdater address
    const coordinator = provider.open(
        SwarmCoordinator.createFromConfig(
            {
                owner:             deployer,
                registryAddress:   registry.address,
                reputationAddress: reputation.address, // Real reputation address
            },
            coordinatorCode,
        )
    );

    console.log('\n[3/3] Deploying SwarmCoordinator...');
    await coordinator.sendDeploy(provider.sender(), toNano('0.05'));
    await provider.waitForDeploy(coordinator.address);
    console.log('✅', coordinator.address.toString());

    // ── Step 5: Link ReputationUpdater to Coordinator ─────────
    console.log('\n[+] Updating ReputationUpdater with real Coordinator Address...');
    await reputation.sendUpdateCoordinator(provider.sender(), {
        coordinator: coordinator.address
    });
    // Add a small delay allowing the message to process on testnet
    console.log('✅ Linked successfully (message sent).');

    // ── Done ──────────────────────────────────────────────────
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 All contracts deployed!\n');
    console.log('Copy to .env:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`REGISTRY_ADDRESS=${registry.address.toString()}`);
    console.log(`REPUTATION_ADDRESS=${reputation.address.toString()}`);
    console.log(`COORDINATOR_ADDRESS=${coordinator.address.toString()}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\nTonscan links:');
    console.log('  https://testnet.tonscan.org/address/' + registry.address.toString());
    console.log('  https://testnet.tonscan.org/address/' + reputation.address.toString());
    console.log('  https://testnet.tonscan.org/address/' + coordinator.address.toString());
}