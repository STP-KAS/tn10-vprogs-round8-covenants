// R8 covenant test suite (TN10 only). Usage: node r8-suite.mjs <SET A|B> [rounds]
// Designs: escrow (2-of-3 + timeout refund), coinflip (commit-reveal), vote (Merkle allow-list, depth 2/4/8/12/16),
// auction (2-bidder sealed bid), ttt v1 / ttt-e (diet: combined win check) / ttt-d (diet: packed board) at fee tiers.
// Every probe is a signed, fully-formed ILLEGAL spend submitted to n0: PASS = rejected by the node.
import crypto from "node:crypto"; import { appendFileSync, readFileSync, existsSync } from "node:fs";
import * as L from "./r8-lib.mjs"; import { blake2b } from "./r8-blake2b.mjs";
const { kaspa, addrOf } = L; const SET = process.argv[2] || "A"; const ROUNDS = Number(process.argv[3] || 1);
const LOG = `${L.D}/logs/round8/suite-${SET}.jsonl`;
const log = (o) => appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), set: SET, ...o }, (k, v) => typeof v === "bigint" ? v.toString() : v) + "\n");
const UNTIL = Number(process.env.R8_UNTIL || 0), GAP = Number(process.env.R8_GAP_S || 0) * 1000;
const TTL = 100n, MAXFEE = 10000000n, HALT = () => existsSync("/tmp/r7.HALT") || existsSync("/tmp/r8.HALT") || (UNTIL && Date.now() > UNTIL);
const ART = { escrow: L.loadArt("r8/escrow.json"), coinflip: L.loadArt("r8/coinflip.json"), auction: L.loadArt("r8/auction.json"),
  ttt1: L.loadArt("covttt.json"), ttte: L.loadArt("r8/covttte.json"), tttd: L.loadArt("r8/covtttd.json"),
  vote: Object.fromEntries([2, 4, 8, 12, 16].map((d) => [d, L.loadArt(`r8/vote${d}.json`)])) };
// ---- encoder self-checks against compiled bytecode (constructor args) ----
{ const b = (v) => v.repeat(32);
  L.checkArt(ART.escrow, { buyer: b("11"), seller: b("22"), arbiter: b("33"), maxFee: 10000000, ttl: 100 });
  L.checkArt(ART.coinflip, { pa: b("11"), pb: b("22"), ha: b("33"), hb: b("44"), ra: b("00"), phase: 0, maxFee: 10000000, ttl: 100 });
  L.checkArt(ART.auction, { seller: b("11"), ba: b("22"), bb: b("33"), ha: b("44"), hb: b("55"), bidA: 0, phase: 0, dep: 200000000, maxFee: 10000000, ttl: 100 });
  for (const d of [2, 4, 8, 12, 16]) L.checkArt(ART.vote[d], { owner: b("66"), root: b("55"), tally: 0, maxFee: 10000000 });
  const z = { px: b("11"), po: b("22"), turn: 0, c0: 0, c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, c6: 0, c7: 0, c8: 0 };
  L.checkArt(ART.ttte, { ...z, maxFee: 10000000 }); L.checkArt(ART.tttd, { px: b("11"), po: b("22"), turn: 0, board: "00".repeat(9), maxFee: 10000000 });
  L.checkArt(ART.ttt1, { ...z, maxFee: 100000 }); }
