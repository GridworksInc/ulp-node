# Universal Ledger Protocol (ULP)

**An open protocol for secure, standardized business document exchange.**

ULP enables any accounting system, ERP, or SaaS to exchange invoices (and other business documents) without CSV conversion, manual entry, or proprietary integrations. Think of it as **HTTP for accounting** — a universal transport layer for business documents.

## Why ULP?

Today, exchanging invoices between systems requires:
- CSV export → manual mapping → import
- Proprietary API integrations per vendor
- EDI systems that cost millions to implement

ULP solves this with:
- **One open format** any system can implement
- **Hash-chain integrity** (Git-style, not blockchain — zero energy waste)
- **Envelope architecture** that carries any document type
- **Cryptographic proof** that documents haven't been tampered with

## Quick Start

```bash
# Install
npm install

# Build
npx tsc

# Run gateway node (port 3000)
node dist/server.js

# Run receiver node (port 3001)
node dist/receiver.js

# Send a test invoice
curl -X POST http://localhost:3000/api/send-invoice \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": "INV-001",
    "sender_id": "company-a",
    "receiver_id": "company-b",
    "amount": 50000,
    "currency": "JPY",
    "issue_date": "2026-04-06",
    "due_date": "2026-05-06"
  }'

# Audit the ledger
node dist/auditor.js
```

## Documentation

- **[Protocol Specification](spec/PROTOCOL.md)** — Full technical specification
- **[Envelope Format](spec/ENVELOPE.md)** — Document envelope schema
- **[Invoice Schema](spec/INVOICE.md)** — Invoice payload definition
- **[Hash Chain](spec/HASHCHAIN.md)** — Integrity verification mechanism
- **[API Reference](spec/API.md)** — HTTP endpoint specification

## Architecture

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  System A    │         │  ULP Node   │         │  System B    │
│ (Worksgrid)  │──POST──▶│  (Gateway)  │──POST──▶│ (Any ERP)   │
│              │◀─────── │             │ ◀───────│              │
└─────────────┘  hash   └──────┬──────┘  hash   └─────────────┘
                               │
                        ┌──────▼──────┐
                        │   Ledger    │
                        │ (Hash Chain)│
                        └─────────────┘
```

## Design Principles

1. **Open** — MIT licensed, no vendor lock-in
2. **Simple** — Any developer can implement a client in a day
3. **Secure** — Hash-chain integrity, digital signatures
4. **Lightweight** — No blockchain, no mining, no consensus overhead
5. **Extensible** — Envelope carries invoices today, any document tomorrow

## License

MIT

## Contributing

ULP is an open protocol. Contributions, implementations in other languages, and feedback are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
