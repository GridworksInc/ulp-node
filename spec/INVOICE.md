# ULP Invoice Payload Schema

## Overview

The Invoice payload represents a commercial invoice exchanged between two organizations. It is designed to be:

- Compatible with Japan's インボイス制度 (Qualified Invoice System)
- Mappable to Peppol BIS Billing 3.0
- Sufficient for 電子帳簿保存法 (Electronic Bookkeeping Law) compliance

## Schema

```json
{
  "invoice_id": "INV-2026-0001",
  "status": "issued",
  "sender": {
    "name": "株式会社グリッドワークス",
    "registration_number": "T1234567890123",
    "address": {
      "country": "JP",
      "postal_code": "100-0001",
      "region": "東京都",
      "city": "千代田区",
      "line": "丸の内1-1-1"
    },
    "contact": {
      "email": "billing@gridworks.co.jp",
      "phone": "03-1234-5678"
    }
  },
  "receiver": {
    "name": "株式会社サンプル",
    "registration_number": "T9876543210987",
    "address": {
      "country": "JP",
      "postal_code": "150-0001",
      "region": "東京都",
      "city": "渋谷区",
      "line": "渋谷2-2-2"
    }
  },
  "issue_date": "2026-04-06",
  "due_date": "2026-05-06",
  "currency": "JPY",
  "lines": [
    {
      "line_number": 1,
      "description": "システム開発 2026年3月分",
      "quantity": 1,
      "unit": "式",
      "unit_price": 500000,
      "amount": 500000,
      "tax_category": "standard",
      "tax_rate": 10
    },
    {
      "line_number": 2,
      "description": "サーバー費用",
      "quantity": 1,
      "unit": "式",
      "unit_price": 30000,
      "amount": 30000,
      "tax_category": "standard",
      "tax_rate": 10
    }
  ],
  "tax_summary": [
    {
      "tax_category": "standard",
      "tax_rate": 10,
      "taxable_amount": 530000,
      "tax_amount": 53000
    }
  ],
  "subtotal": 530000,
  "tax_total": 53000,
  "total": 583000,
  "payment": {
    "method": "bank_transfer",
    "bank_name": "三菱UFJ銀行",
    "branch_name": "丸の内支店",
    "account_type": "普通",
    "account_number": "1234567",
    "account_holder": "カ）グリッドワークス"
  },
  "notes": "毎度ありがとうございます。"
}
```

## Field Definitions

### Root Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `invoice_id` | string | Yes | Unique invoice number |
| `status` | string | Yes | `"draft"`, `"issued"`, `"paid"`, `"cancelled"` |
| `sender` | object | Yes | Invoice issuer (see Party) |
| `receiver` | object | Yes | Invoice recipient (see Party) |
| `issue_date` | string | Yes | Issue date (ISO 8601: `YYYY-MM-DD`) |
| `due_date` | string | Yes | Payment due date (ISO 8601) |
| `currency` | string | Yes | ISO 4217 currency code (`"JPY"`, `"USD"`, etc.) |
| `lines` | array | Yes | Invoice line items (min 1) |
| `tax_summary` | array | Yes | Tax breakdown by category/rate |
| `subtotal` | number | Yes | Sum of all line amounts (before tax) |
| `tax_total` | number | Yes | Total tax amount |
| `total` | number | Yes | Grand total (subtotal + tax_total) |
| `payment` | object | No | Payment instructions |
| `notes` | string | No | Free-text notes |

### Party Object (sender / receiver)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Legal entity name |
| `registration_number` | string | No | Tax registration number (JP: 適格請求書発行事業者登録番号 Txxxxxxxxxxxx) |
| `address` | object | No | Address |
| `address.country` | string | Yes | ISO 3166-1 alpha-2 (`"JP"`) |
| `address.postal_code` | string | No | Postal code |
| `address.region` | string | No | Prefecture / State |
| `address.city` | string | No | City |
| `address.line` | string | No | Street address |
| `contact` | object | No | Contact information |
| `contact.email` | string | No | Email address |
| `contact.phone` | string | No | Phone number |

### Line Item

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `line_number` | integer | Yes | Sequential line number (starting from 1) |
| `description` | string | Yes | Item description |
| `quantity` | number | Yes | Quantity |
| `unit` | string | No | Unit of measure (`"個"`, `"式"`, `"時間"`, `"kg"`, etc.) |
| `unit_price` | number | Yes | Price per unit |
| `amount` | number | Yes | Line total (quantity x unit_price) |
| `tax_category` | string | Yes | Tax category (see below) |
| `tax_rate` | number | Yes | Tax rate as percentage (e.g., `10` for 10%) |

### Tax Categories

| Category | Description | Typical Rate (JP) |
|----------|-------------|-------------------|
| `standard` | Standard rate / 標準税率 | 10% |
| `reduced` | Reduced rate / 軽減税率 | 8% |
| `exempt` | Tax exempt / 非課税 | 0% |
| `zero` | Zero-rated / 免税 | 0% |
| `outside_scope` | Outside scope / 不課税 | — |

### Tax Summary

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tax_category` | string | Yes | Tax category |
| `tax_rate` | number | Yes | Tax rate (%) |
| `taxable_amount` | number | Yes | Sum of line amounts for this category |
| `tax_amount` | number | Yes | Calculated tax for this category |

### Payment

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | string | Yes | `"bank_transfer"`, `"credit_card"`, `"direct_debit"`, `"cash"` |
| `bank_name` | string | No | Bank name |
| `branch_name` | string | No | Branch name |
| `account_type` | string | No | `"普通"`, `"当座"` / `"savings"`, `"checking"` |
| `account_number` | string | No | Account number |
| `account_holder` | string | No | Account holder name (カナ) |

## Amount Precision

- For `JPY`: Amounts are integers (no decimal places)
- For `USD`, `EUR`, etc.: Amounts may have up to 2 decimal places
- Tax calculations should round to the nearest integer for JPY

## Compatibility

### Japan インボイス制度

ULP Invoice satisfies all requirements of the Qualified Invoice System:

1. 適格請求書発行事業者の氏名又は名称 → `sender.name`
2. 登録番号 → `sender.registration_number`
3. 取引年月日 → `issue_date`
4. 取引内容 → `lines[].description`
5. 税率ごとの合計額 → `tax_summary[]`
6. 税率ごとの消費税額 → `tax_summary[].tax_amount`
7. 書類の交付を受ける事業者の氏名又は名称 → `receiver.name`

### Peppol BIS Billing 3.0

Core fields map directly to Peppol:

| ULP Field | Peppol BT |
|-----------|-----------|
| `invoice_id` | BT-1 Invoice number |
| `issue_date` | BT-2 Invoice issue date |
| `due_date` | BT-9 Payment due date |
| `currency` | BT-5 Invoice currency code |
| `sender.name` | BT-27 Seller name |
| `receiver.name` | BT-44 Buyer name |
| `total` | BT-112 Invoice total amount with VAT |
