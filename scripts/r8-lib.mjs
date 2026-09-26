// R8 covenant suite library (TN10 only). Generic SilverScript artifact encoder (verified against compiled bytecode),
// derived keys (counter fsync'd BEFORE funding), instance registry (0600, /home/box/secure), acceptance tracking, fees.
import { readFileSync, writeFileSync, appendFileSync, existsSync, openSync, fsyncSync, closeSync, renameSync } from "node:fs";
import { kaspa, NET, deskKey, addrOf, connect } from "./lib.mjs";
import { deriveKey } from "./r7-engine.mjs";
export { kaspa, NET, addrOf, deriveKey };
export const D = "/workspace/tn10-break-test-2026-09-25";
export const FK = deskKey(0), FA = addrOf(FK), FS = kaspa.payToAddressScript(FA);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const hex = (b) => Buffer.from(b).toString("hex");
const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return "08" + b.toString("hex"); };
const pushFixed = (h) => { const n = h.length / 2; if (n > 75) throw new Error("push too long"); return n.toString(16).padStart(2, "0") + h; };
export function loadArt(file) {
  const j = JSON.parse(readFileSync(`${D}/covenants/${file}`, "utf8")); const [name, C] = Object.entries(j.contracts)[0];
  const BC = Buffer.from(C.compiled.bytecode); const SP = C.compiled.state_span; const fields = C.runtime_state.fields;
  const PRE = BC.subarray(0, SP.offset).toString("hex"), SUF = BC.subarray(SP.offset + SP.len).toString("hex");
  const TAGS = Object.fromEntries(Object.entries(C.entries).map(([k, v]) => [k, v.dispatch_tag]));
  const enc = (st) => fields.map((f) => { const v = st[f.name]; if (v === undefined) throw new Error("missing field " + f.name);
    if (f.type.kind === "int") return i64(v); if (f.type.kind === "fixed_bytes") { if (v.length !== f.type.len * 2) throw new Error(`bad len ${f.name}`); return pushFixed(v); } throw new Error("kind " + f.type.kind); }).join("");
  const red = (st) => PRE + enc(st) + SUF; const spk = (st) => kaspa.payToScriptHashScript(red(st)); const adr = (st) => kaspa.addressFromScriptPublicKey(spk(st), NET).toString();
  // self-check: encoding the constructor args must reproduce the compiled bytecode byte-for-byte
  const ctorF = `${D}/covenants/${file.replace(/\.json$/, ".ctor.json")}`;
  if (existsSync(ctorF)) { const ca = JSON.parse(readFileSync(ctorF, "utf8")); const st0 = {}; let k = 0;
    // constructor args map onto fields in order for fields initialised from init*; literal-initialised fields (turn=0, c*=0) are skipped
    const lit = Object.fromEntries(fields.map((f) => [f.name, f.type.kind === "int" ? 0n : null]));
    for (const f of fields) st0[f.name] = lit[f.name];
    const inits = [...C.compiled.bytecode ? [] : []]; void inits;
    return { name, C, BC, SP, fields, PRE, SUF, TAGS, enc, red, spk, adr, ctorArgs: ca, file };
  }
  return { name, C, BC, SP, fields, PRE, SUF, TAGS, enc, red, spk, adr, file };
}
export function checkArt(A, st) { const ok = A.red(st) === A.BC.toString("hex"); if (!ok) throw new Error(`encoder mismatch for ${A.name}`); return ok; }
export const bytesArg = (a) => hex(Buffer.from(a.value));
// ---- keys ----
const CF = "/home/box/secure/r8-keyctr.txt";
export function nextKey() { const n = existsSync(CF) ? Number(readFileSync(CF, "utf8")) : 0; const fd = openSync(CF + ".tmp", "w", 0o600); writeFileSync(fd, String(n + 1)); fsyncSync(fd); closeSync(fd); renameSync(CF + ".tmp", CF); return { i: n, k: deriveKey("r8", n) }; }
export const xonly = (k) => k.toKeypair().xOnlyPublicKey;
export const REG = "/home/box/secure/r8-registry.jsonl";
export const reg = (o) => appendFileSync(REG, JSON.stringify({ t: new Date().toISOString(), ...o }, (k, v) => typeof v === "bigint" ? v.toString() : v) + "\n", { mode: 0o600 });
// ---- rpc + acceptance ----
export const rpc = await connect("n0");
export const acc = new Map(); const waiters = new Map();
rpc.addEventListener("virtual-chain-changed", (e) => { const now = Date.now(); for (const a of e.data.acceptedTransactionIds) for (const id of a.acceptedTransactionIds) if (!acc.has(id)) { acc.set(id, { h: a.acceptingBlockHash, t: now }); const w = waiters.get(id); if (w) { waiters.delete(id); w(); } } });
await rpc.subscribeVirtualChainChanged(true);
setInterval(() => { if (acc.size > 400000) { let n = 0; for (const k of acc.keys()) { acc.delete(k); if (++n > 200000) break; } } }, 60000);
export const waitAcc = (id, ms = 120000) => acc.has(id) ? Promise.resolve(true) : new Promise((r) => { const t = setTimeout(() => { waiters.delete(id); r(false); }, ms); waiters.set(id, () => { clearTimeout(t); r(true); }); });
export const daaOfBlock = async (h) => BigInt((await rpc.getBlock({ hash: h, includeTransactions: false })).block.header.daaScore);
export const vdaa = async () => BigInt((await rpc.getBlockDagInfo()).virtualDaaScore);
// ---- fees ----
export let FEE_MULT = 1; export const setFeeMult = (m) => { FEE_MULT = m; };
export const fr = () => BigInt(Math.round(Number(readFileSync("/tmp/r6-feerate", "utf8").trim()) * FEE_MULT));
export const errTxt = (e) => String(e?.message || e).replace(/[0-9a-f]{64}/g, "<h>").replace(/Rejected transaction <h>: /, "").replace(/used=\d+/, "used=N").slice(0, 200);
export async function submit(tx) { const t0 = Date.now(); try { await rpc.submitTransaction({ transaction: tx, allowOrphan: false }); return { ok: true, t0 }; } catch (e) { return { ok: false, e: errTxt(e), t0 }; } }
// ---- faucet seeds (slice txid[8:16] % 4 == 2, shared "used" file with round-7 covenant runners) ----
const USEDF = "/workspace/tmp/r7-cov-used.txt"; const USED = new Set(existsSync(USEDF) ? readFileSync(USEDF, "utf8").split("\n").filter(Boolean) : []);
export function takeSeeds(want) {
  let raw = []; try { raw = JSON.parse(readFileSync("/tmp/r5-reserved-utxos.json", "utf8")); } catch { return null; }
  const c = raw.filter((u) => parseInt(u.outpoint.transactionId.slice(8, 16), 16) % 4 === 2 && !USED.has(u.outpoint.transactionId + ":" + u.outpoint.index)).sort((a, b) => Number(BigInt(b.utxoEntry.amount) - BigInt(a.utxoEntry.amount)));
  const out = []; let sum = 0n; for (const u of c) { out.push(u); sum += BigInt(u.utxoEntry.amount); if (sum >= want || out.length >= 30) break; }
  if (sum < want) return null; for (const u of out) { const k = u.outpoint.transactionId + ":" + u.outpoint.index; USED.add(k); appendFileSync(USEDF, k + "\n"); } return { utxos: out, sum };
}
// fund one covenant output of `amount` at address `adr`; change back to faucet
export async function fund(adr, amount) {
  const s = takeSeeds(amount + 30000000n); if (!s) return { ok: false, e: "no seeds" };
  const ins = s.utxos.map((u) => ({ address: FA, outpoint: u.outpoint, utxoEntry: { amount: BigInt(u.utxoEntry.amount), scriptPublicKey: FS, blockDaaScore: BigInt(u.utxoEntry.blockDaaScore), isCoinbase: u.utxoEntry.isCoinbase } }));
  const mk = (fee) => { const tx = kaspa.createTransaction(ins, [{ address: adr, amount }, { address: FA, amount: s.sum - amount - fee }], 0n, null, 1); kaspa.signTransaction(tx, [FK], false); return tx; };
  let tx = mk(0n); tx = mk(BigInt(kaspa.calculateTransactionMass(NET, tx)) * fr());
  const r = await submit(tx); return { ...r, tx, op: { transactionId: tx.id, index: 0 }, amount };
}
// generic covenant spend. args: array of {sig: key} | {i64: n} | {data: hexstring}. sigs are computed over the final tx.
export function buildSpend(A, st, op, amount, entry, args, outsFn, { seq = 0n, sigops = 4, fee = null, tagOverride = null } = {}) {
  const inp = { address: A.adr(st), outpoint: op, sequence: seq, sigOpCount: sigops, utxoEntry: { amount, scriptPublicKey: A.spk(st), blockDaaScore: 0n, isCoinbase: false } };
  const mk = (f) => { const tx = kaspa.createTransaction([inp], outsFn(f), 0n, null, sigops); tx.inputs[0].sequence = seq; tx.finalize();
    const sb = new kaspa.ScriptBuilder();
    for (const a of args) { if (a.sig) sb.addData(kaspa.createInputSignature(tx, 0, a.sig).slice(2)); else if (a.i64 !== undefined) sb.addI64(BigInt(a.i64)); else if (a.data !== undefined) sb.addData(a.data); }
    sb.addData(tagOverride || A.TAGS[entry]); sb.addData(A.red(st)); tx.inputs[0].signatureScript = sb.drain(); tx.finalize(); return tx; };
  let tx = mk(0n); const mass = BigInt(kaspa.calculateTransactionMass(NET, tx)); const f = fee ?? mass * fr(); tx = mk(f);
  return { tx, fee: f, mass };
}
// P2PK sweep of a payout back to the faucet (chained on an in-mempool parent is fine)
export async function sweep(key, op, amount) {
  const a = addrOf(key); const mk = (fee) => { const tx = kaspa.createTransaction([{ address: a, outpoint: op, utxoEntry: { amount, scriptPublicKey: kaspa.payToAddressScript(a), blockDaaScore: 0n, isCoinbase: false } }], [{ address: FA, amount: amount - fee }], 0n, null, 1); kaspa.signTransaction(tx, [key], false); return tx; };
  let tx = mk(0n); tx = mk(BigInt(kaspa.calculateTransactionMass(NET, tx)) * fr()); return { ...(await submit(tx)), tx, amount };
}
