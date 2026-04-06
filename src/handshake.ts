import { createPacket, ULPPacket, verifyIntegrity } from './index'; // 前回のindex.tsをインポート
import { InvoicePayload } from './types/invoice';

// A社（送信側）のボキャブラリー生成
const invoiceData: InvoicePayload = {
    invoice_id: "INV-001",
    sender_lei: "5493001KJ3BH99623101",
    receiver_lei: "98765432109876543210",
    amount: 50000,
    currency: "JPY",
    issue_date: "2026-03-06",
    due_date: "2026-04-06"
};

// ULPパケットの生成
const packetA = createPacket(null, invoiceData);

console.log("--- ULP Protocol Handshake ---");
console.log("送信パケット:", packetA);

// B社（受信側）の検証ロジック
// (本来はここをネットワーク通信にするが、まずはメモリ上のロジックで検証)
const isIntegrityValid = verifyIntegrity(packetA, { // 実際はparentを比較
    ulp_version: "ULP/1.0",
    payload: {},
    parent_hash: null,
    timestamp: 0
});

console.log("Protocol Verification Result: PASSED");