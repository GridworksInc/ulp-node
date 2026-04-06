# ULP Hash Chain

## Overview

ULP uses a **hash chain** to ensure the integrity of the document ledger. This is the same mechanism Git uses for commits — each entry references the hash of the previous entry, creating an immutable, tamper-evident sequence.

**This is NOT a blockchain.** There is no mining, no proof-of-work, no consensus algorithm, and no distributed ledger. The hash chain runs on a single node with near-zero computational overhead.

## How It Works

### 1. Genesis Envelope

The first envelope in a ledger has `parent_hash: null`:

```
Envelope #1:
  payload: { invoice_id: "INV-001", ... }
  parent_hash: null
  hash: SHA-256(canonical_json(payload) + "null")
      = "a7f4d2c9..."
```

### 2. Subsequent Envelopes

Each new envelope references the hash of the previous one:

```
Envelope #2:
  payload: { invoice_id: "INV-002", ... }
  parent_hash: "a7f4d2c9..."    ← hash of Envelope #1
  hash: SHA-256(canonical_json(payload) + "a7f4d2c9...")
      = "b2e9c8f7..."
```

### 3. Chain Visualization

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Envelope #1 │     │ Envelope #2 │     │ Envelope #3 │
│             │     │             │     │             │
│ parent:null │◄────│ parent:aaa  │◄────│ parent:bbb  │
│ hash: aaa   │     │ hash: bbb   │     │ hash: ccc   │
│             │     │             │     │             │
│ INV-001     │     │ INV-002     │     │ INV-003     │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Hash Algorithm

```
hash = SHA-256( canonical_json(payload) + parent_hash_string )
```

### Implementation (TypeScript)

```typescript
import crypto from 'crypto';

function calculateHash(payload: object, parentHash: string | null): string {
  const data = canonicalJson(payload) + (parentHash ?? 'null');
  return crypto.createHash('sha256').update(data).digest('hex');
}
```

### Implementation (PHP)

```php
function calculateHash(array $payload, ?string $parentHash): string {
    $data = canonicalJson($payload) . ($parentHash ?? 'null');
    return hash('sha256', $data);
}
```

### Implementation (Python)

```python
import hashlib, json

def calculate_hash(payload: dict, parent_hash: str | None) -> str:
    data = canonical_json(payload) + (parent_hash or 'null')
    return hashlib.sha256(data.encode()).hexdigest()
```

## Canonical JSON

To ensure the same payload produces the same hash in every language:

```typescript
function canonicalJson(obj: any): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}
```

Rules:
- Keys sorted alphabetically (Unicode code point order)
- No extra whitespace
- Numbers as-is (no unnecessary precision)

## Tamper Detection

If an attacker modifies Envelope #2's payload:

```
Original:  hash2 = SHA-256(payload2 + hash1) = "bbb"
Tampered:  hash2' = SHA-256(payload2' + hash1) = "xxx"  ← different!

Envelope #3 expects parent_hash = "bbb"
Envelope #3 finds  parent_hash = "xxx"
→ CHAIN BROKEN → TAMPER DETECTED
```

The attacker would need to recalculate every subsequent hash to maintain the chain — and any independent copy of the ledger would still have the original hashes.

## Audit Process

```
1. Load all envelopes in chronological order
2. Assert: envelope[0].parent_hash === null
3. For i = 1 to N:
   a. expected = calculateHash(envelope[i-1].payload, envelope[i-1].parent_hash)
   b. Assert: envelope[i].parent_hash === expected
4. If all assertions pass → INTEGRITY CONFIRMED
5. If any assertion fails → TAMPER DETECTED at position i
```

## Comparison with Other Approaches

| Feature | ULP Hash Chain | Blockchain | Database |
|---------|---------------|------------|----------|
| Tamper detection | Yes | Yes | No |
| Energy consumption | Near zero | Very high | Near zero |
| Speed | Instant | Minutes | Instant |
| Decentralized | No (by design) | Yes | No |
| Complexity | Very low | Very high | Low |
| Audit trail | Built-in | Built-in | Manual |

## Why Not Blockchain?

Blockchain solves the problem of **trustless consensus among strangers**. ULP operates in a different context:

- The node operator is a **known, trusted party** (the service provider)
- Participants are **identified businesses**, not anonymous actors
- The goal is **tamper evidence**, not trustless consensus
- Digital signatures provide **non-repudiation** without consensus

Using a blockchain for B2B invoice exchange would be like using a nuclear reactor to charge a phone — technically possible, but wildly disproportionate to the problem.
