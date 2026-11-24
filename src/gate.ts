import { money } from "./flags.js";
import type { ModelDecisions } from "./judge.js";
import type { BillFacts, Reviewed } from "./types.js";

/**
 * Bills code can decide without a model: no flags means clear to pay; a
 * duplicate invoice number means hold, always. No policy wording should be
 * able to talk a model into paying the same invoice twice.
 */
export function decideInCode(f: BillFacts): Reviewed | null {
  if (f.flags.length === 0) {
    return { facts: f, by: "clean", decision: { billId: f.bill.id, verdict: "pay", reason: "No flags.", ask: null } };
  }
  const dup = f.flags.find((fl) => fl.kind === "duplicate_invoice");
  if (dup && dup.kind === "duplicate_invoice") {
    return {
      facts: f,
      by: "rule",
      decision: {
        billId: f.bill.id,
        verdict: "hold",
        reason: `Invoice ${f.bill.invoiceNumber} from ${f.bill.vendor} for ${money(f.bill.total)} was already entered on ${dup.otherDate}${dup.otherPaid ? " and paid" : ""}. This is the same invoice entered twice.`,
        ask: { to: "AP", question: `Void this copy of ${f.bill.invoiceNumber} in QuickBooks, or confirm with ${f.bill.vendor} that it is a different invoice reusing the number.` },
      },
    };
  }
  return null;
}

/**
 * Takes the model's decisions and keeps only what can be trusted: a decision
 * for a bill that was not sent is dropped, and a flagged bill the model did
 * not decide is held, never paid by default.
 */
export function applyDecisions(flagged: BillFacts[], output: ModelDecisions): { reviewed: Reviewed[]; dropped: string[] } {
  const sent = new Map(flagged.map((f) => [f.bill.id, f]));
  const dropped = output.decisions.filter((d) => !sent.has(d.billId)).map((d) => d.billId);
  const byId = new Map(output.decisions.filter((d) => sent.has(d.billId)).map((d) => [d.billId, d]));
  const reviewed = flagged.map((f): Reviewed => {
    const d = byId.get(f.bill.id);
    if (!d) {
      return {
        facts: f,
        by: "fallback",
        decision: { billId: f.bill.id, verdict: "hold", reason: "The review returned no decision for this flagged bill, so it is held.", ask: { to: "AP", question: "Review the flags on this bill by hand." } },
      };
    }
    return { facts: f, by: "model", decision: { ...d, ask: d.verdict === "pay" ? null : d.ask ?? { to: "AP", question: "Review the flags on this bill by hand." } } };
  });
  return { reviewed, dropped };
}
