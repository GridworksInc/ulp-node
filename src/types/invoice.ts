/**
 * ULP Universal Ledger Protocol - Invoice Payload Schema v1.0
 * spec/INVOICE.md 準拠
 */

export type TaxCategory = 'standard' | 'reduced' | 'exempt' | 'zero' | 'outside_scope';
export type PaymentMethod = 'bank_transfer' | 'credit_card' | 'direct_debit' | 'cash';
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled';

export interface Address {
    country: string; // ISO 3166-1 alpha-2 (e.g. "JP")
    postal_code?: string;
    region?: string;
    city?: string;
    line?: string;
}

export interface Contact {
    email?: string;
    phone?: string;
}

export interface InvoiceParty {
    name: string;
    registration_number?: string; // JP: 適格請求書発行事業者登録番号 (Txxxxxxxxxxxx)
    address?: Address;
    contact?: Contact;
}

export interface InvoiceLine {
    line_number: number;
    description: string;
    quantity: number;
    unit?: string;
    unit_price: number;
    amount: number;
    tax_category: TaxCategory;
    tax_rate: number;
}

export interface TaxSummaryEntry {
    tax_category: TaxCategory;
    tax_rate: number;
    taxable_amount: number;
    tax_amount: number;
}

export interface PaymentInstructions {
    method: PaymentMethod;
    bank_name?: string;
    branch_name?: string;
    account_type?: string;
    account_number?: string;
    account_holder?: string;
}

export interface InvoicePayload {
    invoice_id: string;
    status: InvoiceStatus;
    sender: InvoiceParty;
    receiver: InvoiceParty;
    issue_date: string; // ISO 8601 (YYYY-MM-DD)
    due_date: string;   // ISO 8601 (YYYY-MM-DD)
    currency: string;   // ISO 4217 (e.g. "JPY")
    lines: InvoiceLine[];
    tax_summary: TaxSummaryEntry[];
    subtotal: number;
    tax_total: number;
    total: number;
    payment?: PaymentInstructions;
    notes?: string;
}
