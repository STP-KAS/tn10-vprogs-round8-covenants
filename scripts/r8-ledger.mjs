// R8 continuous ledger (TN10). Per minute: A selected-chain accepted txs, B block-body txs, C our accepts, chain blocks (net of reorg),
// chain-only coinbase (total / ours / fee part), our fees (runner reps + suite logs), mempool size, fee-estimate tiers, free disk.
// Usage: node r8-ledger.mjs <label> <minutes>
import { readFileSync, appendFileSync, statfsSync, existsSync } from "node:fs"; import { kaspa, connect, deskKey, addrOf } from "./lib.mjs";
const D = "/workspace/tn10-break-test-2026-09-25"; const LABEL = process.argv[2] || "X"; const MIN = Number(process.argv[3] || 60); const OUT = `${D}/logs/round8/ledger-${LABEL}.jsonl`;
const OURSPK = kaspa.payToAddressScript(addrOf(deskKey(0))).script; const rpc = await connect("n0");
const SUB = 308677064n; // TN10 subsidy per blue reward measured in round 7 (3.08677064 TKAS); fee part = output - SUB
let cur = { A: 0, B: 0, blocks: 0, chainAdd: 0, chainRem: 0 }; const seenAcc = new Set(); const seenBlk = new Set(); const per = new Map(); const pend = []; let fetched = 0, ferr = 0;
rpc.addEventListener("block-added", (e) => { const b = e.data.block; const h = b.header.hash; if (seenBlk.has(h)) return; seenBlk.add(h); cur.blocks++; cur.B += b.transactions.length; });
rpc.addEventListener("virtual-chain-changed", (e) => { cur.chainAdd += e.data.addedChainBlockHashes.length; cur.chainRem += e.data.removedChainBlockHashes.length;
  for (const h of e.data.removedChainBlockHashes) per.delete(h); for (const h of e.data.addedChainBlockHashes) pend.push(h);
  for (const a of e.data.acceptedTransactionIds) for (const id of a.acceptedTransactionIds) if (!seenAcc.has(id)) { seenAcc.add(id); cur.A++; } });
await rpc.subscribeBlockAdded(); await rpc.subscribeVirtualChainChanged(true);
(async () => { for (;;) { const h = pend.shift(); if (!h) { await new Promise((r) => setTimeout(r, 50)); continue; }
  try { const b = await rpc.getBlock({ hash: h, includeTransactions: true }); const c = b.block.transactions[0]; per.set(h, c.outputs.map((o) => ({ v: BigInt(o.value), ours: String(o.scriptPublicKey?.script ?? o.scriptPublicKey).endsWith(OURSPK) }))); fetched++; } catch { ferr++; } } })();
const lastRep = (f, key) => { try { const ls = readFileSync(f, "utf8").trimEnd().split("\n"); for (let i = ls.length - 1; i >= Math.max(0, ls.length - 400); i--) if (ls[i].includes('"ev":"rep"')) return JSON.parse(ls[i]); } catch {} return null; };
const RUNNERS = ["ttt-T7", "vprog-V7", "ttt-T8"].map((f) => `${D}/logs/round7/${f}.jsonl`);
const ours = () => { let acc = 0, fee = 0; for (const f of RUNNERS) { const r = lastRep(f); if (r) { acc += r.accepted || 0; fee += r.fee_tkas || 0; } }
  for (const set of ["A", "B"]) { const r = lastRep(`${D}/logs/round8/suite-${set}.jsonl`); if (r) for (const v of Object.values(r.summary)) { acc += v.act_ok; fee += v.fee_tkas; } }
  for (const f of ["storm-B1", "storm-B2"]) { const r = lastRep(`${D}/logs/round8/${f}.jsonl`); if (r) { acc += r.accepted || 0; fee += r.fee_tkas || 0; } }
  return { acc, fee }; };
