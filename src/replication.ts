// src/replication.ts — ノード間レプリケーション (Pull型・増分ポーリング)
//
// 設計原則 (spec/REPLICATION.md 参照):
// - 各ULP Nodeは自分専用のhash chainにのみ書き込む。複数ノードが同一chainに
//   直接書き込むことはない(コンセンサス不要 = 1日あたり億件規模でも書き込み
//   性能が他ノードから独立してスケールする)。
// - 他ノード(peer)のchainは「レプリカ」として複製し、hash chainの検証ロジックを
//   使って改ざん・欠落がないことを確認しながら保存する。
// - Pull型(自分からpeerのGET /ulp/v1/envelopesを叩く)を採用。push(webhook)は
//   配信ロスに弱く、pullなら「どこまで貰ったか(sequence)」を自分で管理できるため
//   再起動・一時断からの再開が容易。
import fs from 'fs';
import path from 'path';
import { LedgerEntry, calculateHash } from './hashchain';

export interface PeerConfig {
    url: string; // 例: https://worksd.internal:4800
    apiKey?: string;
}

export interface ReplicaMeta {
    node_id: string;
    peer_url: string;
    last_sequence: number;
    last_hash: string | null;
    last_synced_at: string | null;
    status: 'ok' | 'error' | 'pending';
    last_error?: string;
}

/**
 * ULP_PEERS: カンマ区切りのpeer定義。各エントリは "url" または "url|apiKey"。
 * 例: ULP_PEERS="https://worksd.internal:4800|secret-key-1,https://customer-a.example.com:4800|secret-key-2"
 */
export function parsePeersFromEnv(): PeerConfig[] {
    const raw = process.env.ULP_PEERS;
    if (!raw) return [];
    return raw
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(entry => {
            const [url, apiKey] = entry.split('|');
            return { url: url.trim(), apiKey: apiKey?.trim() || undefined };
        });
}

function metaPath(repDir: string): string {
    return path.join(repDir, 'meta.json');
}

function ledgerPath(repDir: string): string {
    return path.join(repDir, 'ledger.jsonl');
}

function loadMeta(repDir: string, peerUrl: string): ReplicaMeta | null {
    const p = metaPath(repDir);
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
        return null;
    }
}

function saveMeta(repDir: string, meta: ReplicaMeta): void {
    fs.mkdirSync(repDir, { recursive: true });
    fs.writeFileSync(metaPath(repDir), JSON.stringify(meta, null, 2));
}

function appendReplicaEntries(repDir: string, entries: LedgerEntry[]): void {
    if (entries.length === 0) return;
    const lines = entries.map(e => JSON.stringify(e) + '\n').join('');
    fs.appendFileSync(ledgerPath(repDir), lines);
}

interface FetchEnvelopesResponse {
    envelopes: LedgerEntry[];
    total: number;
    limit: number;
    offset: number;
}

async function fetchInfo(peer: PeerConfig): Promise<{ node_id: string }> {
    const res = await fetch(`${peer.url.replace(/\/$/, '')}/ulp/v1/info`);
    if (!res.ok) throw new Error(`GET /ulp/v1/info failed: HTTP ${res.status}`);
    return res.json();
}

