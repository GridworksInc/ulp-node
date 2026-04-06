# ULP API Reference

## Base URL

```
https://{node-host}/ulp/v1
```

## Authentication

All endpoints (except `/info`) require authentication:

```
Authorization: Bearer <api_key>
```

---

## Endpoints

### POST /ulp/v1/envelope

Submit a document envelope to the ledger.

**Request:**

```json
{
  "ulp_version": "ULP/1.0",
  "envelope_id": "550e8400-e29b-41d4-a716-446655440000",
  "envelope_type": "invoice",
  "payload": { ... },
  "sender": {
    "id": "org-gridworks",
    "name": "Gridworks Inc.",
    "signature": "optional-ed25519-hex"
  },
  "receiver": {
    "id": "org-acme",
    "name": "Acme Corp."
  },
  "timestamp": "2026-04-06T10:30:00+09:00"
}
```

Note: `parent_hash` and `hash` are calculated by the node, not the client.

**Response (200):**

```json
{
  "status": "ACCEPTED",
  "envelope_id": "550e8400-e29b-41d4-a716-446655440000",
  "hash": "e3b0c44298fc1c149afbf4c8996fb924...",
  "parent_hash": "7f83b1657ff1fc53b92dc18148a1d65d...",
  "sequence": 42
}
```

**Error Response (400):**

```json
{
  "status": "INVALID_PAYLOAD",
  "message": "Missing required field: invoice_id",
  "field": "payload.invoice_id"
}
```

---

### GET /ulp/v1/envelope/{envelope_id}

Retrieve a specific envelope by ID.

**Response (200):**

```json
{
  "ulp_version": "ULP/1.0",
  "envelope_id": "550e8400-...",
  "envelope_type": "invoice",
  "payload": { ... },
  "sender": { ... },
  "receiver": { ... },
  "parent_hash": "7f83b165...",
  "hash": "e3b0c442...",
  "timestamp": "2026-04-06T10:30:00+09:00",
  "sequence": 42
}
```

---

### GET /ulp/v1/envelopes

List envelopes with optional filters.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sender_id` | string | Filter by sender organization ID |
| `receiver_id` | string | Filter by receiver organization ID |
| `envelope_type` | string | Filter by document type |
| `from` | string | Start date (ISO 8601) |
| `to` | string | End date (ISO 8601) |
| `limit` | integer | Max results (default: 50, max: 200) |
| `offset` | integer | Pagination offset |

**Response (200):**

```json
{
  "envelopes": [ ... ],
  "total": 156,
  "limit": 50,
  "offset": 0
}
```

---

### GET /ulp/v1/ledger/audit

Run integrity audit on the ledger.

**Response (200):**

```json
{
  "status": "INTEGRITY_CONFIRMED",
  "total_envelopes": 156,
  "first_envelope": "2026-01-15T09:00:00+09:00",
  "last_envelope": "2026-04-06T10:30:00+09:00",
  "head_hash": "e3b0c44298fc1c149afbf4c8996fb924..."
}
```

**Response (409 — Tamper Detected):**

```json
{
  "status": "INTEGRITY_VIOLATION",
  "violation_at": 42,
  "expected_parent_hash": "7f83b165...",
  "found_parent_hash": "deadbeef...",
  "envelope_id": "550e8400-..."
}
```

---

### GET /ulp/v1/info

Public endpoint — no authentication required. Returns node information.

**Response (200):**

```json
{
  "ulp_version": "ULP/1.0",
  "node_id": "node-jp-001",
  "node_name": "Gridworks ULP Node",
  "operator": "Gridworks Inc.",
  "supported_types": ["invoice"],
  "total_envelopes": 156,
  "head_hash": "e3b0c44298fc1c149afbf4c8996fb924...",
  "uptime": "30d 4h 22m"
}
```

---

## Webhook (Optional)

Nodes can notify clients of incoming envelopes via webhook:

```
POST {client_webhook_url}
```

```json
{
  "event": "envelope.received",
  "envelope_id": "550e8400-...",
  "envelope_type": "invoice",
  "sender": { "id": "org-acme", "name": "Acme Corp." },
  "hash": "e3b0c442...",
  "timestamp": "2026-04-06T10:30:00+09:00"
}
```

Webhook URLs are registered during client setup.

---

## Rate Limits

| Plan | Requests/min | Envelopes/month |
|------|-------------|-----------------|
| Free | 10 | 100 |
| Standard | 60 | 5,000 |
| Enterprise | 300 | Unlimited |

Rate limit headers:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1680000000
```
