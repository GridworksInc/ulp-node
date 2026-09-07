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
npm run build

# Run the node (default port 4800)
npm start

# Send a test envelope
curl -X POST http://localhost:4800/ulp/v1/envelope \
  -H "Content-Type: application/json" \
  -d '{
    "envelope_type": "invoice",
    "payload": {
      "invoice_id": "INV-001",
      "amount": 50000,
      "currency": "JPY",
      "issue_date": "2026-04-06",
      "due_date": "2026-05-06"
    },
    "sender": { "id": "company-a", "name": "Company A" },
    "receiver": { "id": "company-b", "name": "Company B" }
  }'

# Check node info (no auth required)
curl http://localhost:4800/ulp/v1/info

# Audit the ledger via HTTP
curl http://localhost:4800/ulp/v1/ledger/audit

# ...or audit the ledger file directly, without a running server
npm run audit

# List third-party (TSA) timestamps obtained for the ledger head
# (empty unless ULP_TSA_URL is configured)
curl http://localhost:4800/ulp/v1/ledger/timestamps
```

### Configuration

The node is configured entirely via environment variables:

| Variable | Default | Description |
|----------|---------|--------------|
| `ULP_PORT` | `4800` | HTTP port to listen on |
| `ULP_DATA_DIR` | `./data` | Directory holding `ledger.jsonl` |
| `ULP_API_KEY` | *(unset)* | Bearer token required on all endpoints except `/ulp/v1/info`. **Required when `NODE_ENV=production`** — the node refuses to start without it. |
| `ULP_RATE_LIMIT_PER_MIN` | `300` | Requests per minute per client, before `429`/`RATE_LIMITED` |
| `ULP_MAX_BODY_SIZE` | `256kb` | Max JSON request body size |
| `ULP_NODE_ID` / `ULP_NODE_NAME` | *(staging defaults)* | Identity reported at `/ulp/v1/info` |
| `ULP_TSA_URL` | *(unset)* | RFC 3161 Time-Stamp Authority endpoint (e.g. Amano/Seiko Solutions). Unset disables third-party timestamping entirely. |
| `ULP_TSA_USERNAME` / `ULP_TSA_PASSWORD` | *(unset)* | Basic auth credentials for the TSA, if required |
| `ULP_TSA_POLICY_OID` | *(unset)* | TSA policy OID, if the TSA requires one |
| `ULP_TSA_INTERVAL_MS` | `60000` | How often to timestamp the current ledger head (see [spec/HASHCHAIN.md](spec/HASHCHAIN.md#third-party-timestamping-tsa)) |
| `ULP_PEERS` | *(unset)* | Comma-separated peer nodes to replicate (e.g. a DR node, or a customer's own node). Each entry is `url` or `url\|api_key`. Unset disables replication entirely. See [spec/REPLICATION.md](spec/REPLICATION.md). |
| `ULP_PEER_SYNC_INTERVAL_MS` | `5000` | Polling interval per peer |
| `ULP_PEER_SYNC_BATCH_SIZE` | `200` | Envelopes fetched per replication request |
| `ULP_MAX_LIST_LIMIT` | `200` | Server-side cap on `limit` for envelope listing endpoints (raise on nodes serving high-volume replication) |

## Documentation

- **[Protocol Specification](spec/PROTOCOL.md)** — Full technical specification
- **[Envelope Format](spec/ENVELOPE.md)** — Document envelope schema
- **[Invoice Schema](spec/INVOICE.md)** — Invoice payload definition
- **[Hash Chain](spec/HASHCHAIN.md)** — Integrity verification mechanism
- **[API Reference](spec/API.md)** — HTTP endpoint specification
- **[Node Replication](spec/REPLICATION.md)** — Multi-node (DR / customer-hosted) synchronization

## Architecture

A single ULP node exposes an HTTP API and maintains an append-only, hash-chained ledger. Any two systems can exchange documents through it without knowing anything about each other's internals:

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  System A    │         │  ULP Node   │         │  System B    │
│ (Worksgrid)  │──POST──▶│             │──POST──▶│ (Any ERP)   │
│              │◀─────── │             │ ◀───────│              │
└─────────────┘  hash   └──────┬──────┘  hash   └─────────────┘
                               │
                        ┌──────▼──────┐
                        │   Ledger    │
                        │ (Hash Chain)│
                        └─────────────┘
```

`src/server.ts` implements the full node: it accepts envelopes, appends them to `data/ledger.jsonl`, and serves lookup/audit endpoints. `src/hashchain.ts` holds the canonical-JSON and hash-chain logic shared by the server and the standalone `src/auditor.ts` CLI tool.

Multiple nodes (e.g. a production node and a DR node, or independently-operated customer nodes) can replicate each other via `ULP_PEERS` — each keeps writing only to its own chain and pulls verified, read-only copies of its peers'. See [spec/REPLICATION.md](spec/REPLICATION.md) for why this scales to national-scale transaction volume without needing distributed consensus.

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