// ---- stats ----
const S = {}; const st = (d) => (S[d] ??= { inst: 0, ok: 0, fail: 0, actions: 0, act_ok: 0, lat: [], fee: 0n, mass: {}, probes: 0, rejected: 0, ILLEGAL_ACCEPTED: 0, by_probe: {}, paths: {}, errs: {} });
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
async function act(design, name, b, { wait = true } = {}) { // legit action: submit, wait for acceptance, record latency / fee / mass
  const s = st(design); s.actions++; (s.mass[name] ??= []).push(Number(b.mass)); const r = await L.submit(b.tx);
  if (!r.ok) { s.errs[name + ": " + r.e] = (s.errs[name + ": " + r.e] || 0) + 1; log({ ev: "act_fail", design, name, e: r.e }); return false; }
  s.fee += b.fee; if (!wait) { s.act_ok++; return true; }
  const ok = await L.waitAcc(b.tx.id, 180000); if (ok) { s.act_ok++; s.lat.push(L.acc.get(b.tx.id).t - r.t0); } else { s.errs[name + ": not accepted 180s"] = (s.errs[name + ": not accepted 180s"] || 0) + 1; log({ ev: "act_timeout", design, name, id: b.tx.id }); }
  return ok;
}
async function probe(design, kind, b) { const s = st(design); s.probes++; s.by_probe[kind] = (s.by_probe[kind] || 0) + 1; const r = await L.submit(b.tx);
  if (r.ok) { s.ILLEGAL_ACCEPTED++; log({ ev: "ILLEGAL_ACCEPTED", design, kind, id: b.tx.id }); } else { s.rejected++; const layer = /script ran|verify the signature script|Unsatisfied lock time/.test(r.e) ? "script" : /sequence locks/.test(r.e) ? "seqlock" : "other"; (s.layer ??= {})[layer] = (s.layer[layer] || 0) + 1; const k = kind + ": " + r.e.slice(0, 90); s.errs[k] = (s.errs[k] || 0) + 1; } return !r.ok; }
