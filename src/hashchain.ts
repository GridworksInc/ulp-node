// src/hashchain.ts — ULP Hash Chain (spec/HASHCHAIN.md 準拠の共通ロジック)
//
// server.ts (Node本体) と auditor.ts (CLI監査ツール) の両方から参照される。
// ハッシュ計算ロジックを1箇所に集約し、実装間の不整合を防ぐ。
import crypto from 'crypto';

/**
 * Canonical JSON — spec/PROTOCOL.md §6 準拠
 * - キーをコードポイント順でソート
 * - 余分な空白なし
 */
export function canonicalJson(obj: any): string {
    if (obj === null || obj === undefined) return 'null';
    if (typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

/**
 * hash = SHA-256( canonical_json(payload) + (parent_hash || "null") )
 * spec/HASHCHAIN.md §Hash Algorithm 準拠
 */
export function calculateHash(payload: any, parentHash: string | null): string {
    const data = canonicalJson(payload) + (parentHash ?? 'null');
    return crypto.createHash('sha256').update(data).digest('hex');
}

export interface LedgerEntry {
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

export interface AuditResult {
    valid: boolean;
    total: number;
    violation?: {
        violation_at: number;
        envelope_id: string;
        expected_parent_hash?: string | null;
        found_parent_hash?: string | null;
        expected_hash?: string;
        found_hash?: string;
    };
}

/**
 * 台帳全体の整合性検証 — spec/HASHCHAIN.md §Audit Process 準拠
 */
export function auditLedger(ledger: LedgerEntry[]): AuditResult {
    let previousHash: string | null = null;
    for (let i = 0; i < ledger.length; i++) {
        const entry = ledger[i];
        const expectedHash = calculateHash(entry.payload, entry.parent_hash);
        if (entry.parent_hash !== previousHash) {
            return {
                valid: false,
                total: ledger.length,
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
                valid: false,
                total: ledger.length,
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

/**
 * ledger.jsonl (JSON Lines) を読み込んでLedgerEntry配列にする。
 * server.tsとauditor.tsで共通。
 */
export function parseLedgerFile(raw: string): LedgerEntry[] {
    return raw
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => JSON.parse(line));
}
