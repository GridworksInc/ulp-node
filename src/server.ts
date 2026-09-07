// src/server.ts — ULP Node (統合サーバ)
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4, validate as isUuid } from 'uuid';
import { calculateHash, auditLedger, parseLedgerFile, LedgerEntry } from './hashchain';
import { loadTsaConfigFromEnv } from './timestamp';
import { TimestampScheduler, loadTimestampRecords } from './timestampScheduler';
import { ReplicationManager, parsePeersFromEnv, loadReplicaLedger, listReplicaNodeIds } from './replication';

const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = parseInt(process.env.ULP_PORT || '4800', 10);
const DATA_DIR = process.env.ULP_DATA_DIR || path.join(__dirname, '..', 'data');
const LEDGER_PATH = path.join(DATA_DIR, 'ledger.jsonl');
const TIMESTAMPS_PATH = path.join(DATA_DIR, 'timestamps.jsonl');
const REPLICAS_DIR = path.join(DATA_DIR, 'replicas');
const PEER_SYNC_INTERVAL_MS = parseInt(process.env.ULP_PEER_SYNC_INTERVAL_MS || '5000', 10);
const PEER_SYNC_BATCH_SIZE = parseInt(process.env.ULP_PEER_SYNC_BATCH_SIZE || '200', 10);
const API_KEY = process.env.ULP_API_KEY || '';
const MAX_BODY_SIZE = process.env.ULP_MAX_BODY_SIZE || '256kb';
const TSA_INTERVAL_MS = parseInt(process.env.ULP_TSA_INTERVAL_MS || '60000', 10);
// レプリケーション用の増分取得は既定の200件上限だと大量流入時に追従しづらいため、
// 個別に上限を引き上げられるようにする(通常のクライアント一覧取得にも影響するため注意)。
const MAX_LIST_LIMIT = parseInt(process.env.ULP_MAX_LIST_LIMIT || '200', 10);
const NODE_ID = process.env.ULP_NODE_ID || 'node-staging-001';

// --- 本番環境での事故防止 ---
// API_KEY未設定のまま本番稼働すると、台帳への書き込みAPIが誰でも叩ける状態になる。
// 開発中は認証スキップを許容するが、NODE_ENV=production では起動自体を拒否する。
if (NODE_ENV === 'production' && !API_KEY) {
    console.error('[ULP] FATAL: ULP_API_KEY must be set when NODE_ENV=production.');
    process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: MAX_BODY_SIZE }));

// --- レート制限 (spec/API.md の想定に対する簡易実装。プラン別上限は将来対応) ---
app.use(
    rateLimit({
        windowMs: 60 * 1000,
        limit: parseInt(process.env.ULP_RATE_LIMIT_PER_MIN || '300', 10),
        standardHeaders: true,
        legacyHeaders: false,
        message: { status: 'RATE_LIMITED', message: 'Too many requests' },
    })
);

// --- データディレクトリ作成 ---
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --- 第三者タイムスタンプ(TSA)設定 ---
// ULP_TSA_URL 未設定なら機能無効(既存動作に影響なし)。
const tsaConfig = loadTsaConfigFromEnv();
if (!tsaConfig) {
    console.log('[ULP] TSA timestamping disabled (ULP_TSA_URL not set)');
}

// --- レプリケーション(peer同期)設定 ---
// ULP_PEERS 未設定なら機能無効(既存動作に影響なし)。
const peers = parsePeersFromEnv();
const replicationManager = peers.length > 0
    ? new ReplicationManager(peers, REPLICAS_DIR, PEER_SYNC_INTERVAL_MS, PEER_SYNC_BATCH_SIZE)
    : null;
if (!replicationManager) {
    console.log('[ULP] Peer replication disabled (ULP_PEERS not set)');
}

// --- 台帳 (オンメモリ) ---
// TODO: 台帳が巨大化するとメモリを圧迫する。将来的にはSQLite等の永続ストアへの
// 移行と、ページング前提のインデックス構築を検討する(現状はJSONLへのフル復元)。
let ledger: LedgerEntry[] = [];
let latestHash: string | null = null;
const envelopeIndex = new Map<string, LedgerEntry>();

// --- 起動時に台帳を復元 ---
function loadLedger(): void {
    if (!fs.existsSync(LEDGER_PATH)) return;
    console.log('[ULP] Restoring ledger...');
    const data = fs.readFileSync(LEDGER_PATH, 'utf-8');
    const entries = parseLedgerFile(data);
    entries.forEach((entry) => {
        ledger.push(entry);
        envelopeIndex.set(entry.envelope_id, entry);
        latestHash = entry.hash;
    });
    console.log(`[ULP] Restored ${ledger.length} envelopes. Head: ${latestHash?.substring(0, 12) ?? 'null'}...`);
}

