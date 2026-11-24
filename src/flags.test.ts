import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFacts, normalizeInvoice } from "./flags.js";
import { applyDecisions, decideInCode } from "./gate.js";
import type { Bill, BillLine } from "./types.js";

const T = { lookbackMonths: 12, priceCreepPct: 3, nearDuplicateDays: 10, noPoOver: 5000, overPoPct: 1 };
const NOW = new Date("2026-11-20T12:00:00Z");

const line = (key: string, qty: number | null, unitPrice: number | null, amount: number, poId: string | null = null): BillLine => ({
  description: key, key, qty, unitPrice, amount, poId,
});
let n = 0;
const bill = (p: Partial<Bill> & { lines: BillLine[] }): Bill => ({
  id: String(++n), vendorId: "v1", vendor: "Acme", invoiceNumber: `A-${n}`, date: "2026-11-10", dueDate: "2026-12-10",
  total: p.lines.reduce((s, l) => s + l.amount, 0), balance: p.lines.reduce((s, l) => s + l.amount, 0), note: null,
  poIds: [...new Set(p.lines.map((l) => l.poId).filter((x): x is string => !!x))], ...p,
});

test("invoice numbers normalize the way a human reads them", () => {
  assert.equal(normalizeInvoice("INV-0020417"), normalizeInvoice("inv 20417"));
  assert.equal(normalizeInvoice("RF-55102"), "RF55102");
  assert.equal(normalizeInvoice(null), null);
});

test("same invoice number as a paid bill is held by rule, never sent to the model", () => {
  const paid = bill({ invoiceNumber: "RF-55102", date: "2026-10-30", lines: [line("Freight", null, null, 1180)], balance: 0 });
  const again = bill({ invoiceNumber: "rf 55102", lines: [line("Freight", null, null, 1180)] });
  const [f] = buildFacts([paid, again], [], NOW, T);
  assert.equal(f.flags[0].kind, "duplicate_invoice");
  const d = decideInCode(f);
  assert.equal(d?.by, "rule");
  assert.equal(d?.decision.verdict, "hold");
});

test("unit price rise over the threshold is flagged, under it is not", () => {
  const prior = bill({ date: "2026-10-01", balance: 0, lines: [line("Bags", 100, 0.36, 36), line("Labels", 100, 0.045, 4.5)] });
  const next = bill({ lines: [line("Bags", 100, 0.405, 40.5), line("Labels", 100, 0.046, 4.6)] });
  const [f] = buildFacts([prior, next], [], NOW, T);
  assert.deepEqual(f.flags.map((x) => x.kind), ["price_creep"]);
  assert.equal(f.flags[0].kind === "price_creep" && f.flags[0].pct, 12.5);
});

test("two bills against one PO that add up past it are flagged", () => {
  const po = { id: "1043", number: "PO-1043", vendor: "Acme", date: "2026-10-01", total: 18400, status: "Closed", note: null };
  const first = bill({ date: "2026-10-21", balance: 0, lines: [line("Huila", 40, 460, 18400, "1043")] });
  const second = bill({ lines: [line("Huila", 40, 460, 18400, "1043")] });
  const [f] = buildFacts([first, second], [po], NOW, T);
  const over = f.flags.find((x) => x.kind === "over_po");
  assert.ok(over && over.kind === "over_po" && over.billedAgainstPo === 36800 && over.pct === 100);
});

test("a first bill from a new vendor over the limit with no PO is flagged", () => {
  const [f] = buildFacts([bill({ vendorId: "new", lines: [line("License", null, null, 9800)] })], [], NOW, T);
  assert.deepEqual(f.flags.map((x) => x.kind), ["new_vendor_no_po"]);
});

test("a clean bill is clear to pay without a model call", () => {
  const [f] = buildFacts([bill({ vendorId: "solo", lines: [line("Cleaning", null, null, 1250)] })], [], NOW, T);
  assert.equal(decideInCode(f)?.decision.verdict, "pay");
});

test("the gate holds a flagged bill the model skipped and ignores invented ids", () => {
  const [f] = buildFacts([bill({ vendorId: "new2", lines: [line("License", null, null, 9800)] })], [], NOW, T);
  const { reviewed, dropped } = applyDecisions([f], {
    decisions: [{ billId: "does-not-exist", verdict: "pay", reason: "x", ask: null }],
  });
  assert.equal(reviewed[0].by, "fallback");
  assert.equal(reviewed[0].decision.verdict, "hold");
  assert.deepEqual(dropped, ["does-not-exist"]);
});
