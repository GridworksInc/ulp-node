// src/index.ts
import crypto from 'crypto';

export interface GBPPacket {
    gw_protocol: string;
    payload: any;
    parent_hash: string | null;
    timestamp: number;
}

// 共通のハッシュ計算ロジックをここに集約！
export const calculateHash = (packet: GBPPacket): string => {
    const dataToHash = JSON.stringify(packet.payload) + packet.parent_hash;
    return crypto.createHash('sha256').update(dataToHash).digest('hex');
};

export const createPacket = (parentHash: string | null, data: any): GBPPacket => {
    return {
        gw_protocol: 'GBP/1.0',
        payload: data,
        parent_hash: parentHash,
        timestamp: Date.now(),
    };
};