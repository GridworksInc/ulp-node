// src/server.ts — ULP Node (統合サーバ)
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.ULP_PORT || '4800', 10);
const DATA_DIR = process.env.ULP_DATA_DIR || path.join(__dirname, '..', 'data');
const LEDGER_PATH = path.join(DATA_DIR, 'ledger.jsonl');
const API_KEY = process.env.ULP_API_KEY || '';

// --- データディレクトリ作成 ---
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --- Canonical JSON ---
function canonicalJson(obj: any): string {
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

// --- ハッシュ計算 (ULP仕様準拠) ---
function calculateHash(payload: any, parentHash: string | null): string {
    const data = canonicalJson(payload) + (parentHash ?? 'null');
    return crypto.createHash('sha256').update(data).digest('hex');
}

// --- 台帳 ---
interface LedgerEntry {
    ulp_version: string;
    envelope_id: string;
    envelope_type: string;
    payload: any;
    sender: { id: string; name: string; signature?: string };
    receiver: { id: string; name: string };
    parent_hash: string | null;
    hash: string;
    timestamp: string;
    sequence: number;
}

let ledger: LedgerEntry[] = [];
let latestHash: string | null = null;

// --- 起動時に台帳を復元 ---
function loadLedger(): void {
    if (!fs.existsSync(LEDGER_PATH)) return;
    console.log('[ULP] Restoring ledger...');
    const data = fs.readFileSync(LEDGER_PATH, 'utf-8');
    const lines = data.split('\n').filter(line => line.trim() !== '');
    lines.forEach((line) => {
        const entry: LedgerEntry = JSON.parse(line);
        ledger.push(entry);
        latestHash = entry.hash;
    });
    console.log(`[ULP] Restored ${ledger.length} envelopes. Head: ${latestHash?.substring(0, 12)}...`);
}

function appendToLedger(entry: LedgerEntry): void {
    const logLine = JSON.stringify(entry) + '\n';
    fs.appendFileSync(LEDGER_PATH, logLine);
    ledger.push(entry);
    latestHash = entry.hash;
}

// --- 認証ミドルウェア ---
function authenticate(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (!API_KEY) return next(); // API_KEY未設定なら認証スキップ
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${API_KEY}`) {
        res.status(401).json({ status: 'UNAUTHORIZED', message: 'Invalid or missing API key' });
        return;
    }
    next();
}

// --- 監査ロジック ---
function auditLedger(): { valid: boolean; total: number; violation?: any } {
    let previousHash: string | null = null;
    for (let i = 0; i < ledger.length; i++) {
        const entry = ledger[i];
        const expectedHash = calculateHash(entry.payload, entry.parent_hash);
        if (entry.parent_hash !== previousHash) {
            return {
                valid: false, total: ledger.length,
                violation: {
                    violation_at: i + 1,
                    envelope_id: entry.envelope_id,
                    expected_parent_hash: previousHash,
                    found_parent_hash: entry.parent_hash,
                },
            };
        }
        if (entry.hash !== expectedHash) {
            return {
                valid: false, total: ledger.length,
                violation: {
                    violation_at: i + 1,
                    envelope_id: entry.envelope_id,
                    expected_hash: expectedHash,
                    found_hash: entry.hash,
                },
            };
        }
        previousHash = entry.hash;
    }
    return { valid: true, total: ledger.length };
}

// ========== API エンドポイント ==========

// POST /ulp/v1/envelope — Envelopeを台帳に追加
app.post('/ulp/v1/envelope', authenticate, (req, res) => {
    const body = req.body;

    // バリデーション
    if (!body.envelope_type) {
        res.status(400).json({ status: 'INVALID_ENVELOPE', message: 'Missing envelope_type' });
        return;
    }
    if (!body.payload || typeof body.payload !== 'object') {
        res.status(400).json({ status: 'INVALID_PAYLOAD', message: 'Missing or invalid payload' });
        return;
    }
    if (!body.sender?.id || !body.sender?.name) {
        res.status(400).json({ status: 'INVALID_ENVELOPE', message: 'Missing sender.id or sender.name' });
        return;
    }
    if (!body.receiver?.id || !body.receiver?.name) {
        res.status(400).json({ status: 'INVALID_ENVELOPE', message: 'Missing receiver.id or receiver.name' });
        return;
    }

    const parentHash = latestHash;
    const hash = calculateHash(body.payload, parentHash);

    const entry: LedgerEntry = {
        ulp_version: 'ULP/1.0',
        envelope_id: body.envelope_id || uuidv4(),
        envelope_type: body.envelope_type,
        payload: body.payload,
        sender: { id: body.sender.id, name: body.sender.name, signature: body.sender.signature },
        receiver: { id: body.receiver.id, name: body.receiver.name },
        parent_hash: parentHash,
        hash,
        timestamp: body.timestamp || new Date().toISOString(),
        sequence: ledger.length + 1,
    };

    appendToLedger(entry);

    console.log(`[ULP] Envelope #${entry.sequence} recorded: ${entry.envelope_type} ${entry.envelope_id.substring(0, 8)}... hash=${hash.substring(0, 12)}...`);

    res.json({
        status: 'ACCEPTED',
        envelope_id: entry.envelope_id,
        hash: entry.hash,
        parent_hash: entry.parent_hash,
        sequence: entry.sequence,
    });
});

