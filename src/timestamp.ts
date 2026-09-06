// src/timestamp.ts — RFC 3161 Time-Stamp Protocol (TSP) クライアント
//
// アマノ(セイコーソリューションズ)等、RFC3161準拠の第三者タイムスタンプ局(TSA)に対して
// タイムスタンプトークン(TST)を要求する。
//
// 規模(1日あたり数千万〜億件のEnvelope)を想定し、Envelope単位ではなく
// ハッシュチェーンの head_hash に対して定期的に1回だけリクエストする設計とする
// (src/timestampScheduler.ts)。個々のEnvelopeの存在証明はハッシュチェーンの
// parent_hash リンクを辿ることで担保され、TSAは「その時点でチェーン先頭が
// 確かに存在した」という定点証明のみを与える。
import crypto from 'crypto';
import { AsnParser, AsnSerializer, OctetString } from '@peculiar/asn1-schema';
import { AlgorithmIdentifier } from '@peculiar/asn1-x509';
import { MessageImprint, PKIStatus, TimeStampReq, TimeStampResp } from '@peculiar/asn1-tsp';

const SHA256_OID = '2.16.840.1.101.3.4.2.1';

export interface TsaConfig {
    url: string;
    username?: string;
    password?: string;
    /** TSAが要求するポリシーOID (アマノ等、契約時に案内されるものを設定) */
    policyOid?: string;
    timeoutMs?: number;
}

/**
 * 環境変数からTSA設定を読み込む。ULP_TSA_URL未設定なら null (機能無効)。
 */
export function loadTsaConfigFromEnv(): TsaConfig | null {
    const url = process.env.ULP_TSA_URL;
    if (!url) return null;
    return {
        url,
        username: process.env.ULP_TSA_USERNAME,
        password: process.env.ULP_TSA_PASSWORD,
        policyOid: process.env.ULP_TSA_POLICY_OID,
        timeoutMs: parseInt(process.env.ULP_TSA_TIMEOUT_MS || '10000', 10),
    };
}

export interface TimestampResult {
    /** DER-encoded TimeStampToken (RFC3161 ContentInfo/SignedData) */
    token: Buffer;
    nonce: string;
    obtainedAt: string;
}

function randomNonce(): bigint {
    // RFC3161のnonceは任意長INTEGER。リプレイ検知に十分な128bitのランダム値を使う。
    const bytes = crypto.randomBytes(16);
    bytes[0] &= 0x7f; // 正のINTEGERとして解釈させるため最上位ビットを落とす
    return BigInt('0x' + bytes.toString('hex'));
}

function bigIntToArrayBuffer(value: bigint): ArrayBuffer {
    let hex = value.toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    const buf = Buffer.from(hex, 'hex');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * RFC3161 TimeStampReq (DER) を構築する。
 * hash は対象データ(ここでは台帳の head_hash)のSHA-256ダイジェスト(32byte)。
 */
export function buildTimestampRequest(hash: Buffer, policyOid?: string): { der: Buffer; nonce: bigint } {
    const nonce = randomNonce();
    const req = new TimeStampReq({
        version: 1,
        messageImprint: new MessageImprint({
            hashAlgorithm: new AlgorithmIdentifier({ algorithm: SHA256_OID, parameters: null }),
            hashedMessage: new OctetString(new Uint8Array(hash)),
        }),
        reqPolicy: policyOid,
        nonce: bigIntToArrayBuffer(nonce),
        certReq: true, // TSA証明書をトークンに含めてもらう(検証時に必要)
    });
    return { der: Buffer.from(AsnSerializer.serialize(req)), nonce };
}

/**
 * TSAにタイムスタンプを要求する。
 *
 * NOTE: TSTInfo(トークン内部のnonce/ハッシュ)の突き合わせ検証は未実装。
 * 本番導入時は AsnParser で TimeStampToken (CMS SignedData) の eContent から
 * TSTInfo を取り出し、messageImprint と nonce が一致することを検証すること。
 */
export async function requestTimestamp(hash: Buffer, config: TsaConfig): Promise<TimestampResult> {
    const { der, nonce } = buildTimestampRequest(hash, config.policyOid);

    const headers: Record<string, string> = { 'Content-Type': 'application/timestamp-query' };
    if (config.username) {
        const basic = Buffer.from(`${config.username}:${config.password ?? ''}`).toString('base64');
        headers['Authorization'] = `Basic ${basic}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);

    let res: Response;
    try {
        res = await fetch(config.url, {
            method: 'POST',
            headers,
            body: new Uint8Array(der),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }

    if (!res.ok) {
        throw new Error(`TSA request failed: HTTP ${res.status}`);
    }

    const responseBuf = Buffer.from(await res.arrayBuffer());
    const resp = AsnParser.parse(responseBuf, TimeStampResp);

    if (resp.status.status !== PKIStatus.granted && resp.status.status !== PKIStatus.grantedWithMods) {
        const reason = resp.status.statusString?.join('; ') ?? `PKIStatus=${resp.status.status}`;
        throw new Error(`TSA rejected timestamp request: ${reason}`);
    }
    if (!resp.timeStampToken) {
        throw new Error('TSA response missing timeStampToken');
    }

    return {
        token: Buffer.from(AsnSerializer.serialize(resp.timeStampToken)),
        nonce: nonce.toString(),
        obtainedAt: new Date().toISOString(),
    };
}