const p2pk = (k) => addrOf(k); const out = (a, amount) => ({ address: a, amount });
async function waitAge(id, ttl) { if (!(await L.waitAcc(id, 180000))) return false; const d0 = await L.daaOfBlock(L.acc.get(id).h); for (let i = 0; i < 600; i++) { if ((await L.vdaa()) - d0 >= ttl + 3n) return true; await L.sleep(500); } return false; }
async function newKeys(n) { const ks = []; for (let i = 0; i < n; i++) ks.push(L.nextKey()); return ks; }
async function payoutSweep(design, key, tx, idx = 0) { const r = await L.sweep(key, { transactionId: tx.id, index: idx }, tx.outputs[idx].value); if (!r.ok) log({ ev: "sweep_fail", design, e: r.e }); }
// ================= 1. ESCROW =================
async function escrow(path) {
  const d = "escrow", A = ART.escrow, s = st(d); s.inst++; const [B, Sx, Ar, X] = await newKeys(4);
  const state = { buyer: L.xonly(B.k), seller: L.xonly(Sx.k), arbiter: L.xonly(Ar.k), maxFee: MAXFEE, ttl: TTL };
  const pot = 300000000n; L.reg({ design: d, keys: [B.i, Sx.i, Ar.i, X.i], state });
  const f = await L.fund(A.adr(state), pot); if (!f.ok) { s.fail++; log({ ev: "fund_fail", design: d, e: f.e }); return; }
  if (!(await L.waitAcc(f.tx.id))) { s.fail++; return; } L.reg({ design: d, op: f.op, amount: pot });
  const sp = (entry, args, outs, o) => L.buildSpend(A, state, f.op, pot, entry, args, outs, o);
  // probes on the live pot
  await probe(d, "release_buyer_only", sp("release", [{ sig: B.k }, { sig: B.k }, { i64: 0 }], (fee) => [out(p2pk(Sx.k), pot - fee)]));
  await probe(d, "release_arbiter_twice", sp("release", [{ sig: Ar.k }, { sig: Ar.k }, { i64: 1 }], (fee) => [out(p2pk(Sx.k), pot - fee)]));
  await probe(d, "release_to_attacker", sp("release", [{ sig: B.k }, { sig: Sx.k }, { i64: 0 }], (fee) => [out(p2pk(X.k), pot - fee)]));
  await probe(d, "refund_value_theft", sp("refund", [{ sig: Sx.k }, { sig: B.k }, { i64: 0 }], (fee) => [out(p2pk(B.k), 100000000n), out(p2pk(X.k), pot - 100000000n - fee)]));
  await probe(d, "timeout_seq0", sp("timeout", [{ sig: B.k }], (fee) => [out(p2pk(B.k), pot - fee)]));
  await probe(d, "timeout_early_seq_ttl", sp("timeout", [{ sig: B.k }], (fee) => [out(p2pk(B.k), pot - fee)], { seq: TTL }));
  await probe(d, "timeout_by_seller", sp("timeout", [{ sig: Sx.k }], (fee) => [out(p2pk(Sx.k), pot - fee)], { seq: TTL }));
  let b, key;
  if (path === "release_buyer") { b = sp("release", [{ sig: B.k }, { sig: Sx.k }, { i64: 0 }], (fee) => [out(p2pk(Sx.k), pot - fee)]); key = Sx.k; }
  else if (path === "release_arbiter") { b = sp("release", [{ sig: Ar.k }, { sig: Sx.k }, { i64: 1 }], (fee) => [out(p2pk(Sx.k), pot - fee)]); key = Sx.k; }
  else if (path === "refund") { b = sp("refund", [{ sig: Sx.k }, { sig: B.k }, { i64: 0 }], (fee) => [out(p2pk(B.k), pot - fee)]); key = B.k; }
  else { await waitAge(f.tx.id, TTL);
    await probe(d, "timeout_mature_by_seller", sp("timeout", [{ sig: Sx.k }], (fee) => [out(p2pk(Sx.k), pot - fee)], { seq: TTL }));
    await probe(d, "timeout_mature_to_attacker", sp("timeout", [{ sig: B.k }], (fee) => [out(p2pk(X.k), pot - fee)], { seq: TTL }));
    b = sp("timeout", [{ sig: B.k }], (fee) => [out(p2pk(B.k), pot - fee)], { seq: TTL }); key = B.k; }
  const ok = await act(d, path, b); s.paths[path] = (s.paths[path] || 0) + (ok ? 1 : 0);
  if (ok) { s.ok++; await payoutSweep(d, key, b.tx); } else s.fail++;
}
// ================= 2. COIN FLIP =================
async function coinflip(path) {
  const d = "coinflip", A = ART.coinflip, s = st(d); s.inst++; const [Pa, Pb, X] = await newKeys(3);
  const sa = crypto.randomBytes(32), sb = crypto.randomBytes(32); // secrets: derived only for this run, logged to the 0600 registry for recovery
  const st0 = { pa: L.xonly(Pa.k), pb: L.xonly(Pb.k), ha: L.hex(blake2b(sa)), hb: L.hex(blake2b(sb)), ra: "00".repeat(32), phase: 0, maxFee: MAXFEE, ttl: TTL };
  const pot = 400000000n; L.reg({ design: d, keys: [Pa.i, Pb.i, X.i], state: st0, sa: L.hex(sa), sb: L.hex(sb) });
  const f = await L.fund(A.adr(st0), pot); if (!f.ok) { s.fail++; log({ ev: "fund_fail", design: d, e: f.e }); return; }
  if (!(await L.waitAcc(f.tx.id))) { s.fail++; return; }
  const sp0 = (entry, args, outs, o) => L.buildSpend(A, st0, f.op, pot, entry, args, outs, o);
  const st1 = { ...st0, ra: L.hex(sa), phase: 1 };
  await probe(d, "revealA_wrong_secret", sp0("revealA", [{ sig: Pa.k }, { data: L.hex(crypto.randomBytes(32)) }], (fee) => [out(A.adr({ ...st1, ra: "00".repeat(32) }), pot - fee)]));
  await probe(d, "revealA_signed_by_B", sp0("revealA", [{ sig: Pb.k }, { data: L.hex(sa) }], (fee) => [out(A.adr(st1), pot - fee)]));
  await probe(d, "revealA_state_tamper", sp0("revealA", [{ sig: Pa.k }, { data: L.hex(sa) }], (fee) => [out(A.adr({ ...st1, pb: L.xonly(X.k) }), pot - fee)]));
  await probe(d, "revealB_in_phase0", sp0("revealB", [{ sig: Pb.k }, { data: L.hex(sb) }], (fee) => [out(p2pk(Pb.k), pot - fee)]));
  await probe(d, "timeout_early", sp0("timeout", [{ sig: Pb.k }], (fee) => [out(p2pk(Pb.k), pot - fee)], { seq: TTL }));
  if (path === "A_stalls") { await waitAge(f.tx.id, TTL);
    await probe(d, "timeout_mature_by_staller", sp0("timeout", [{ sig: Pa.k }], (fee) => [out(p2pk(Pa.k), pot - fee)], { seq: TTL }));
    const b = sp0("timeout", [{ sig: Pb.k }], (fee) => [out(p2pk(Pb.k), pot - fee)], { seq: TTL });
    const ok = await act(d, "timeout_A_stalls", b); s.paths[path] = (s.paths[path] || 0) + (ok ? 1 : 0); if (ok) { s.ok++; await payoutSweep(d, Pb.k, b.tx); } else s.fail++; return; }
  const bA = sp0("revealA", [{ sig: Pa.k }, { data: L.hex(sa) }], (fee) => [out(A.adr(st1), pot - fee)]);
  if (!(await act(d, "revealA", bA))) { s.fail++; return; }
  const op1 = { transactionId: bA.tx.id, index: 0 }, v1 = bA.tx.outputs[0].value; const sp1 = (entry, args, outs, o) => L.buildSpend(A, st1, op1, v1, entry, args, outs, o);
  const aWins = ((sa[0] ^ sb[0]) & 1) === 1; const W = aWins ? Pa : Pb, Lz = aWins ? Pb : Pa;
  await probe(d, "revealB_pay_loser", sp1("revealB", [{ sig: Pb.k }, { data: L.hex(sb) }], (fee) => [out(p2pk(Lz.k), v1 - fee)]));
  await probe(d, "revealB_wrong_secret", sp1("revealB", [{ sig: Pb.k }, { data: L.hex(crypto.randomBytes(32)) }], (fee) => [out(p2pk(W.k), v1 - fee)]));
  await probe(d, "revealA_again_phase1", sp1("revealA", [{ sig: Pa.k }, { data: L.hex(sa) }], (fee) => [out(A.adr(st1), v1 - fee)]));
  if (path === "B_stalls") { await waitAge(bA.tx.id, TTL);
    await probe(d, "timeout_mature_by_staller", sp1("timeout", [{ sig: Pb.k }], (fee) => [out(p2pk(Pb.k), v1 - fee)], { seq: TTL }));
    const b = sp1("timeout", [{ sig: Pa.k }], (fee) => [out(p2pk(Pa.k), v1 - fee)], { seq: TTL });
    const ok = await act(d, "timeout_B_stalls", b); s.paths[path] = (s.paths[path] || 0) + (ok ? 1 : 0); if (ok) { s.ok++; await payoutSweep(d, Pa.k, b.tx); } else s.fail++; return; }
  const bB = sp1("revealB", [{ sig: Pb.k }, { data: L.hex(sb) }], (fee) => [out(p2pk(W.k), v1 - fee)]);
  const ok = await act(d, "revealB", bB); s.paths["winner_" + (aWins ? "A" : "B")] = (s.paths["winner_" + (aWins ? "A" : "B")] || 0) + (ok ? 1 : 0);
  if (ok) { s.ok++; await payoutSweep(d, W.k, bB.tx); } else s.fail++;
}
// ================= 3. VOTE (Merkle allow-list) =================
function sparseTree(depth, leaves) { // leaves: Map idx -> 32-byte leaf. empty leaf = 32 zero bytes. returns {root, proof(idx)}
  const def = [Buffer.alloc(32)]; for (let l = 1; l <= depth; l++) def.push(blake2b(Buffer.concat([def[l - 1], def[l - 1]])));
  const lv = [new Map([...leaves].map(([i, h]) => [i, h]))];
  for (let l = 0; l < depth; l++) { const nx = new Map(); for (const i of lv[l].keys()) { const p = i >> 1; if (nx.has(p)) continue; const L0 = lv[l].get(2 * p) ?? def[l], R0 = lv[l].get(2 * p + 1) ?? def[l]; nx.set(p, blake2b(Buffer.concat([L0, R0]))); } lv.push(nx); }
  const root = lv[depth].get(0) ?? def[depth];
  const proof = (idx) => { const sib = []; let i = idx; for (let l = 0; l < depth; l++) { sib.push(lv[l].get(i ^ 1) ?? def[l]); i >>= 1; } return Buffer.concat(sib); };
  return { root, proof };
}
async function vote(depth) {
  const d = `vote${depth}`, A = ART.vote[depth], s = st(d); s.inst++; const ks = await newKeys(5); const [Ow, V0, V1, V2, X] = ks;
  const n = 2 ** depth; const idxs = [0, Math.floor(n / 3), n - 1]; const voters = [V0, V1, V2];
  const tree = sparseTree(depth, new Map(voters.map((v, j) => [idxs[j], blake2b(Buffer.from(L.xonly(v.k), "hex"))])));
  let state = { owner: L.xonly(Ow.k), root: L.hex(tree.root), tally: 0n, maxFee: MAXFEE }; const pot = 300000000n; L.reg({ design: d, keys: ks.map((k) => k.i), state });
  const f = await L.fund(A.adr(state), pot); if (!f.ok) { s.fail++; log({ ev: "fund_fail", design: d, e: f.e }); return; }
  if (!(await L.waitAcc(f.tx.id))) { s.fail++; return; }
  let op = f.op, val = pot;
  const vb = (k, pk, proof, idx, next) => L.buildSpend(A, state, op, val, "vote", [{ sig: k }, { data: pk }, { data: L.hex(proof) }, { i64: idx }], (fee) => [out(A.adr(next), val - fee)]);
  for (let j = 0; j < 3; j++) {
    const nx = { ...state, tally: state.tally + 1n };
    if (j === 0) { // probes on the first live box
      const xt = sparseTree(depth, new Map([[5 % n, blake2b(Buffer.from(L.xonly(X.k), "hex"))]]));
      await probe(d, "non_member_forged_proof", vb(X.k, L.xonly(X.k), xt.proof(5 % n), 5 % n, nx));
      await probe(d, "member_pk_wrong_signer", vb(X.k, L.xonly(V0.k), tree.proof(idxs[0]), idxs[0], nx));
      await probe(d, "tally_plus_two", vb(V0.k, L.xonly(V0.k), tree.proof(idxs[0]), idxs[0], { ...state, tally: state.tally + 2n }));
      await probe(d, "wrong_index", vb(V0.k, L.xonly(V0.k), tree.proof(idxs[0]), idxs[1], nx));
      await probe(d, "root_swap", vb(X.k, L.xonly(X.k), xt.proof(5 % n), 5 % n, { ...nx, root: L.hex(xt.root) }));
    }
    const b = vb(voters[j].k, L.xonly(voters[j].k), tree.proof(idxs[j]), idxs[j], nx);
    if (!(await act(d, "vote", b))) { s.fail++; return; } state = nx; op = { transactionId: b.tx.id, index: 0 }; val = b.tx.outputs[0].value;
  }
  await probe(d, "close_by_voter", L.buildSpend(A, state, op, val, "close", [{ sig: V0.k }], (fee) => [out(p2pk(V0.k), val - fee)]));
  const c = L.buildSpend(A, state, op, val, "close", [{ sig: Ow.k }], (fee) => [out(p2pk(Ow.k), val - fee)]);
  const ok = await act(d, "close", c); if (ok) { s.ok++; await payoutSweep(d, Ow.k, c.tx); } else s.fail++;
}
// ================= 4. SEALED-BID AUCTION =================
async function auction(path) {
  const d = "auction", A = ART.auction, s = st(d); s.inst++; const [Se, Ba, Bb, X] = await newKeys(4); const dep = 300000000n;
  const bidA = 50000000n + BigInt(crypto.randomInt(0, 150)) * 1000000n, bidB = 50000000n + BigInt(crypto.randomInt(0, 150)) * 1000000n;
  const b8 = (v) => { const x = Buffer.alloc(8); x.writeBigInt64LE(v); return x; }; const saltA = crypto.randomBytes(32), saltB = crypto.randomBytes(32);
  const st0 = { seller: L.xonly(Se.k), ba: L.xonly(Ba.k), bb: L.xonly(Bb.k), ha: L.hex(blake2b(Buffer.concat([b8(bidA), saltA]))), hb: L.hex(blake2b(Buffer.concat([b8(bidB), saltB]))), bidA: 0n, phase: 0n, dep, maxFee: MAXFEE, ttl: TTL };
  const pot = 2n * dep; L.reg({ design: d, keys: [Se.i, Ba.i, Bb.i, X.i], state: st0, bidA, bidB, saltA: L.hex(saltA), saltB: L.hex(saltB) });
  const f = await L.fund(A.adr(st0), pot); if (!f.ok) { s.fail++; log({ ev: "fund_fail", design: d, e: f.e }); return; }
  if (!(await L.waitAcc(f.tx.id))) { s.fail++; return; }
  const sp0 = (entry, args, outs, o) => L.buildSpend(A, st0, f.op, pot, entry, args, outs, o); const st1 = { ...st0, bidA, phase: 1n };
  await probe(d, "revealA_wrong_salt", sp0("revealA", [{ sig: Ba.k }, { data: L.hex(b8(bidA)) }, { data: L.hex(crypto.randomBytes(32)) }], (fee) => [out(A.adr(st1), pot - fee)]));
  await probe(d, "revealA_lower_bid_than_committed", sp0("revealA", [{ sig: Ba.k }, { data: L.hex(b8(bidA - 1n)) }, { data: L.hex(saltA) }], (fee) => [out(A.adr({ ...st1, bidA: bidA - 1n }), pot - fee)]));
  await probe(d, "revealA_signed_by_B", sp0("revealA", [{ sig: Bb.k }, { data: L.hex(b8(bidA)) }, { data: L.hex(saltA) }], (fee) => [out(A.adr(st1), pot - fee)]));
  await probe(d, "revealA_store_other_bid", sp0("revealA", [{ sig: Ba.k }, { data: L.hex(b8(bidA)) }, { data: L.hex(saltA) }], (fee) => [out(A.adr({ ...st1, bidA: 1n }), pot - fee)]));
  await probe(d, "timeout_early", sp0("timeout", [{ sig: Bb.k }], (fee) => [out(p2pk(Se.k), dep - fee), out(p2pk(Bb.k), dep)], { seq: TTL }));
  if (path === "A_stalls") { await waitAge(f.tx.id, TTL);
    await probe(d, "timeout_mature_by_staller", sp0("timeout", [{ sig: Ba.k }], (fee) => [out(p2pk(Se.k), dep - fee), out(p2pk(Ba.k), dep)], { seq: TTL }));
    await probe(d, "timeout_mature_seller_shorted", sp0("timeout", [{ sig: Bb.k }], (fee) => [out(p2pk(Se.k), 10000000n), out(p2pk(Bb.k), pot - 10000000n - fee)], { seq: TTL }));
    const b = sp0("timeout", [{ sig: Bb.k }], (fee) => [out(p2pk(Se.k), dep - fee), out(p2pk(Bb.k), dep)], { seq: TTL });
    const ok = await act(d, "timeout_A_stalls", b); s.paths[path] = (s.paths[path] || 0) + (ok ? 1 : 0); if (ok) { s.ok++; await payoutSweep(d, Se.k, b.tx, 0); await payoutSweep(d, Bb.k, b.tx, 1); } else s.fail++; return; }
  const bA = sp0("revealA", [{ sig: Ba.k }, { data: L.hex(b8(bidA)) }, { data: L.hex(saltA) }], (fee) => [out(A.adr(st1), pot - fee)]);
  if (!(await act(d, "revealA", bA))) { s.fail++; return; }
  const op1 = { transactionId: bA.tx.id, index: 0 }, v1 = bA.tx.outputs[0].value; const sp1 = (entry, args, outs, o) => L.buildSpend(A, st1, op1, v1, entry, args, outs, o);
  const aWins = bidA >= bidB, high = aWins ? bidA : bidB, W = aWins ? Ba : Bb, Lz = aWins ? Bb : Ba; const lose = dep - MAXFEE / 2n;
  const settle = (sellerAmt, wk, lk) => (fee) => [out(p2pk(Se.k), sellerAmt), out(p2pk(wk.k), v1 - sellerAmt - lose - fee), out(p2pk(lk.k), lose)];
  await probe(d, "revealB_underpay_seller", sp1("revealB", [{ sig: Bb.k }, { data: L.hex(b8(bidB)) }, { data: L.hex(saltB) }], settle(high - 10000000n, W, Lz)));
  await probe(d, "revealB_swap_winner", sp1("revealB", [{ sig: Bb.k }, { data: L.hex(b8(bidB)) }, { data: L.hex(saltB) }], (fee) => [out(p2pk(Se.k), high), out(p2pk(Lz.k), v1 - high - lose - fee), out(p2pk(W.k), lose)]));
  await probe(d, "revealB_wrong_salt", sp1("revealB", [{ sig: Bb.k }, { data: L.hex(b8(bidB)) }, { data: L.hex(crypto.randomBytes(32)) }], settle(high, W, Lz)));
  if (path === "B_stalls") { await waitAge(bA.tx.id, TTL); const b = sp1("timeout", [{ sig: Ba.k }], (fee) => [out(p2pk(Se.k), dep - MAXFEE / 2n), out(p2pk(Ba.k), v1 - dep + MAXFEE / 2n - fee)], { seq: TTL });
    const ok = await act(d, "timeout_B_stalls", b); s.paths[path] = (s.paths[path] || 0) + (ok ? 1 : 0); if (ok) { s.ok++; await payoutSweep(d, Se.k, b.tx, 0); await payoutSweep(d, Ba.k, b.tx, 1); } else s.fail++; return; }
  const bB = sp1("revealB", [{ sig: Bb.k }, { data: L.hex(b8(bidB)) }, { data: L.hex(saltB) }], settle(high, W, Lz));
  const ok = await act(d, "revealB_settle", bB); s.paths["winner_" + (aWins ? "A" : "B")] = (s.paths["winner_" + (aWins ? "A" : "B")] || 0) + (ok ? 1 : 0);
  if (ok) { s.ok++; await payoutSweep(d, Se.k, bB.tx, 0); await payoutSweep(d, W.k, bB.tx, 1); await payoutSweep(d, Lz.k, bB.tx, 2); } else s.fail++;
}
// ================= 6/7. CovTTT variants at fee tiers =================
const WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]; const winner = (c) => { for (const [a, b, e] of WINS) if (c[a] && c[a] === c[b] && c[b] === c[e]) return c[a]; return 0; };
function tttState(v, px, po, turn, c, maxFee) { if (v === "tttd") return { px, po, turn: BigInt(turn), board: c.map((x) => x.toString(16).padStart(2, "0")).join(""), maxFee };
  const o = { px, po, turn: BigInt(turn), maxFee }; c.forEach((x, i) => (o["c" + i] = BigInt(x))); return o; }