async function fetchEnvelopesSince(peer: PeerConfig, sinceSequence: number, limit: number): Promise<FetchEnvelopesResponse> {
    const url = new URL(`${peer.url.replace(/\/$/, '')}/ulp/v1/envelopes`);
    url.searchParams.set('since_sequence', String(sinceSequence));
    url.searchParams.set('limit', String(limit));

    const headers: Record<string, string> = {};
    if (peer.apiKey) headers['Authorization'] = `Bearer ${peer.apiKey}`;

    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GET /ulp/v1/envelopes failed: HTTP ${res.status}`);
    return res.json();
}

/**
 * 1つのpeerに対する同期状態と処理をまとめたクラス。
 */
class PeerSync {
    private repDir: string;
    private meta: ReplicaMeta | null = null;
    private timer: NodeJS.Timeout | null = null;
    private running = false;

    constructor(
        private readonly peer: PeerConfig,
        private readonly replicasRootDir: string,
        private readonly intervalMs: number,
        private readonly batchSize: number,
    ) {
        // node_id判明前は仮ディレクトリ名としてURLのホスト部を使う
        this.repDir = path.join(this.replicasRootDir, `_pending_${new URL(peer.url).hostname}`);
    }

    async init(): Promise<void> {
        const info = await fetchInfo(this.peer);
        const finalDir = path.join(this.replicasRootDir, info.node_id);

        // 仮ディレクトリに何か書き込んでいた場合は正式なnode_idディレクトリへ移す
        if (this.repDir !== finalDir && fs.existsSync(this.repDir)) {
            fs.mkdirSync(finalDir, { recursive: true });
            fs.renameSync(this.repDir, finalDir);
        }
        this.repDir = finalDir;
        fs.mkdirSync(this.repDir, { recursive: true });

        this.meta = loadMeta(this.repDir, this.peer.url) ?? {
            node_id: info.node_id,
            peer_url: this.peer.url,
            last_sequence: 0,
            last_hash: null,
            last_synced_at: null,
            status: 'pending',
        };
    }

    start(): void {
        this.timer = setInterval(() => void this.tick(), this.intervalMs);
        this.timer.unref();
        void this.tick(); // 起動直後に1回実行
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    getStatus(): ReplicaMeta | null {
        return this.meta;
    }

    private async tick(): Promise<void> {
        if (this.running || !this.meta) return;
        this.running = true;
        try {
            // 1回のポーリングでbatchSizeいっぱいまで取得できた場合は、まだ残って
            // いる可能性が高いため間隔を待たずに連続取得する(キャッチアップ)。
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const resp = await fetchEnvelopesSince(this.peer, this.meta.last_sequence, this.batchSize);
                if (resp.envelopes.length === 0) break;

                // バッチ全体を先に検証してから書き込む(アトミック)。途中まで検証して
                // 書き込んだ後に失敗すると、次回再試行時に同じ行を重複追記して
                // しまうため、書き込みは「全件検証OK」の後にまとめて行う。
                let cursorHash = this.meta.last_hash;
                let cursorSequence = this.meta.last_sequence;
                for (const entry of resp.envelopes) {
                    if (entry.parent_hash !== cursorHash) {
                        throw new Error(
                            `chain break at sequence=${entry.sequence}: expected parent_hash=${cursorHash}, got ${entry.parent_hash}`
                        );
                    }
                    const recomputed = calculateHash(entry.payload, entry.parent_hash);
                    if (recomputed !== entry.hash) {
                        throw new Error(`hash mismatch at sequence=${entry.sequence}: possible tampering`);
                    }
                    cursorHash = entry.hash;
                    cursorSequence = entry.sequence;
                }

                appendReplicaEntries(this.repDir, resp.envelopes);
                this.meta.last_sequence = cursorSequence;
                this.meta.last_hash = cursorHash;
                this.meta.status = 'ok';
                this.meta.last_error = undefined;
                this.meta.last_synced_at = new Date().toISOString();
                saveMeta(this.repDir, this.meta);

                console.log(
                    `[ULP Replication] ${this.meta.node_id}: synced up to sequence=${this.meta.last_sequence}`
                );

                if (resp.envelopes.length < this.batchSize) break; // 追いついた
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[ULP Replication] ${this.peer.url}: sync failed — ${message}`);
            if (this.meta) {
                this.meta.status = 'error';
                this.meta.last_error = message;
                saveMeta(this.repDir, this.meta);
            }
            // last_sequence/last_hashは進めない → 次回同じ位置から再試行される
        } finally {
            this.running = false;
        }
    }
}

/**
 * 全peerの同期を管理する。
 */
export class ReplicationManager {
    private peerSyncs: PeerSync[] = [];
    private initTimers: NodeJS.Timeout[] = [];
    private stopped = false;

    constructor(
        private readonly peers: PeerConfig[],
        private readonly replicasRootDir: string,
        private readonly intervalMs: number,
        private readonly batchSize: number,
    ) {}

    async start(): Promise<void> {
        if (this.peers.length === 0) return;
        fs.mkdirSync(this.replicasRootDir, { recursive: true });

        // 各peerの初期化(GET /ulp/v1/info によるnode_id解決)を独立してリトライする。
        // 起動タイミングによっては相手ノードがまだ立ち上がっていないことがあり得るため
        // (例: worksp/worksdの再起動が完全に同時ではない場合)、一度失敗しても
        // intervalMsごとに再試行し続ける。既存のPeer登録には影響しない。
        this.peers.forEach(peer => this.initPeerWithRetry(peer));
    }

    private initPeerWithRetry(peer: PeerConfig): void {
        const sync = new PeerSync(peer, this.replicasRootDir, this.intervalMs, this.batchSize);
        const attempt = async (): Promise<void> => {
            if (this.stopped) return;
            try {
                await sync.init();
                sync.start();
                this.peerSyncs.push(sync);
                console.log(`[ULP Replication] Peer registered: ${peer.url}`);
            } catch (err) {
                console.error(
                    `[ULP Replication] Failed to initialize peer ${peer.url} (retrying in ${this.intervalMs}ms):`,
                    err instanceof Error ? err.message : err
                );
                const timer = setTimeout(() => void attempt(), this.intervalMs);
                timer.unref();
                this.initTimers.push(timer);
            }
        };
        void attempt();
    }

    stop(): void {
        this.stopped = true;
        this.initTimers.forEach(t => clearTimeout(t));
        this.peerSyncs.forEach(s => s.stop());
    }

    getStatus(): ReplicaMeta[] {
        return this.peerSyncs.map(s => s.getStatus()).filter((m): m is ReplicaMeta => m !== null);
    }
}

/**
 * 保持している特定peerのレプリカ台帳を読み込む(GET /ulp/v1/replicas/:node_id/envelopes 用)。
 */
export function loadReplicaLedger(replicasRootDir: string, nodeId: string): LedgerEntry[] {
    const p = ledgerPath(path.join(replicasRootDir, nodeId));
    if (!fs.existsSync(p)) return [];
    return fs
        .readFileSync(p, 'utf-8')
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => JSON.parse(line));
}

/** 保持している全レプリカのnode_id一覧 */
export function listReplicaNodeIds(replicasRootDir: string): string[] {
    if (!fs.existsSync(replicasRootDir)) return [];
    return fs
        .readdirSync(replicasRootDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('_pending_'))
        .map(d => d.name);
}
