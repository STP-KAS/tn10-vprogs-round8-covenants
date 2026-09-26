> **Experimental only. Testnet-10 only. Not a product, not advice, not Kaspa core, not an audit.**

# TN10 vprogs round 8: five L1 covenant designs, tested quiet (set A) and under storm (set B)

26 Sep 2026, 16:19–18:16 CEST. Kaspa **testnet-10 only**. The operator is STP-KAS, with Grok Bot. Round 8 builds the "Ideas" list from round 7. Each design is a SilverScript v1.0.0 covenant whose rules are enforced by **L1 consensus**. There is no off-chain runtime, no prover and no indexer. Every design was run twice: once on a quiet network (set A) and once during a storm (set B).

- Previous round: [tn10-vprogs-round7-ideas](https://github.com/STP-KAS/tn10-vprogs-round7-ideas)
- Reply to the outside reading: [tn10-vprogs-grokbot-opinion](https://github.com/STP-KAS/tn10-vprogs-grokbot-opinion)
- Front door: [tn10-vprogs-stress-findings](https://github.com/STP-KAS/tn10-vprogs-stress-findings)

No wallet keys, seeds or mnemonics are in this repository. Addresses in logs are replaced by `<addr>`. Transaction ids are kept.

## Headline

| | Set A (quiet) | Set B (storm) |
|---|---|---|
| Window (CEST) | 16:29–16:32 (pass 1: 16:27–16:28) | **16:34–18:00 (86 min, not the planned 2 h; see below)** |
| Covenant instances completed | **156 / 156** (pass 1: 78 / 78 more) | **1,191 / 1,196** (5 failed, all timeout paths; all pots recovered) |
| Deliberate illegal spends submitted | 1,033 (pass 1: 513 more) | 7,894 |
| … rejected by the node | **1,033 (100 %)** | **7,894 (100 %)** |
| Illegal spends accepted | **0** | **0** |
| Action latency p50 / p95, all designs | ≈ 420–600 / 770–1,360 ms | ≈ 450–500 / 980–1,320 ms |
| TN10 selected-chain accepted tx/s (A column) | 64.9 | **701.9** avg; **1,120.8** in the full-rate 26 min |
| Block-body tx/s (B column) | 117.2 | 1,012.5 avg; 1,656.0 full-rate |
| Our accepts/s (C column, see note) | 3.6 | 447.6 avg; 769.7 full-rate |
| Mempool max | 0 | 3,502 |
| Node fee estimate, normal / priority max (sompi/g) | 100 / 100 | 184 / 431 |
| Our feerate (2 × normal, min 200) | 200 | 200–369 |

The storm did not change a single verdict. Every illegal spend was rejected in both sets. The storm cost about 20 % more fee per instance, because our feerate followed the node's estimate up (2×). It had almost no effect on latency, because 2 × normal kept us in the next-block bucket. The five failures were all timeout spends submitted a few DAA before their relative lock matured. That is a client timing error under storm (see Flaws). Consensus refused them, which is the correct outcome.

## Test A vs test B, per design

A = quiet, 6 rounds (16:29–16:32). B = storm, 46 rounds, snapshot at storm end (18:00:27). "ok/inst" = instances that reached their intended end state (release, refund, timeout, winner paid, vote closed, game claimed or drawn). Probes are signed, fully-formed illegal spends; "rejected" means the node refused them. Latency is submit → accepted by the selected chain (`virtual-chain-changed`). The fee is the total miner fee for all legal actions of one instance.

| Design | A ok/inst | B ok/inst | A probes rejected | B probes rejected | illegal accepted A/B | A p50/p95 ms | B p50/p95 ms | A fee/instance TKAS | B fee/instance TKAS | mass (grams) |
|---|---|---|---|---|---|---|---|---|---|---|
| escrow | 24/24 | 184/184 | 180/180 | 1380/1380 | 0/0 | 500/1120 | 498/1186 | 0.01043 | 0.01233 | 5167–5234 |
| coinflip | 24/24 | 183/184 | 186/186 | 1426/1426 | 0/0 | 449/946 | 453/1111 | 0.01881 | 0.02215 | 5346–5390 |
| auction | 24/24 | 180/184 | 186/186 | 1426/1426 | 0/0 | 605/986 | 478/1070 | 0.03031 | 0.03587 | 5609–15919 |
| vote2 | 6/6 | 46/46 | 36/36 | 276/276 | 0/0 | 475/772 | 497/1093 | 0.04207 | 0.05018 | 5176–5286 |
| vote4 | 6/6 | 46/46 | 36/36 | 276/276 | 0/0 | 531/950 | 463/995 | 0.04378 | 0.05159 | 5341–5516 |
| vote8 | 6/6 | 46/46 | 36/36 | 276/276 | 0/0 | 508/1358 | 484/1011 | 0.0471 | 0.05554 | 5659–5964 |
| vote12 | 6/6 | 46/46 | 36/36 | 276/276 | 0/0 | 446/862 | 464/990 | 0.0504 | 0.05889 | 5975–6409 |
| vote16 | 6/6 | 46/46 | 36/36 | 276/276 | 0/0 | 472/808 | 490/1100 | 0.05371 | 0.06277 | 6292–6854 |
| ttt1@0.5x | 6/6 | 46/46 | 34/34 | 259/259 | 0/0 | 488/983 | 490/1216 | 0.05646 | 0.06523 | 6505–6516 |
| ttt1@1x | 6/6 | 46/46 | 35/35 | 257/257 | 0/0 | 523/1116 | 454/1086 | 0.10423 | 0.1314 | 6505–6516 |
| ttt1@3x | 6/6 | 46/46 | 32/32 | 252/252 | 0/0 | 427/863 | 465/1052 | 0.37135 | 0.39825 | 6505–6516 |
| ttte@0.5x | 6/6 | 46/46 | 35/35 | 254/254 | 0/0 | 467/1033 | 490/1319 | 0.05464 | 0.06116 | 6176–6187 |
| ttte@1x | 6/6 | 46/46 | 33/33 | 252/252 | 0/0 | 475/1027 | 464/1136 | 0.1098 | 0.12988 | 6176–7721 |
| ttte@3x | 6/6 | 46/46 | 34/34 | 246/246 | 0/0 | 484/1028 | 466/1077 | 0.31547 | 0.39104 | 6176–6187 |
| tttd@0.5x | 6/6 | 46/46 | 32/32 | 254/254 | 0/0 | 470/1093 | 497/1254 | 0.06432 | 0.07308 | 6996–7626 |
| tttd@1x | 6/6 | 46/46 | 31/31 | 255/255 | 0/0 | 421/1043 | 471/1099 | 0.12661 | 0.14099 | 6996–7750 |
| tttd@3x | 6/6 | 46/46 | 35/35 | 253/253 | 0/0 | 512/1047 | 468/978 | 0.35729 | 0.4209 | 6996–7007 |
| **total** | **156/156** | **1191/1196** | **1033/1033** | **7894/7894** | **0/0** | | | | | |

Where probes were rejected:
- **Script** (`script ran, but verification failed`, or `Unsatisfied lock time`): 100 % of the vote and TTT probes, and most escrow / coinflip / auction probes.
- **Sequence lock** (`one of the transaction sequence locks conditions was not met`): all early-timeout probes, i.e. timeouts submitted with `sequence = ttl` before the lock matured. Those never reach the script.
- Set A: escrow 66 script + 24 seqlock; coinflip / auction 81 + 12 each. Set B has the same shape, scaled up. Per-probe error texts are in `logs/suite-*.jsonl`.

### Design notes and measured costs

1. **Escrow, 2-of-3 with timeout refund** ([`covenants/escrow.sil`](covenants/escrow.sil), 469-byte script).
   - Paths: `release` (seller + buyer, or seller + arbiter → seller), `refund` (buyer + seller or arbiter → buyer), `timeout` (buyer alone after `ageDaa ≥ 100` → buyer).
   - All four paths were exercised in both sets.
   - Probes: buyer-only release (the same key signing twice), arbiter twice, release to an attacker, refund value theft, timeout with seq=0, early timeout, timeout by the seller (early and matured), matured timeout to an attacker.
   - Mass ≈ 5.2k per action. ≈ 0.010 TKAS per escrow quiet, 0.012 under storm.
2. **Commit–reveal coin flip** ([`covenants/coinflip.sil`](covenants/coinflip.sil), 648 B).
   - Both `blake2b(secret)` commitments are fixed at creation. A reveals (the state stores A's secret), then B reveals. The covenant computes `(ra[0] xor sb[0]) & 1` and pays the winner.
   - Timeouts: A silent → B wins; B silent after A revealed → A wins.
   - Probes: wrong secret (A and B), A's reveal signed by B, state tampering, B revealing in phase 0, paying the loser, A revealing twice, early timeout, the staller claiming the matured timeout.
   - Mass ≈ 5.35–5.39k. Results: A-wins and B-wins both occurred, and both stall paths worked.
   - **Known weakness (not tested on chain):** B sees A's revealed secret before revealing. B cannot change `sb` (it is committed), but B can **refuse to reveal** when losing and forfeit via the timeout. So the pot must exceed B's gain from walking away. This is the classic commit-reveal last-revealer problem.
3. **Voting counter with a Merkle allow-list** ([`covenants/vote{2,4,8,12,16}.sil`](covenants), generated). Leaf = `blake2b(voter x-only pubkey)`. Each spend proves membership (the proof is in the witness), checks the voter's signature, and adds exactly 1 to the tally.

   | Depth (max voters) | Script bytes | Mass per vote | Fee per vote at 200 sompi/g |
   |---|---|---|---|
   | 2 (4) | 478 | 5,286 | 0.0106 TKAS |
   | 4 (16) | 643 | 5,516 | 0.0110 |
   | 8 (256) | 961 | 5,964 | 0.0119 |
   | 12 (4,096) | 1,277 | 6,409 | 0.0128 |
   | 16 (65,536) | 1,594 | 6,854 | 0.0137 |

   - **Mass ≈ 4,900 + ~112 per level.** Going from 4 voters to 65k voters costs +30 % mass per vote.
   - Probes: non-member with a forged proof, member pubkey with the wrong signer, tally +2, wrong leaf index, root swap, a voter closing the box. All rejected in both sets.
   - **Known gap (by design in v1, not tested):** nothing stops the same member voting twice. There is no nullifier set in the state.
4. **Two-bidder sealed-bid auction** ([`covenants/auction.sil`](covenants/auction.sil), 858 B).
   - Bids are committed as `blake2b(bid8 ‖ salt32)`. The pot holds 2 × deposit.
   - A reveals, then B reveals, and the covenant settles in one transaction: seller gets the higher bid, the winner gets `dep − bid`, the loser gets `dep` back.
   - Timeouts: the staller's deposit goes to the seller and the honest bidder is refunded.
   - Settlement mass is 15–22k (3 outputs, of which 2 are small change → KIP-9 storage mass). That is the most expensive single action in the suite, yet still only ≈ 0.03 TKAS per auction.
   - Probes: wrong salt, revealing a lower bid than committed, A's reveal signed by B, storing a different bid, early timeout, underpaying the seller, swapping winner and loser, the staller refunding himself, shorting the seller on timeout.
5. **KNS-gated rooms: BLOCKED, spec only.** The KNS indexer is ~262.7k DAA behind. See [`specs/kns-gated-rooms.md`](specs/kns-gated-rooms.md). Nothing was built or measured.
6. **CovTTT under storm: is the ~6.5k-mass move priced out first?** **No, not at this storm level.** A move at 0.5× our feerate (= 1× the node's normal estimate, min 100) had storm p50/p95 of 490 / 1,216 ms, vs 454 / 1,086 at 1× and 465 / 1,052 at 3×. The full-rate storm filled ~1,120 tx/s of selected-chain capacity, but the mempool never exceeded 3.5k. Blocks were not full enough for a 6.5k-mass tx at the normal feerate to wait. Pricing out would need a storm that keeps the mempool above ~1 block of backlog. We could not reach that within the disk budget (see "Not done").
7. **Mass diet.** Three builds of the same game with the same rules:

   | Variant | Script bytes | Move mass | Fee per move at 200 sompi/g | vs v1 |
   |---|---|---|---|---|
   | v1 `covttt` (round 7) | 1,806 | 6,516 | 0.0130 TKAS | — |
   | **`covttte`**: one combined `anyWin()` check instead of two `wins()` calls | **1,477** | **6,187** | **0.0124** | **−18 % script, −5 % mass** |
   | `covtttd`: board packed into one `byte[9]` | 2,297 | 7,007 | 0.0140 | **+27 % script, +8 % mass** (worse) |

   - Packing the state shrank the state span (165 → 94 bytes), but the byte-indexing and split/concat code cost more than the saved state bytes.
   - What moves the needle is removing duplicated logic (v1 evaluated all 8 lines twice).
   - The "template-hash" diet from the round-7 idea (keep the constant code out of each move) is **not possible with P2SH as used here**: every spend must reveal the whole redeem script. It would need `readInputStateWithTemplate` across two UTXOs (a code UTXO + a state UTXO). Designed, **not built or measured**.

## Network during the tests (our node, three columns)

`logs/ledger-A.jsonl`, `logs/ledger-B.jsonl`, one row per minute. A = selected-chain accepted txs (unique ids in `virtual-chain-changed`), B = block-body txs (Σ `block.transactions.len()`, the counter behind kaspad's "Processed" log line), C = our accepts. Coinbase is from **selected-chain blocks only**, with reorged-out chain blocks removed. Subsidy = 3.08677064 TKAS per blue reward, measured in round 7.

| Window (CEST) | min | A /s | B /s | C /s | B/A | mempool max | normal / prio fee est. max | our reward share | fees in chain coinbase | fee part to our miners | our fees | **net fee cost** | free disk (GB, 10⁹) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Set A quiet 16:31–16:33 | 3 | 64.9 | 117.2 | 3.6 | 1.81 | 0 | 100 / 100 | 52.3 % | 60.3 | 21.7 | 11.2 | **−10.5** | 12.8 |
| Storm, full rate 16:35–17:00 | 26 | **1,120.8** | 1,656.0 | 769.7 | 1.48 | 3,502 | 184 / 431 | 53.3 % | 9,445.9 | 8,427.2 | 6,084.1 | **−2,343.1** | 12.7 → 12.2 |
| Storm, paced 17:01–17:30 | 30 | 823.8 | 1,176.6 | 511.0 | 1.43 | 1,345 | 182 / 400 | 54.1 % | 7,174.2 | 6,279.8 | 4,104.7 | **−2,175.2** | 12.1 → 11.3 |
| Storm, low rate 17:31–18:00 | 30 | 217.0 | 290.8 | 105.1 | 1.34 | 212 | 100 / 100 | 59.2 % | 1,338.7 | 1,137.4 | 694.5 | **−442.9** | 11.3 → 10.4 |
| **Storm total 16:35–18:00** | **86** | **701.9** | **1,012.5** | **447.6** | **1.44** | 3,502 | 184 / 431 | 55.7 % | 17,958.8 | 15,844.4 | 10,883.2 | **−4,961.1** | 12.7 → 10.4 |

**C and "our fees" understate our load.** Ledger B was started before the third storm runner (ttt T8, 16:41), so T8's accepts and fees are not in C. From T8's own log, it added **1,005,513 accepted txs** and **4,737.7 TKAS in fees** during the storm (≈ 195 tx/s averaged over 86 min). With T8 included, our fees become ≈ 15,621 TKAS against 15,844 TKAS of fee value landing with our miners, so the **net fee cost is about −223 TKAS**, still no net cost. Per runner (storm window): ttt T7 1,152,183 accepted / 5,266 TKAS; vprog V7 1,152,162 / 5,508 TKAS; T8 1,005,513 / 4,738 TKAS. p95 latency was 2.6–2.9 s at full rate. 0 illegal moves executed.

B/A was 1.34–1.81, so the body counter overstates selected-chain throughput by a third or more, as measured in round 7.

## Why

Round 7 showed that one covenant game (CovTTT) is enforced by L1. Round 8 asks two questions. Do the classic contract shapes (escrow, commit–reveal, allow-list voting, sealed-bid auction) work the same way at ≈ 5–7k mass per action? And does any of it change when the network is busy?

## How

- **Node:** n0 kaspad v2.1.0, TN10, no utxoindex. Miners kept running.
- **Compiler:** SilverScript v1.0.0 `silverc`. Each artifact's state encoder is **self-checked**: encoding the constructor values must reproduce the compiled bytecode byte for byte, or the suite refuses to start (`scripts/r8-suite.mjs`, top).
- **BLAKE2b-256:** pure JS (`scripts/r8-blake2b.mjs`), checked against Python `hashlib.blake2b(digest_size=32)`.
- **Keys:**
  - Every participant is a fresh key `sha256(seed | "r8" | i)`. The counter is fsync'd **before** funding.
  - Each instance (keys, state, secrets and bids for recovery) goes into a 0600 registry outside this repo.
  - `scripts/r8-recover.mjs` scans the registry against the live public UTXO API, including phase-1 states, and spends any stranded pot through its timeout path.
- **Suite** (`scripts/r8-suite.mjs <A|B> <rounds>`): one round is 4 escrow (one per path), 4 coinflip, 5 vote (one per depth), 4 auction and 9 TTT (3 variants × fee tiers 0.5 / 1 / 3 × our feerate). Concurrency 8. Payouts are swept back to the faucet right away.
- **Storm:**
  - The round-7 index-free runners ttt T7 and vprog V7 (200 lanes each), plus ttt T8 from 16:41.
  - Fee = `/tmp/r6-feerate` = max(2 × node normal estimate, 200) sompi/g.
  - Rate 300 → 400 per runner. From 17:00 a disk pacer (`scripts/r8-pacer.py`) scaled the rate down to protect the disk floor.
- **Guard** (`scripts/r7-guard.py`): mempool > 90k pause (never came close; max 3.5k), disk pauses, RAM, faucet. The TN10 pruning rule stays: pause at 18:35, and stop the node at 18:45 if free disk is under 20 GiB.
- **KNS:** paused for the whole round. The requested 15 TKAS cap is below the cheapest KNS name class (35 TKAS for 5+ characters), so no name qualifies.

## Sources

- SilverScript v1.0.0 tutorial: `blake2b`, byte `^` / `&`, `split`, `validateOutputState`, `this.ageDaa`, `readInputStateWithTemplate`.
- rusty-kaspa v2.1.0: sequence-lock check in mempool admission; KIP-9 storage mass.
- Round 7: [CovTTT + timeout lock results](https://github.com/STP-KAS/tn10-vprogs-round7-ideas), [opinion reply](https://github.com/STP-KAS/tn10-vprogs-grokbot-opinion).

## Flaws (ours)

1. **The storm was 86 min, not 2 h.** It started 16:34 and was planned to 18:35. Full rate ran 16:34–17:00, the disk pacer then throttled it, and at 18:00:00 the guard's `disk < 10 GiB` rule (9.96 GiB) paused all senders. I did not resume, because that would have taken the disk below the preferred 10 G floor with TN10 pruning due around 18:50. The window is reported as it happened. It is not stretched to 2 h.
2. **Disk, not the network, was the limit.** At full rate the node's database grew ~0.04–0.06 GB/min. The box had ~12.7 GB free.
3. **Five timeout spends failed under storm** (auction ×4, coinflip ×1): `sequence locks conditions were not met`. The client waited until our node's virtual DAA was ≥ ttl + 3 past the accepting block, but the lock is measured from the UTXO's own DAA score as the node sees it at validation. Under storm, reorgs and virtual lag make that a few DAA off. Fix: wait ttl + ~20, or retry on that error. After the /tmp/r8.HALT stop at 18:12 there was one more failure of the same kind, and two instances were cut off mid-way (an escrow and a coin flip). All **6 stranded pots (34.98 TKAS)** were recovered through their timeout paths after maturity (`logs/recover.jsonl`).
4. **Ledger A pass 1 crashed** (BigInt serialisation). Suite-A pass 1 (78/78, 513/513) is published as `logs/suite-A0-noledger.jsonl` but kept out of the network columns. Set A was re-run with the ledger live.
5. **Set A's quiet window is short** (3 ledger minutes) because the suite is fast (≈ 20 s per round). It is still representative of a quiet TN10: mempool 0, fee estimate at the floor.
6. **C column missing T8** (see above). Corrected by hand from T8's log.
7. **The guard was down for ~75 s** (17:31:45–17:33:00) during a restart. Runners were unaffected.
8. **Coin-flip last-revealer problem** and **vote double-voting** are design limits of these v1 contracts (see design notes). They were not probed on chain.

## Not done

- A full 2-hour storm (Flaw 1).
- A storm heavy enough to price out ~6.5k-mass covenant moves (it would need a sustained mempool backlog; ours peaked at 3.5k).
- KNS-gated rooms (blocked by the KNS indexer, spec only).
- A code-UTXO / state-UTXO template split (the real "template-hash" mass diet): designed, not built.
- On-chain probes for coin-flip walk-away economics and vote double-voting.

## Ideas (next)

- Vote v2 with a nullifier: each voter's leaf marked as used, via a sparse Merkle update proof in the witness.
- Coin flip v2: a bond larger than the pot for the second revealer, forfeited on timeout.
- Escrow with partial releases (milestones) via output-state continuation.
- An N-bidder auction as a chain of 2-bidder rounds.
- The code / state UTXO split to cut per-move mass.

## Other

Nothing from round 8 is left running. The storm runners were stopped and their 600 chain ends swept back (4,033.6 TKAS). All covenant pots were recovered: a rescan finds 0 covenant UTXOs, and 0 leftover UTXOs across 6,048 derived keys. KNS is paused. Miners and the node keep running through TN10 pruning under the guard's rules.

---

Standard disclaimer. This GitHub, not the topic above. Testnet only. Intentions are good; thought process is questionable.
