// src/auditor.ts — ULP Ledger Auditor (CLI)
//
// server.ts を起動せずに ledger.jsonl を直接検証するツール。
// server.ts の GET /ulp/v1/ledger/audit と同じロジック(hashchain.ts)を使う。
import fs from 'fs';
import path from 'path';
import { auditLedger, parseLedgerFile } from './hashchain';

const DATA_DIR = process.env.ULP_DATA_DIR || path.join(__dirname, '..', 'data');
const LEDGER_PATH = path.join(DATA_DIR, 'ledger.jsonl');

function main(): void {
    console.log('--- [ULP Auditor] Starting Audit... ---');
    console.log(`[ULP Auditor] Ledger: ${LEDGER_PATH}`);

    if (!fs.existsSync(LEDGER_PATH)) {
        console.log('[ULP Auditor] Ledger not found — nothing to audit.');
        return;
    }

    const raw = fs.readFileSync(LEDGER_PATH, 'utf-8');
    const ledger = parseLedgerFile(raw);

    if (ledger.length === 0) {
        console.log('[ULP Auditor] Ledger is empty.');
        return;
    }

    const result = auditLedger(ledger);

    if (result.valid) {
        console.log(`[PASS] All ${result.total} envelope(s) verified.`);
        console.log('--- [ULP Auditor] Audit Complete: Integrity Confirmed! ---');
        return;
    }

    console.error(`[CRITICAL] Integrity violation detected at envelope #${result.violation?.violation_at}!`);
    console.error(JSON.stringify(result.violation, null, 2));
    console.error('--- [ULP Auditor] Audit FAILED: Tamper detected. ---');
    process.exit(1);
}

main();
