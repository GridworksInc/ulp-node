// src/auditor.ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const LEDGER_PATH = path.join(__dirname, 'ledger.jsonl');

// サーバー側と完全に同じロジックでハッシュを計算する
function calculateHash(packet: any): string {
    const dataToHash = JSON.stringify(packet.payload) + packet.parent_hash;
    return crypto.createHash('sha256').update(dataToHash).digest('hex');
}

function auditLedger() {
    console.log("--- [GBG Auditor] Starting Audit... ---");
    if (!fs.existsSync(LEDGER_PATH)) return console.log("Ledger empty.");

    const data = fs.readFileSync(LEDGER_PATH, 'utf-8');
    const packets = data.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line));

    // ここが重要！最初は文字列ではなく null です。
    let previousHash: string | null = null;

    packets.forEach((packet, index) => {
        // 1. リンクの検証
        if (index === 0) {
            // 最初のパケット(Genesis)は、親が null であることを確認
            if (packet.parent_hash !== null) {
                console.error(`[CRITICAL] Genesis packet is invalid!`);
                process.exit(1);
            }
        } else {
            // 2番目以降のパケットは、親が前のパケットのハッシュと一致することを確認
            if (packet.parent_hash !== previousHash) {
                console.error(`[CRITICAL] Tamper detected at packet #${index + 1}!`);
                console.error(`Expected: ${previousHash}, Found: ${packet.parent_hash}`);
                process.exit(1);
            }
        }

        // 2. 現在のパケットのハッシュを計算（次のバトンにするために）
        const currentHash = calculateHash(packet);

        console.log(`[PASS] Packet #${index + 1} verified. Hash: ${currentHash.substring(0, 10)}...`);

        // 次のループのために、現在のハッシュを previousHash にセット
        previousHash = currentHash;
    });

    console.log("--- [GBG Auditor] Audit Complete: Integrity Confirmed! ---");
}

auditLedger();