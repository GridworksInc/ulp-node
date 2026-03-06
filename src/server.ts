// src/server.ts
import express from 'express';
import { createPacket, calculateHash } from './index';

const app = express();
app.use(express.json());

// --- 鎖を繋ぐための「最新ハッシュ」記憶装置 ---
let latestHash: string | null = null;

const peers = ['http://localhost:3001/api/receive-packet'];

async function forwardPacket(packet: any) {
    // ... (前回のforwardPacketと同じ内容でOK) ...
    for (const peer of peers) {
        try {
            await fetch(peer, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(packet)
            });
        } catch (e) { console.error("Propagation error:", e); }
    }
}

app.post('/api/send-invoice', async (req, res) => {
    // 1. パケット生成
    const packet = createPacket(latestHash, req.body);

    // 2. このパケットの指紋(ハッシュ)を計算し、次のバトンにする
    latestHash = calculateHash(packet);

    // 3. 伝播
    await forwardPacket(packet);

    res.json({ status: 'ACCEPTED', hash: latestHash });
});

app.listen(3000, () => {
    console.log('GBG Gateway Node running on port 3000');
});