function appendToLedger(entry: LedgerEntry): void {
    const logLine = JSON.stringify(entry) + '\n';
    fs.appendFileSync(LEDGER_PATH, logLine);
    ledger.push(entry);
    envelopeIndex.set(entry.envelope_id, entry);
    latestHash = entry.hash;
}

// --- 認証ミドルウェア ---
function authenticate(req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (!API_KEY) return next(); // API_KEY未設定なら認証スキップ (開発用途のみ。本番では起動時に拒否済み)
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${API_KEY}`) {
        res.status(401).json({ status: 'UNAUTHORIZED', message: 'Invalid or missing API key' });
        return;
    }
    next();
}

// --- Envelope バリデーション ---
function validateEnvelope(body: any): { field: string; message: string } | null {
    if (!body || typeof body !== 'object') {
        return { field: 'body', message: 'Request body must be a JSON object' };
    }
    if (typeof body.envelope_type !== 'string' || body.envelope_type.trim() === '') {
        return { field: 'envelope_type', message: 'Missing envelope_type' };
    }
    if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
        return { field: 'payload', message: 'Missing or invalid payload' };
    }
    if (typeof body.sender?.id !== 'string' || body.sender.id.trim() === '') {
        return { field: 'sender.id', message: 'Missing sender.id' };
    }
    if (typeof body.sender?.name !== 'string' || body.sender.name.trim() === '') {
        return { field: 'sender.name', message: 'Missing sender.name' };
    }
    if (typeof body.receiver?.id !== 'string' || body.receiver.id.trim() === '') {
        return { field: 'receiver.id', message: 'Missing receiver.id' };
    }
    if (typeof body.receiver?.name !== 'string' || body.receiver.name.trim() === '') {
        return { field: 'receiver.name', message: 'Missing receiver.name' };
    }
    if (body.envelope_id !== undefined && (typeof body.envelope_id !== 'string' || !isUuid(body.envelope_id))) {
        return { field: 'envelope_id', message: 'envelope_id must be a valid UUID' };
    }
    if (body.envelope_id !== undefined && envelopeIndex.has(body.envelope_id)) {
        return { field: 'envelope_id', message: 'envelope_id already exists in the ledger' };
    }
    if (body.timestamp !== undefined && Number.isNaN(Date.parse(body.timestamp))) {
        return { field: 'timestamp', message: 'timestamp must be a valid ISO 8601 datetime' };
    }
    return null;
}

// ========== API エンドポイント ==========

// POST /ulp/v1/envelope — Envelopeを台帳に追加
app.post('/ulp/v1/envelope', authenticate, (req, res) => {
    const body = req.body;

    const error = validateEnvelope(body);
    if (error) {
        res.status(400).json({ status: 'INVALID_ENVELOPE', message: error.message, field: error.field });
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
    const entry = envelopeIndex.get(String(req.params.id));
    if (!entry) {
        res.status(404).json({ status: 'NOT_FOUND', message: 'Envelope not found' });
        return;
    }
    res.json(entry);
});

// GET /ulp/v1/envelopes — Envelope一覧
//
// since_sequence はレプリケーション(src/replication.ts)が増分取得に使うカーソル。
// sequence は1始まりの連番なので、since_sequence=N は「N件目より後」を意味する。
app.get('/ulp/v1/envelopes', authenticate, (req, res) => {
    let results = [...ledger];

    const { sender_id, receiver_id, envelope_type, from, to, since_sequence } = req.query as Record<string, string>;
    if (sender_id) results = results.filter(e => e.sender.id === sender_id);
    if (receiver_id) results = results.filter(e => e.receiver.id === receiver_id);
    if (envelope_type) results = results.filter(e => e.envelope_type === envelope_type);
    if (from) results = results.filter(e => e.timestamp >= from);
    if (to) results = results.filter(e => e.timestamp <= to);
    if (since_sequence) results = results.filter(e => e.sequence > parseInt(since_sequence, 10));

    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), MAX_LIST_LIMIT);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const paged = results.slice(offset, offset + limit);

    res.json({ envelopes: paged, total: results.length, limit, offset });
});

// GET /ulp/v1/ledger/audit — 台帳監査
app.get('/ulp/v1/ledger/audit', authenticate, (req, res) => {
    const result = auditLedger(ledger);
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

// GET /ulp/v1/ledger/timestamps — TSAによる定点タイムスタンプ一覧
//
// Envelope単位ではなく head_hash 単位でタイムスタンプを取得しているため、
// あるEnvelopeの存在証明は「そのenvelope.sequence <= record.sequence」となる
// 最初の record を探し、record.head_hash からハッシュチェーンを遡って
// そのEnvelopeのhashに到達できることを確認する形で行う。
app.get('/ulp/v1/ledger/timestamps', authenticate, (_req, res) => {
    const records = loadTimestampRecords(TIMESTAMPS_PATH);
    res.json({ enabled: tsaConfig !== null, timestamps: records, total: records.length });
});

// GET /ulp/v1/peers — レプリケーション先(peer)ノードの同期状態
//
// 各peerは自分専用のhash chainを持つ(spec/REPLICATION.md参照)。ここでの
// last_sequence/last_hash は「そのpeerのchainのうち、自ノードがどこまで
// レプリカとして取り込めているか」を示す。
app.get('/ulp/v1/peers', authenticate, (_req, res) => {
    res.json({ peers: replicationManager?.getStatus() ?? [] });
});

// GET /ulp/v1/replicas/:node_id/envelopes — 保持しているpeerのレプリカ台帳
//
// 自ノードが他ノードから複製したchainを、さらに別ノードへ中継できるように
// 公開する(将来のマルチホップ・フェデレーション用途)。
app.get('/ulp/v1/replicas/:node_id/envelopes', authenticate, (req, res) => {
    const nodeId = String(req.params.node_id);
    if (!listReplicaNodeIds(REPLICAS_DIR).includes(nodeId)) {
        res.status(404).json({ status: 'NOT_FOUND', message: `No replica held for node_id=${nodeId}` });
        return;
    }
    let entries = loadReplicaLedger(REPLICAS_DIR, nodeId);

    const sinceSequence = req.query.since_sequence as string | undefined;
    if (sinceSequence) entries = entries.filter(e => e.sequence > parseInt(sinceSequence, 10));

    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), MAX_LIST_LIMIT);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const paged = entries.slice(offset, offset + limit);

    res.json({ envelopes: paged, total: entries.length, limit, offset });
});

// GET /ulp/v1/info — 公開ノード情報 (認証不要)
app.get('/ulp/v1/info', (_req, res) => {
    res.json({
        ulp_version: 'ULP/1.0',
        node_id: NODE_ID,
        node_name: process.env.ULP_NODE_NAME || 'Gridworks ULP Node (Staging)',
        operator: 'Gridworks Inc.',
        supported_types: ['invoice'],
        total_envelopes: ledger.length,
        head_hash: latestHash,
    });
});

// --- グローバルエラーハンドラ ---
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.type === 'entity.parse.failed') {
        res.status(400).json({ status: 'INVALID_ENVELOPE', message: 'Malformed JSON body' });
        return;
    }
    if (err?.type === 'entity.too.large') {
        res.status(413).json({ status: 'PAYLOAD_TOO_LARGE', message: `Request body exceeds ${MAX_BODY_SIZE}` });
        return;
    }
    console.error('[ULP] Unhandled error:', err);
    res.status(500).json({ status: 'INTERNAL_ERROR', message: 'Internal server error' });
});

// ========== 起動 ==========
loadLedger();

const tsaScheduler = tsaConfig
    ? new TimestampScheduler(tsaConfig, TSA_INTERVAL_MS, TIMESTAMPS_PATH, () => ({
          hash: latestHash,
          sequence: ledger.length,
      }))
    : null;

const server = app.listen(PORT, () => {
    console.log(`[ULP] Universal Ledger Protocol Node running on port ${PORT} (env: ${NODE_ENV})`);
    console.log(`[ULP] Ledger: ${LEDGER_PATH}`);
    console.log(`[ULP] Envelopes: ${ledger.length}`);
    console.log(`[ULP] Auth: ${API_KEY ? 'enabled' : 'disabled (no ULP_API_KEY set)'}`);
    tsaScheduler?.start();
    void replicationManager?.start();
});

// --- Graceful shutdown ---
function shutdown(signal: string): void {
    console.log(`[ULP] Received ${signal}, shutting down gracefully...`);
    tsaScheduler?.stop();
    replicationManager?.stop();
    server.close(() => {
        console.log('[ULP] Server closed.');
        process.exit(0);
    });
    // 一定時間内に閉じ切らなければ強制終了
    setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
