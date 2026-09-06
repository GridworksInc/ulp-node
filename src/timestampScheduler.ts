// src/timestampScheduler.ts — head_hash への定期タイムスタンプ付与
//
// Envelope単位ではなく、一定間隔ごとに台帳先頭(head_hash)へ1回だけTSAリクエストを
// 送ることで、Envelopeの流量(1日あたり億件規模を想定)に依存しないコスト・
// レイテンシに抑える。取得結果は timestamps.jsonl に追記していく。
import fs from 'fs';
import { TsaConfig, requestTimestamp } from './timestamp';

export interface TimestampRecord {
    /** この時点までに台帳へ記録されていたEnvelope件数 (= head_hashのsequence) */
    sequence: number;
    head_hash: string;
    /** DER-encoded TimeStampToken (base64) */
    token: string;
    nonce: string;
    requested_at: string;
}

export interface LedgerHead {
    hash: string | null;
    sequence: number;
}

export class TimestampScheduler {
    private timer: NodeJS.Timeout | null = null;
    private lastStampedHash: string | null = null;
    private running = false;

    constructor(
        private readonly config: TsaConfig,
        private readonly intervalMs: number,
        private readonly recordsPath: string,
        private readonly getHead: () => LedgerHead,
        private readonly onError: (err: unknown) => void = (err) =>
            console.error('[ULP TSA] Timestamp request failed:', err instanceof Error ? err.message : err),
    ) {}

    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => {
            void this.tick();
        }, this.intervalMs);
        this.timer.unref(); // プロセス終了をブロックしない
        console.log(`[ULP TSA] Scheduler started (interval=${this.intervalMs}ms, tsa=${this.config.url})`);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private async tick(): Promise<void> {
        if (this.running) return; // 前回のリクエストがまだ完了していなければスキップ
        const head = this.getHead();
        if (!head.hash || head.hash === this.lastStampedHash) return; // 新規Envelopeがなければスキップ(TSA課金を節約)

        this.running = true;
        try {
            const result = await requestTimestamp(Buffer.from(head.hash, 'hex'), this.config);
            const record: TimestampRecord = {
                sequence: head.sequence,
                head_hash: head.hash,
                token: result.token.toString('base64'),
                nonce: result.nonce,
                requested_at: result.obtainedAt,
            };
            fs.appendFileSync(this.recordsPath, JSON.stringify(record) + '\n');
            this.lastStampedHash = head.hash;
            console.log(`[ULP TSA] Timestamped head_hash=${head.hash.substring(0, 12)}... (sequence=${head.sequence})`);
        } catch (err) {
            this.onError(err);
            // lastStampedHash は更新しない → 次回tickで同じhead_hashに再試行する
        } finally {
            this.running = false;
        }
    }
}

/**
 * timestamps.jsonl を読み込む(GET /ulp/v1/ledger/timestamps 等で使用)。
 */
export function loadTimestampRecords(path: string): TimestampRecord[] {
    if (!fs.existsSync(path)) return [];
    const data = fs.readFileSync(path, 'utf-8');
    return data
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => JSON.parse(line));
}
