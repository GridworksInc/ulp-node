// src/index.ts
import crypto from 'crypto';

export interface ULPPacket {
    ulp_version: string;
    payload: any;
    parent_hash: string | null;
    timestamp: number;
}

// 共通のハッシュ計算ロジック
export const calculateHash = (packet: ULPPacket): string => {
    const dataToHash = JSON.stringify(packet.payload) + packet.parent_hash;
    return crypto.createHash('sha256').update(dataToHash).digest('hex');
};

export const createPacket = (parentHash: string | null, data: any): ULPPacket => {
    return {
        ulp_version: 'ULP/1.0',
        payload: data,
        parent_hash: parentHash,
        timestamp: Date.now(),
    };
};
