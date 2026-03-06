/**
 * GBP Global Business Protocol - Invoice Schema v1.0
 * 世界中のあらゆるシステムが解釈可能な「請求書」の標準形式
 */

export interface InvoicePayload {
    invoice_id: string;
    sender_lei: string;
    receiver_lei: string;
    amount: number;
    currency: string;
    issue_date: string; // ISO 8601
    due_date: string;   // ISO 8601
}