# ULP Protocol Specification v1.0

**Universal Ledger Protocol — Technical Specification**

Status: Draft
Version: 1.0.0
Date: 2026-04-06

---

## 1. Overview

The Universal Ledger Protocol (ULP) defines a standard for exchanging business documents (invoices, receipts, purchase orders, etc.) between any two systems over HTTP. Documents are wrapped in a cryptographically-linked envelope that provides tamper detection and an immutable audit trail.

ULP uses a **hash-chain** (similar to Git commits) — not a blockchain. There is no mining, no proof-of-work, and no consensus mechanism. This makes ULP:

- **Fast**: Transactions are confirmed immediately
- **Free**: No transaction fees or gas costs
- **Green**: Near-zero energy consumption
- **Simple**: Implementable in any language in hours

## 2. Core Concepts

### 2.1 Envelope

Every document transmitted via ULP is wrapped in an **Envelope**:

```json
{
  "ulp_version": "ULP/1.0",
  "envelope_id": "uuid-v4",
  "envelope_type": "invoice",
  "payload": { ... },
  "sender": {
    "id": "string",
    "name": "string",
    "signature": "hex-string"
  },
  "receiver": {
    "id": "string",
    "name": "string"
  },
  "parent_hash": "sha256-hex | null",
  "timestamp": "ISO-8601",
  "hash": "sha256-hex"
}
```

### 2.2 Hash Chain

Each envelope contains a `parent_hash` field referencing the hash of the previous envelope in the ledger. The first envelope (genesis) has `parent_hash: null`.

```
Envelope #1          Envelope #2          Envelope #3
┌──────────┐        ┌──────────┐        ┌──────────┐
│ parent:  │        │ parent:  │        │ parent:  │
│  null    │◄───────│  hash1   │◄───────│  hash2   │
│ hash1    │        │ hash2    │        │ hash3    │
└──────────┘        └──────────┘        └──────────┘
```

This creates an **append-only, tamper-evident log**. If any envelope is modified, all subsequent hashes become invalid.

### 2.3 Hash Calculation

The hash of an envelope is calculated as:

```
hash = SHA-256( canonical_json(payload) + parent_hash )
```

Where:
- `canonical_json()` produces deterministic JSON (keys sorted alphabetically, no whitespace)
- `parent_hash` is the hex string of the parent's hash, or the string `"null"` for genesis
- The result is a lowercase hex-encoded SHA-256 digest (64 characters)

### 2.4 Envelope Types

ULP supports multiple document types via the `envelope_type` field:

| Type | Description | Status |
|------|-------------|--------|
| `invoice` | Invoice / 請求書 | Specified |
| `estimate` | Estimate / Quote / 見積書 | Planned |
| `receipt` | Receipt / 領収書 | Planned |
| `purchase_order` | Purchase Order / 注文書 | Planned |
| `credit_note` | Credit Note / クレジットノート | Planned |
| `delivery_note` | Delivery Note / 納品書 | Planned |

## 3. Transport

### 3.1 HTTP

ULP uses HTTP POST for document transmission. Every ULP node MUST implement:

```
POST /ulp/v1/envelope
```

Request body: A valid ULP Envelope (JSON)
Response: `{ "status": "ACCEPTED", "hash": "<envelope_hash>" }`

### 3.2 Content Type

All requests and responses use:

```
Content-Type: application/json; charset=utf-8
```

### 3.3 Status Codes

| HTTP Status | ULP Status | Meaning |
|-------------|-----------|---------|
| 200 | `ACCEPTED` | Envelope received and validated |
| 400 | `INVALID_ENVELOPE` | Envelope structure is invalid |
| 400 | `INVALID_HASH` | Hash verification failed |
| 400 | `INVALID_SIGNATURE` | Sender signature verification failed |
| 401 | `UNAUTHORIZED` | Authentication required |
| 409 | `HASH_CONFLICT` | parent_hash doesn't match ledger head |
| 422 | `INVALID_PAYLOAD` | Payload doesn't match envelope_type schema |
| 500 | `INTERNAL_ERROR` | Server error |

### 3.4 Discovery

A ULP node SHOULD expose its capabilities at:

```
GET /ulp/v1/info
```

Response:
```json
{
  "ulp_version": "ULP/1.0",
  "node_id": "string",
  "node_name": "string",
  "supported_types": ["invoice", "estimate"],
  "endpoint": "https://ulp.example.com/ulp/v1/envelope"
}
```

## 4. Authentication

### 4.1 API Key (Simple)

For node-to-node authentication:

```
Authorization: Bearer <api_key>
```

### 4.2 Digital Signature (Recommended)

Each envelope SHOULD be signed by the sender using Ed25519:

1. Sender creates a key pair (public key + private key)
2. Sender signs `canonical_json(payload)` with their private key
3. Signature is included in `sender.signature`
4. Receiver verifies using sender's registered public key

```
signature = Ed25519.sign(private_key, canonical_json(payload))
```

### 4.3 Key Registration

Public keys are exchanged out-of-band (manual registration, or via the `/ulp/v1/info` endpoint).

## 5. Integrity Verification (Audit)

Any party can verify the integrity of a ledger by:

1. Loading all envelopes in order
2. Verifying the first envelope has `parent_hash: null`
3. For each subsequent envelope:
   a. Recalculate the expected hash of the previous envelope
   b. Verify it matches `parent_hash`
4. If all checks pass, the ledger is intact

This is identical to how `git fsck` verifies a Git repository.

## 6. Canonical JSON

To ensure deterministic hash calculation across implementations, ULP defines **Canonical JSON**:

1. Keys are sorted alphabetically (Unicode code point order)
2. No whitespace between tokens
3. Strings use minimal escaping (only `"`, `\`, and control characters)
4. Numbers use no unnecessary leading zeros or trailing zeros
5. No trailing commas

Example:
```json
{"amount":50000,"currency":"JPY","due_date":"2026-05-06","invoice_id":"INV-001","issue_date":"2026-04-06"}
```

## 7. Versioning

The protocol version is indicated by `ulp_version` in every envelope. The current version is `ULP/1.0`.

Breaking changes increment the major version. Non-breaking additions increment the minor version.

## 8. Security Considerations

- **Hash chain is tamper-evident, not tamper-proof**: A malicious node operator could rewrite their entire ledger. Digital signatures provide stronger guarantees.
- **Transport security**: All ULP traffic SHOULD use HTTPS in production.
- **Payload privacy**: ULP envelopes are not encrypted. For sensitive documents, use TLS for transport encryption.
- **Key management**: Private keys must never be transmitted. Compromised keys should be revoked immediately.

## 9. Compliance

ULP is designed to be compatible with:

- **Peppol** (Pan-European Public Procurement Online) — Invoice format can be mapped
- **JP PINT** (Japan Peppol Invoice) — Japanese invoice standard
- **電子帳簿保存法** — Japanese electronic bookkeeping law
- **インボイス制度** — Japan's qualified invoice system

## 10. Reference Implementation

A TypeScript reference implementation is available at:

https://github.com/GridworksInc/ulp-node

Implementations in other languages are encouraged.