// GET /ulp/v1/envelope/:id — Envelope取得
app.get('/ulp/v1/envelope/:id', authenticate, (req, res) => {
    const entry = ledger.find(e => e.envelope_id === req.params.id);
    if (!entry) {
        res.status(404).json({ status: 'NOT_FOUND', message: 'Envelope not found' });
        return;
    }
    res.json(entry);
});

// GET /ulp/v1/envelopes — Envelope一覧
app.get('/ulp/v1/envelopes', authenticate, (req, res) => {
    let results = [...ledger];

    const { sender_id, receiver_id, envelope_type, from, to } = req.query as Record<string, string>;
    if (sender_id) results = results.filter(e => e.sender.id === sender_id);
    if (receiver_id) results = results.filter(e => e.receiver.id === receiver_id);
    if (envelope_type) results = results.filter(e => e.envelope_type === envelope_type);
    if (from) results = results.filter(e => e.timestamp >= from);
    if (to) results = results.filter(e => e.timestamp <= to);

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const paged = results.slice(offset, offset + limit);

    res.json({ envelopes: paged, total: results.length, limit, offset });
});

// GET /ulp/v1/ledger/audit — 台帳監査
app.get('/ulp/v1/ledger/audit', authenticate, (req, res) => {
    const result = auditLedger();
    if (result.valid) {
        res.json({
            status: 'INTEGRITY_CONFIRMED',
            total_envelopes: result.total,
            first_envelope: ledger[0]?.timestamp || null,
            last_envelope: ledger[ledger.length - 1]?.timestamp || null,
            head_hash: latestHash,
        });
    } else {
        res.status(409).json({ status: 'INTEGRITY_VIOLATION', ...result.violation });
    }
});

// GET /ulp/v1/info — 公開ノード情報
app.get('/ulp/v1/info', (_req, res) => {
    res.json({
        ulp_version: 'ULP/1.0',
        node_id: process.env.ULP_NODE_ID || 'node-staging-001',
        node_name: process.env.ULP_NODE_NAME || 'Gridworks ULP Node (Staging)',
        operator: 'Gridworks Inc.',
        supported_types: ['invoice'],
        total_envelopes: ledger.length,
        head_hash: latestHash,
    });
});

// ========== 起動 ==========
loadLedger();

app.listen(PORT, () => {
    console.log(`[ULP] Universal Ledger Protocol Node running on port ${PORT}`);
    console.log(`[ULP] Ledger: ${LEDGER_PATH}`);
    console.log(`[ULP] Envelopes: ${ledger.length}`);
    console.log(`[ULP] Auth: ${API_KEY ? 'enabled' : 'disabled (no ULP_API_KEY set)'}`);
});
