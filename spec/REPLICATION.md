# ULP Node Replication

## Overview

A ULP node can replicate other nodes' ledgers so that multiple nodes — a production/DR pair (`worksp`/`worksd`), or independently-operated customer nodes — end up holding synchronized copies of each other's data, **without** any node ever writing to another node's chain.

This is deliberately *not* a distributed database or blockchain. There is no leader election, no write quorum, no conflict resolution. Each node's chain has exactly one writer (itself); everything else is a read-only, verified replica.

## Why not a shared chain?

At the target scale (up to ~100M envelopes/day across the network, i.e. >1,000/sec sustained), any design where multiple nodes write to the *same* hash chain requires solving distributed consensus: forks must be detected and resolved, a leader (or quorum) must serialize writes, and the resulting coordination overhead caps throughput far below what commercial B2B document exchange at national scale requires.

Giving every node its own chain sidesteps the problem entirely: write throughput scales linearly with the number of nodes, because no node ever waits on another to accept an envelope.

## Model

```
        writes                              writes
   ┌───────────┐                       ┌───────────┐
   │  worksp   │                       │  worksd   │
   │  (chain)  │                       │  (chain)  │
   └─────┬─────┘                       └─────┬─────┘
         │        pull, verify, store         │
         │◀────────────────────────────────────▶
         │        replica of worksd            │
         │        replica of worksp            │
         ▼                                     ▼
  data/replicas/node-worksd/         data/replicas/node-worksp/
    ledger.jsonl (read-only)           ledger.jsonl (read-only)
```

- `worksp` writes only to its own `data/ledger.jsonl`.
- `worksd` writes only to its own `data/ledger.jsonl`.
- Each node additionally *pulls* the other's chain and stores a verified copy under `data/replicas/<peer_node_id>/ledger.jsonl`.
- The same mechanism scales to N nodes (any customer node can be added as a peer of any other), because each replica is independent — there's no shared state to coordinate.

## Sync protocol (pull, incremental)

Push (webhook) delivery was considered and rejected: it's lossy under peer downtime and hard to resume correctly. Pull with an explicit cursor is simple and resumable:

1. On startup, a node resolves each configured peer's `node_id` via `GET /ulp/v1/info`.
2. It loads (or initializes) replication state for that peer: `{ last_sequence, last_hash }`.
3. On a fixed interval (`ULP_PEER_SYNC_INTERVAL_MS`, default 5s), it requests:
   ```
   GET {peer_url}/ulp/v1/envelopes?since_sequence={last_sequence}&limit={batch_size}
   ```
4. For every envelope returned, **before writing anything**, it verifies the whole batch:
   - `entry.parent_hash` must equal the previous entry's `hash` (or the stored `last_hash` for the first entry in the batch)
   - `entry.hash` must equal `calculateHash(entry.payload, entry.parent_hash)` (same logic as `src/hashchain.ts`)
5. Only if the entire batch verifies does the node append it to the replica file and advance `{ last_sequence, last_hash }` — this makes each batch atomic: a failure partway through a batch never leaves a partially-written, later-duplicated replica.
6. If a batch fills `limit` exactly, the node immediately fetches the next batch (catch-up loop) instead of waiting for the next interval — this is what lets replication keep up at high envelope volume.
7. On verification failure (chain break or hash mismatch — i.e. tampering, or a bug on the peer), the node stops advancing that peer's cursor, logs the error, and retries from the same position next tick. It does **not** crash or affect the node's own ledger/API.

## Configuration

| Variable | Default | Description |
|----------|---------|--------------|
| `ULP_PEERS` | *(unset)* | Comma-separated peers to replicate. Each entry is `url` or `url\|api_key` (pipe-separated) if the peer requires auth. Example: `https://worksd.internal:4800\|secret1,https://customer-a.example.com:4800\|secret2` |
| `ULP_PEER_SYNC_INTERVAL_MS` | `5000` | Polling interval per peer |
| `ULP_PEER_SYNC_BATCH_SIZE` | `200` | Envelopes fetched per request (also bounded by the peer's `ULP_MAX_LIST_LIMIT`) |
| `ULP_MAX_LIST_LIMIT` | `200` | Server-side cap on `limit` for `/ulp/v1/envelopes` and `/ulp/v1/replicas/*/envelopes` — raise this on nodes serving high-volume replication |

Leaving `ULP_PEERS` unset disables replication entirely; existing single-node behavior is unaffected.

## API

- `GET /ulp/v1/envelopes?since_sequence=N` — incremental cursor for pulling only envelopes after sequence `N` (existing filters `sender_id`/`receiver_id`/`envelope_type`/`from`/`to` still apply and compose with it)
- `GET /ulp/v1/peers` — this node's replication status for each configured peer (`node_id`, `last_sequence`, `last_hash`, `last_synced_at`, `status: "ok"|"error"|"pending"`, `last_error`)
- `GET /ulp/v1/replicas/:node_id/envelopes` — read back a held replica (supports `since_sequence`/`limit`/`offset`), so a node can act as a relay for a peer it already replicates (multi-hop federation)

## Proving an envelope's existence via a peer's replica

Because replication verifies the full hash chain before storing anything, a replica is exactly as tamper-evident as the source. To confirm envelope *N* from peer *P* is present and un-tampered in a local replica:

1. Fetch it from `GET /ulp/v1/replicas/P/envelopes?since_sequence={N-1}&limit=1`
2. Recompute `calculateHash(entry.payload, entry.parent_hash)` and confirm it equals `entry.hash`
3. Optionally walk forward to a later replicated entry and confirm the chain continues to link

## Known limitations (future work)

- **Ledger storage is still in-memory + append-only JSONL** (see the `TODO` in `src/server.ts`). At very high envelope volume this needs a real datastore with an index on `sequence`; the linear array scan used by `since_sequence` filtering does not scale past a few million envelopes.
- **No mutual authentication beyond a shared bearer token.** Production deployment across organizations should add mTLS or per-peer signed requests.
- **No automatic peer discovery.** `ULP_PEERS` is a static list; adding a new customer node currently means updating and restarting every node that should replicate it.
