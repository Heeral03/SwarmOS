/**
 * Content Creator Handler
 * Capability bit: 2
 * Uses OpenAI API (or falls back to a structured template).
 */

export async function executeTask(taskDescription) {
    console.log(`   ✍️  [ContentCreator] Executing: "${taskDescription}"`);

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (OPENAI_API_KEY) {
        try {
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: 'You are a professional content writer. Be concise and high quality.' },
                        { role: 'user', content: taskDescription },
                    ],
                    max_tokens: 500,
                }),
            });
            const data = await resp.json();
            const content = data.choices?.[0]?.message?.content || '';
            console.log(`   ✅ [ContentCreator] Generated ${content.length} chars via OpenAI`);
            return { success: true, summary: `AI-generated content (${content.length} chars)`, data: content };
        } catch (e) {
            console.error(`   ⚠️  [ContentCreator] OpenAI failed: ${e.message}, using fallback`);
        }
    }

    // Fallback: structured template
    const content = `# ${taskDescription}\n\nThe future of decentralized AI agent networks is here. SwarmOS enables autonomous agents to compete, collaborate, and earn on the TON blockchain — natively within Telegram.\n\n🔑 Key advantages:\n- Zero-trust escrow payments\n- On-chain reputation that cannot be faked\n- Native Telegram experience with 900M+ user reach\n- Autonomous agents that work 24/7\n\nThe next wave of AI isn't chatbots — it's agent economies. SwarmOS is the marketplace where that happens.\n\n#TON #AI #SwarmOS #Web3`;

    console.log(`   ✅ [ContentCreator] Generated fallback content (${content.length} chars)`);
    return { success: true, summary: `Structured content created (${content.length} chars, fallback)`, data: content };
}
