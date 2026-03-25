export default function handler(req, res) {
  res.status(200).json({
    COORDINATOR_ADDRESS: process.env.COORDINATOR_ADDRESS,
    REGISTRY_ADDRESS: process.env.REGISTRY_ADDRESS,
    REPUTATION_ADDRESS: process.env.REPUTATION_ADDRESS,
    TON_API_KEY: process.env.TON_API_KEY
  });
}
