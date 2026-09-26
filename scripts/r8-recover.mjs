// R8: find and recover stranded covenant pots from the 0600 registry. For each registered instance, compute its
// initial covenant address, query the live public UTXO API, and if a pot is still there, spend via its timeout path
// (escrow/coinflip/auction) after maturity, or close (vote), paying the honest party; then sweep to faucet. Never prints keys.
import { readFileSync, appendFileSync } from "node:fs"; import * as L from "./r8-lib.mjs"; import { blake2b } from "./r8-blake2b.mjs";
const { kaspa, addrOf } = L; const LOG = `${L.D}/logs/round8/recover.jsonl`; const log = (o) => { const s = JSON.stringify({ t: new Date().toISOString(), ...o }, (k, v) => typeof v === "bigint" ? v.toString() : v); appendFileSync(LOG, s + "\n"); console.log(s); };
const ART = { escrow: L.loadArt("r8/escrow.json"), coinflip: L.loadArt("r8/coinflip.json"), auction: L.loadArt("r8/auction.json") };
const rows = readFileSync(L.REG, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.state && r.keys && ART[r.design]);
const big = (st, A) => Object.fromEntries(Object.entries(st).map(([k, v]) => [k, A.fields.find((f) => f.name === k)?.type.kind === "int" ? BigInt(v) : v]));
// also phase-1 states (after A revealed): coinflip ra = sa; auction bidA = registered bid
const ph1 = (r) => r.design === "coinflip" && r.sa ? { ...r.state, ra: r.sa, phase: "1" } : r.design === "auction" && r.bidA ? { ...r.state, bidA: String(r.bidA), phase: "1" } : null;
for (const r of [...rows]) { const p = ph1(r); if (p) rows.push({ ...r, state: p, phase1: true }); }
const addrs = rows.map((r) => ART[r.design].adr(big(r.state, ART[r.design])));
const found = []; for (let i = 0; i < addrs.length; i += 50) { const r = await fetch("https://api-tn10.kaspa.org/addresses/utxos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ addresses: addrs.slice(i, i + 50) }) }); for (const u of await r.json()) found.push(u); }
log({ ev: "scan", registered: rows.length, utxos: found.length });
const TTL = 100n, MAXFEE = 10000000n; let rec = 0, tk = 0;
for (const u of found) { const i = addrs.indexOf(u.address); const r = rows[i]; const A = ART[r.design]; const st = big(r.state, A); const ks = r.keys.map((n) => L.deriveKey("r8", n));
  const op = { transactionId: u.outpoint.transactionId, index: u.outpoint.index }; const amt = BigInt(u.utxoEntry.amount); const d0 = BigInt(u.utxoEntry.blockDaaScore);
  while ((await L.vdaa()) - d0 < TTL + 5n) await L.sleep(1000);
  const out = (k, a) => ({ address: addrOf(k), amount: a }); let b, pay;
  if (r.design === "escrow") { b = L.buildSpend(A, st, op, amt, "timeout", [{ sig: ks[0] }], (fee) => [out(ks[0], amt - fee)], { seq: TTL }); pay = [[ks[0], 0]]; }
  else if (r.design === "coinflip") { const w = r.phase1 ? ks[0] : ks[1]; b = L.buildSpend(A, st, op, amt, "timeout", [{ sig: w }], (fee) => [out(w, amt - fee)], { seq: TTL }); pay = [[w, 0]]; }
  else { const dep = st.dep; const h = r.phase1 ? ks[1] : ks[2]; b = L.buildSpend(A, st, op, amt, "timeout", [{ sig: h }], (fee) => [out(ks[0], dep - MAXFEE), out(h, amt - dep + MAXFEE - fee)], { seq: TTL }); pay = [[ks[0], 0], [h, 1]]; }
  const s = await L.submit(b.tx); log({ ev: "recover", design: r.design, phase1: !!r.phase1, ok: s.ok, e: s.e, tkas: Number(amt) / 1e8 });
  if (s.ok && (await L.waitAcc(b.tx.id, 120000))) { rec++; tk += Number(amt) / 1e8; for (const [k, idx] of pay) { const w = await L.sweep(k, { transactionId: b.tx.id, index: idx }, b.tx.outputs[idx].value); log({ ev: "sweep", ok: w.ok, e: w.e }); } } }
log({ ev: "done", recovered: rec, tkas: tk }); process.exit(0);