const disk = () => { const s = statfsSync("/"); return +(Number(s.bavail) * Number(s.bsize) / 1e9).toFixed(2); };
let prev = ours(); let snapKeys = new Set(per.keys()); const tot = { A: 0, B: 0, C: 0, fee: 0, cbAll: 0n, cbOurs: 0n, feeAll: 0n, feeOurs: 0n, rewards: 0, oursN: 0, chain: 0, blocks: 0 };
appendFileSync(OUT, JSON.stringify({ ev: "start", t: new Date().toISOString(), label: LABEL, minutes: MIN, disk_gb: disk() }) + "\n");
const halt = () => existsSync("/tmp/r8-ledger.HALT");
for (let m = 1; m <= MIN && !halt(); m++) {
  await new Promise((r) => setTimeout(r, 60000)); const o = ours(); const C = o.acc - prev.acc, fee = o.fee - prev.fee; prev = o;
  // coinbase of chain blocks that arrived this minute (still on chain now)
  let cbAll = 0n, cbOurs = 0n, feeAll = 0n, feeOurs = 0n, rw = 0, on = 0, nb = 0; for (const [h, outs] of per) { if (snapKeys.has(h)) continue; snapKeys.add(h); nb++; for (const x of outs) { rw++; cbAll += x.v; const f = x.v > SUB ? x.v - SUB : 0n; feeAll += f; if (x.ours) { on++; cbOurs += x.v; feeOurs += f; } } }
  let mp = null, fe = null; try { mp = Number((await rpc.getInfo()).mempoolSize); } catch {} try { const e = (await rpc.getFeeEstimate({})).estimate; fe = { priority: Number(e.priorityBucket.feerate), normal: Number(e.normalBuckets[0]?.feerate), low: Number(e.lowBuckets[0]?.feerate) }; } catch {}
  let ourFr = null; try { ourFr = Number(readFileSync("/tmp/r6-feerate", "utf8")); } catch {}
  const row = { ev: "min", t: new Date().toISOString(), A: cur.A, B: cur.B, C, B_over_A: +(cur.B / Math.max(1, cur.A)).toFixed(3), blocks: cur.blocks, chain_add: cur.chainAdd, chain_rem: cur.chainRem, chain_blocks_cb: nb,
    rewards: rw, rewards_ours: on, cb_tkas: Number(cbAll) / 1e8, cb_ours_tkas: Number(cbOurs) / 1e8, fees_all_tkas: Number(feeAll) / 1e8, fees_to_our_miners_tkas: Number(feeOurs) / 1e8, our_fees_tkas: +fee.toFixed(5),
    net_fee_cost_tkas: +(fee - Number(feeOurs) / 1e8).toFixed(5), mempool: mp, fee_est: fe, our_feerate: ourFr, disk_gb: disk(), fetch_err: ferr };
  appendFileSync(OUT, JSON.stringify(row, (k, v) => typeof v === "bigint" ? Number(v) : v) + "\n");
  Object.assign(tot, { A: tot.A + cur.A, B: tot.B + cur.B, C: tot.C + C, fee: tot.fee + fee, cbAll: tot.cbAll + cbAll, cbOurs: tot.cbOurs + cbOurs, feeAll: tot.feeAll + feeAll, feeOurs: tot.feeOurs + feeOurs, rewards: tot.rewards + rw, oursN: tot.oursN + on, chain: tot.chain + nb, blocks: tot.blocks + cur.blocks });
  cur = { A: 0, B: 0, blocks: 0, chainAdd: 0, chainRem: 0 }; if (seenAcc.size > 3e6) seenAcc.clear(); if (seenBlk.size > 5e5) seenBlk.clear();
  if (m % 5 === 0 || m === MIN) appendFileSync(OUT, JSON.stringify({ ev: "cum", t: new Date().toISOString(), minutes: m, A_per_s: +(tot.A / (m * 60)).toFixed(1), B_per_s: +(tot.B / (m * 60)).toFixed(1), C_per_s: +(tot.C / (m * 60)).toFixed(1), B_over_A: +(tot.B / Math.max(1, tot.A)).toFixed(3),
    blocks_per_s: +(tot.blocks / (m * 60)).toFixed(2), chain_blocks: tot.chain, rewards: tot.rewards, our_reward_share: +(tot.oursN / Math.max(1, tot.rewards)).toFixed(3), cb_tkas: Number(tot.cbAll) / 1e8, cb_ours_tkas: Number(tot.cbOurs) / 1e8,
    fees_all_tkas: Number(tot.feeAll) / 1e8, fees_to_our_miners_tkas: Number(tot.feeOurs) / 1e8, our_fees_tkas: +tot.fee.toFixed(4), net_fee_cost_tkas: +(tot.fee - Number(tot.feeOurs) / 1e8).toFixed(4), disk_gb: disk() }) + "\n");
}
process.exit(0);
