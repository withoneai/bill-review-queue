import type { Thresholds } from "./config.js";
import type { Bill, BillFacts, Flag, PurchaseOrder } from "./types.js";

export const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Unit prices keep their third decimal: $0.405 a bag is not $0.41. */
export const unit = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** "INV-0020417", "inv 20417" and "20417" are the same invoice to a human, so they are the same here. */
export function normalizeInvoice(n: string | null): string | null {
  if (!n) return null;
  const digitsAndLetters = n.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(INV|INVOICE|NO)/, "").replace(/^0+/, "");
  return digitsAndLetters || null;
}

/**
 * Everything code can establish about every unpaid bill, before any model is
 * asked anything. A bill with no flags is clear to pay on arithmetic alone and
 * never reaches the model.
 */
export function buildFacts(bills: Bill[], pos: PurchaseOrder[], now: Date, t: Thresholds): BillFacts[] {
  const today = now.toISOString().slice(0, 10);
  const byVendor = new Map<string, Bill[]>();
  for (const b of bills) byVendor.set(b.vendorId, [...(byVendor.get(b.vendorId) ?? []), b]);
  const poById = new Map(pos.map((p) => [p.id, p]));
  const billsByPo = new Map<string, Bill[]>();
  for (const b of bills) for (const id of b.poIds) billsByPo.set(id, [...(billsByPo.get(id) ?? []), b]);

  const open = bills.filter((b) => b.balance > 0).sort((a, b) => (a.dueDate ?? a.date).localeCompare(b.dueDate ?? b.date));

  return open.map((bill) => {
    const flags: Flag[] = [];
    const others = (byVendor.get(bill.vendorId) ?? []).filter((o) => o.id !== bill.id);
    const inv = normalizeInvoice(bill.invoiceNumber);

    // Same vendor, same invoice number: a duplicate, whatever the amount says.
    for (const o of others) {
      if (inv && normalizeInvoice(o.invoiceNumber) === inv) {
        flags.push({ kind: "duplicate_invoice", otherBillId: o.id, otherInvoice: o.invoiceNumber, otherDate: o.date, otherPaid: o.balance === 0 });
      }
    }

    // Same vendor, same total, close dates, different invoice number: maybe a
    // re-key, maybe two real jobs. This one is a question, not a rule.
    for (const o of others) {
      const gap = Math.abs(days(o.date, bill.date));
      const sameInvoice = inv && normalizeInvoice(o.invoiceNumber) === inv;
      if (!sameInvoice && o.total === bill.total && gap <= t.nearDuplicateDays) {
        flags.push({ kind: "near_duplicate", otherBillId: o.id, otherInvoice: o.invoiceNumber, otherDate: o.date, days: gap });
      }
    }

    // Unit price on each item line against the same item on this vendor's
    // most recent earlier bill.
    const earlier = others.filter((o) => o.date < bill.date).sort((a, b) => b.date.localeCompare(a.date));
    for (const line of bill.lines) {
      if (line.unitPrice === null) continue;
      const prior = earlier.find((o) => o.lines.some((l) => l.key === line.key && l.unitPrice !== null));
      const was = prior?.lines.find((l) => l.key === line.key)?.unitPrice;
      if (!prior || !was) continue;
      const pct = Math.round(((line.unitPrice - was) / was) * 1000) / 10;
      if (pct > t.priceCreepPct) {
        flags.push({ kind: "price_creep", item: line.key, was, now: line.unitPrice, pct, lastBillDate: prior.date });
      }
    }

    // Everything billed against each PO this bill touches, against the PO total.
    for (const poId of bill.poIds) {
      const po = poById.get(poId);
      if (!po) continue;
      const against = (billsByPo.get(poId) ?? []).reduce(
        (sum, b) => sum + b.lines.filter((l) => l.poId === poId).reduce((s, l) => s + l.amount, 0),
        0,
      );
      const pct = Math.round(((against - po.total) / po.total) * 1000) / 10;
      if (pct > t.overPoPct) {
        flags.push({
          kind: "over_po",
          poNumber: po.number,
          poTotal: po.total,
          billedAgainstPo: against,
          pct,
          poStatus: po.status,
          otherBills: (billsByPo.get(poId) ?? []).filter((b) => b.id !== bill.id).map((b) => b.invoiceNumber ?? b.id),
        });
      }
    }

    // Lines on a PO-backed bill that no PO covers: the extra part, the add-on.
    if (bill.poIds.length) {
      const off = bill.lines.filter((l) => l.poId === null);
      if (off.length) {
        flags.push({
          kind: "off_po_lines",
          poNumber: poById.get(bill.poIds[0])?.number ?? bill.poIds[0],
          lines: off.map((l) => `${l.description} (${money(l.amount)})`),
          amount: off.reduce((s, l) => s + l.amount, 0),
        });
      }
    }

    // A vendor this company has never been billed by before, a big amount, no PO.
    if (others.length === 0 && bill.poIds.length === 0 && bill.total > t.noPoOver) {
      flags.push({ kind: "new_vendor_no_po", amount: bill.total });
    }

    return {
      bill,
      flags,
      daysUntilDue: bill.dueDate ? days(today, bill.dueDate) : null,
      history: earlier,
      pos: bill.poIds.map((id) => poById.get(id)).filter((p): p is PurchaseOrder => Boolean(p)),
    };
  });
}

export function describeFlag(f: Flag): string {
  switch (f.kind) {
    case "duplicate_invoice":
      return `Same invoice number as ${f.otherInvoice ?? `bill ${f.otherBillId}`} entered ${f.otherDate}, which is ${f.otherPaid ? "already paid" : "also unpaid"}.`;
    case "near_duplicate":
      return `Same vendor and same total as invoice ${f.otherInvoice ?? f.otherBillId} dated ${f.otherDate}, ${f.days} day(s) apart, different invoice number.`;
    case "price_creep":
      return `${f.item}: unit price ${unit(f.now)}, up ${f.pct}% on ${unit(f.was)} on this vendor's bill of ${f.lastBillDate}.`;
    case "over_po":
      return `${f.poNumber} (${f.poStatus ?? "status unknown"}) is for ${money(f.poTotal)}; ${money(f.billedAgainstPo)} has now been billed against it, ${f.pct}% over${f.otherBills.length ? `, including invoice ${f.otherBills.join(", ")}` : ""}.`;
    case "off_po_lines":
      return `Lines not on ${f.poNumber}: ${f.lines.join("; ")}.`;
    case "new_vendor_no_po":
      return `First bill ever from this vendor, ${money(f.amount)}, with no purchase order behind it.`;
  }
}
