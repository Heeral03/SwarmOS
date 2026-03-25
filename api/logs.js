// NOTE: Serverless functions are stateless. 
// For a production demo, use a external KV store like Upstash Redis.
let logsStore = [
  { id: Date.now(), status: 'success', badge: 'System', msg: 'TON SwarmOS Neural Bridge established (Vercel Node).' }
];

export default function handler(req, res) {
  if (req.method === 'POST') {
    const { status, badge, msg } = req.body;
    const newLog = { id: Date.now(), status, badge, msg };
    logsStore.push(newLog);
    if (logsStore.length > 50) logsStore.shift();
    return res.status(200).json({ success: true });
  }

  res.status(200).json(logsStore);
}