async function ttt(v, tier) { // tier = fee multiplier applied to /tmp/r6-feerate (which is already 2x node normal)
  const d = `${v}@${tier}x`, A = ART[v], s = st(d); s.inst++; const [Kx, Ko, X] = await newKeys(3); const px = L.xonly(Kx.k), po = L.xonly(Ko.k);
  const maxFee = v === "ttt1" ? 10000000n : MAXFEE; let c = Array(9).fill(0), turn = 0; let state = tttState(v, px, po, 0, c, maxFee); const pot = 400000000n;
  L.reg({ design: d, keys: [Kx.i, Ko.i, X.i], state }); const f = await L.fund(A.adr(state), pot); if (!f.ok) { s.fail++; log({ ev: "fund_fail", design: d, e: f.e }); return; }
  if (!(await L.waitAcc(f.tx.id))) { s.fail++; return; } let op = f.op, val = pot; const mult = tier;
  const withFee = (b) => b; const bs = (entry, args, outs, sgn) => { L.setFeeMult(mult); const r = L.buildSpend(A, state, op, val, entry, args, outs); L.setFeeMult(1); return r; };
  let probed = false;
  while (!winner(c) && c.some((x) => !x)) {
    const free = c.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0); const cell = free[crypto.randomInt(0, free.length)]; const k = turn === 0 ? Kx.k : Ko.k; const k2 = turn === 0 ? Ko.k : Kx.k;
    const nc = c.map((x, i) => (i === cell ? turn + 1 : x)); const ns = tttState(v, px, po, 1 - turn, nc, maxFee);
    if (!probed && c.some((x) => x)) { probed = true; const occ = c.findIndex((x) => x);
      await probe(d, "occupied_cell", bs("move", [{ sig: k }, { i64: occ }], (fee) => [out(A.adr(tttState(v, px, po, 1 - turn, c.map((x, i) => (i === occ ? turn + 1 : x)), maxFee)), val - fee)]));
      await probe(d, "wrong_signer", bs("move", [{ sig: k2 }, { i64: cell }], (fee) => [out(A.adr(ns), val - fee)]));
      await probe(d, "value_theft", bs("move", [{ sig: k }, { i64: cell }], (fee) => [out(A.adr(ns), 100000000n), out(p2pk(X.k), val - 100000000n - fee)]));
      await probe(d, "turn_not_flipped", bs("move", [{ sig: k }, { i64: cell }], (fee) => [out(A.adr(tttState(v, px, po, turn, nc, maxFee)), val - fee)])); }
    const b = bs("move", [{ sig: k }, { i64: cell }], (fee) => [out(A.adr(ns), val - fee)]);
    if (!(await act(d, "move", b))) { s.fail++; L.reg({ design: d, stuck: true, state, op, val }); return; }
    c = nc; turn = 1 - turn; state = ns; op = { transactionId: b.tx.id, index: 0 }; val = b.tx.outputs[0].value;
  }
  const w = winner(c);
  if (w) { const wk = w === 1 ? Kx.k : Ko.k; const lk = w === 1 ? Ko.k : Kx.k; const free = c.findIndex((x) => !x);
    if (free >= 0) await probe(d, "move_after_win", bs("move", [{ sig: turn === 0 ? Kx.k : Ko.k }, { i64: free }], (fee) => [out(A.adr(tttState(v, px, po, 1 - turn, c.map((x, i) => (i === free ? turn + 1 : x)), maxFee)), val - fee)]));
    await probe(d, "loser_claims", bs("claim", [{ sig: lk }, { i64: 3 - w }], (fee) => [out(p2pk(lk), val - fee)]));
    const b = bs("claim", [{ sig: wk }, { i64: w }], (fee) => [out(p2pk(wk), val - fee)]); const ok = await act(d, "claim", b);
    if (ok) { s.ok++; s.paths["win"] = (s.paths["win"] || 0) + 1; await payoutSweep(d, wk, b.tx); } else { s.fail++; L.reg({ design: d, stuck: true, state, op, val }); } }
  else { const b = bs("draw", [{ sig: Kx.k }], (fee) => { const half = (val - maxFee) / 2n; return [out(p2pk(Kx.k), half), out(p2pk(Ko.k), val - fee - half)]; });
    const ok = await act(d, "draw", b); if (ok) { s.ok++; s.paths["draw"] = (s.paths["draw"] || 0) + 1; await payoutSweep(d, Kx.k, b.tx, 0); await payoutSweep(d, Ko.k, b.tx, 1); } else { s.fail++; L.reg({ design: d, stuck: true, state, op, val }); } }
}
// ================= runner =================
const summary = () => Object.fromEntries(Object.entries(S).map(([k, s]) => [k, { inst: s.inst, ok: s.ok, fail: s.fail, success_rate: s.inst ? +(s.ok / s.inst).toFixed(3) : null, actions: s.actions, act_ok: s.act_ok,
  lat_p50: q(s.lat, 0.5), lat_p95: q(s.lat, 0.95), lat_n: s.lat.length, fee_tkas: Number(s.fee) / 1e8, fee_per_inst_tkas: s.ok ? +(Number(s.fee) / 1e8 / s.ok).toFixed(5) : null,
  mass: Object.fromEntries(Object.entries(s.mass).map(([a, m]) => [a, q(m, 0.5)])), probes: s.probes, rejected: s.rejected, reject_layer: s.layer || {}, ILLEGAL_ACCEPTED: s.ILLEGAL_ACCEPTED, by_probe: s.by_probe, paths: s.paths, errs: s.errs }]));
