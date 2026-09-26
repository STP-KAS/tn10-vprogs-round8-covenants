# KNS-gated rooms: spec only (BLOCKED, not built, not measured)

**Status (26 Sep 2026, ~16:00 CEST):** blocked. The public KNS TN10 indexer reports `NG (580736120) is lagging behind BlockDag (580998852)`, a lag of ~262.7k DAA. Every sampled name we "created" in rounds 6–7 (60/60) still reads `available: true`. A room gate that trusts that indexer would admit or refuse the wrong people. See round-7 `evidence/kns-check-sample.json`.

## Idea
A game room (CovTTT-style covenant) whose `join` entry only admits a player who controls a given KNS name (e.g. `*.stp.kas`, or a name from an allow-list).

## Two designs

1. **Off-chain gate (indexer-trusting, simple).** The room creator checks KNS ownership through the indexer, then writes the admitted player's x-only pubkey into the covenant state (`validateOutputState`). The covenant only enforces "the signer is the admitted key".
   - Trust: the creator plus the KNS indexer.
   - Cost: the same as CovTTT, ~5.3–6.5k mass per action.
   - Failure mode today: the indexer is ~262.7k DAA stale, so ownership answers are wrong or unavailable.
2. **On-chain gate (no indexer).** The KNS name is represented by a UTXO the owner controls (the KNS inscription or reveal output, or a KNS-issued token UTXO). `join` spends or references that UTXO in the same transaction, and the covenant checks, via `readInputStateWithTemplate`, that input *k* is a KNS name UTXO of the expected template, and that its owner key signed.
   - Trust: consensus only.
   - Needs: KNS names to live in a covenant template with a stable template hash. Today they are commit/reveal inscriptions read by an off-chain indexer, so this is **not possible** without KNS-side changes.

## Tests we would run (when unblocked)
- Non-owner joins → rejected. Owner of a *different* name → rejected. Name transferred mid-game → old owner rejected.
- Mass per `join` vs a plain `move`. Latency p50/p95 quiet vs storm.
- Indexer lag at the moment of each off-chain check (design 1), recorded next to each admission.

## Unblock condition
The KNS indexer is within, say, 100 DAA of the virtual DAA, **and** a sample of our round-6/7 names resolves (owner or taken) instead of `available: true`.
