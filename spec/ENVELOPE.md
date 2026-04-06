# ULP Envelope Format

## Envelope Structure

Every document transmitted via ULP is wrapped in an Envelope.

```json
{
  "ulp_version": "ULP/1.0",
  "envelope_id": "550e8400-e29b-41d4-a716-446655440000",
  "envelope_type": "invoice",
  "payload": {
    // Document-specific fields (see schema for each type)
  },
  "sender": {
    "id": "org-gridworks-001",
    "name": "Gridworks Inc.",
    "signature": "a1b2c3d4..."
  },
  "receiver": {
    "id": "org-acme-001",
    "name": "Acme Corp."
  },
  "parent_hash": "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
  "timestamp": "2026-04-06T10:30:00+09:00",
  "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

## Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ulp_version` | string | Yes | Protocol version. Currently `"ULP/1.0"` |
| `envelope_id` | string | Yes | Unique identifier (UUID v4 recommended) |
| `envelope_type` | string | Yes | Document type: `"invoice"`, `"estimate"`, etc. |
| `payload` | object | Yes | The document data. Schema depends on `envelope_type` |
| `sender` | object | Yes | Sender identification and signature |
| `sender.id` | string | Yes | Unique sender organization identifier |
| `sender.name` | string | Yes | Human-readable sender name |
| `sender.signature` | string | No | Ed25519 signature of `canonical_json(payload)` |
| `receiver` | object | Yes | Receiver identification |
| `receiver.id` | string | Yes | Unique receiver organization identifier |
| `receiver.name` | string | Yes | Human-readable receiver name |
| `parent_hash` | string \| null | Yes | SHA-256 hash of the previous envelope. `null` for genesis |
| `timestamp` | string | Yes | ISO 8601 datetime with timezone |
| `hash` | string | Yes | SHA-256 hash of this envelope (see Hash Calculation) |

## Envelope Type Registry

| Type | Payload Schema | Description |
|------|---------------|-------------|
| `invoice` | [INVOICE.md](INVOICE.md) | 請求書 / Invoice |
| `estimate` | (planned) | 見積書 / Estimate |
| `receipt` | (planned) | 領収書 / Receipt |
| `purchase_order` | (planned) | 注文書 / Purchase Order |
| `credit_note` | (planned) | クレジットノート / Credit Note |
| `delivery_note` | (planned) | 納品書 / Delivery Note |
| `payment_notice` | (planned) | 支払通知 / Payment Notice |

## Extensibility

The `envelope_type` field is an open string. Organizations may define custom types prefixed with their namespace:

```json
{
  "envelope_type": "x-gridworks.timesheet"
}
```

Custom types MUST be prefixed with `x-` followed by the organization identifier.

## Hash Calculation

```
hash = SHA-256( canonical_json(payload) + (parent_hash || "null") )
```

The hash covers only the `payload` and `parent_hash`. This means:
- The payload cannot be modified without breaking the chain
- The ordering of envelopes cannot be rearranged
- Metadata fields (`sender`, `receiver`, `timestamp`) are NOT covered by the hash — they are informational

## Validation Rules

A valid envelope MUST:

1. Have `ulp_version` set to a recognized version string
2. Have a non-empty `envelope_id` that is unique within the ledger
3. Have `envelope_type` matching a known or custom type
4. Have a `payload` object conforming to the schema for its type
5. Have a `hash` that matches the recalculated hash
6. Have `parent_hash` matching the `hash` of the immediately preceding envelope (or `null` for first)
7. Have a valid ISO 8601 `timestamp`
