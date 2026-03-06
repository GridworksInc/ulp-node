// src/receiver.ts (再構築メカニズム付き)
import express from 'express';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.json());
const LEDGER_PATH = path.join(__dirname, 'ledger.jsonl');

// --- 復活メカニズム (Event Replay) ---
function loadLedger() {
    if (!fs.existsSync(LEDGER_PATH)) return;

    console.log("--- [GBG Node 3001] Resurrecting from Ledger ---");
    const data = fs.readFileSync(LEDGER_PATH, 'utf-8');
    const lines = data.split('\n').filter(line => line.trim() !== '');

    lines.forEach((line, index) => {
        const packet = JSON.parse(line);
        console.log(`Replaying Event #${index + 1}: ${packet.payload.invoice_id}`);
    });
    console.log(`--- [GBG Node 3001] Restoration Complete. ${lines.length} events replayed. ---`);
}

// 起動時にロードする
loadLedger();
// ------------------------------------

app.post('/api/receive-packet', (req, res) => {
    const packet = req.body;
    const logEntry = JSON.stringify(packet) + '\n';

    fs.appendFile(LEDGER_PATH, logEntry, (err) => {
        if (err) return res.status(500).json({ status: 'ERROR' });
        console.log("--- [GBG Node 3001] Event Recorded: " + packet.payload.invoice_id + " ---");
        res.json({ status: 'OK' });
    });
});

app.listen(3001, () => {
    console.log('GBG Receiver Node (Persistent) running on port 3001');
});