const rep = setInterval(() => log({ ev: "rep", summary: summary() }), 30000);
log({ ev: "start", rounds: ROUNDS, feerate: Number(L.fr()) });
const lim = async (tasks, n) => { const it = tasks[Symbol.iterator](); await Promise.all(Array.from({ length: n }, async () => { for (const t of it) { if (HALT()) return; try { await t(); } catch (e) { log({ ev: "task_error", e: L.errTxt(e), stack: String(e.stack || "").slice(0, 300) }); } } })); };
for (let r = 0; r < ROUNDS && !HALT(); r++) {
  const tasks = [];
  for (const p of ["release_buyer", "release_arbiter", "refund", "timeout"]) tasks.push(() => escrow(p));
  for (const p of ["happy", "happy", "A_stalls", "B_stalls"]) tasks.push(() => coinflip(p));
  for (const dp of [2, 4, 8, 12, 16]) tasks.push(() => vote(dp));
  for (const p of ["happy", "happy", "A_stalls", "B_stalls"]) tasks.push(() => auction(p));
  for (const v of ["ttt1", "ttte", "tttd"]) for (const tier of [0.5, 1, 3]) tasks.push(() => ttt(v, tier));
  await lim(tasks.sort(() => Math.random() - 0.5), Number(process.env.R8_CONC || 8));
  log({ ev: "round_done", round: r + 1, summary: summary() });
  for (let w = 0; w < GAP && !HALT(); w += 1000) await L.sleep(1000);
}
clearInterval(rep); log({ ev: "summary", summary: summary() }); console.log(JSON.stringify(summary(), null, 1)); process.exit(0);
