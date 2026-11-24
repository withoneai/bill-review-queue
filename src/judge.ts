import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CLAUDE_MODEL, MODEL_DEMO, RECORD, loadFixture, loadPolicy } from "./config.js";
import { describeFlag, money, unit } from "./flags.js";
import type { BillFacts } from "./types.js";

export const DecisionsSchema = z.object({
  decisions: z.array(
    z.object({
      billId: z.string(),
      verdict: z.enum(["pay", "hold"]),
      reason: z.string(),
      ask: z.object({ to: z.string(), question: z.string() }).nullable(),
    }),
  ),
});
export type ModelDecisions = z.infer<typeof DecisionsSchema>;

function describeBill(f: BillFacts): string {
  const b = f.bill;
  const lines = [
    `### billId: ${b.id}`,
    `Vendor: ${b.vendor}`,
    `Invoice: ${b.invoiceNumber ?? "(no number)"}, dated ${b.date}, due ${b.dueDate ?? "(no due date)"}${f.daysUntilDue !== null ? ` (${f.daysUntilDue} days)` : ""}`,
    `Total: ${money(b.total)}, open balance ${money(b.balance)}`,
    `Lines:`,
    ...b.lines.map(
      (l) =>
        `  - ${l.description}: ${l.qty !== null && l.unitPrice !== null ? `${l.qty} x ${unit(l.unitPrice)} = ` : ""}${money(l.amount)}${l.poId ? ` (on PO ${f.pos.find((p) => p.id === l.poId)?.number ?? l.poId})` : ""}`,
    ),
    `Private note on the bill: ${b.note ?? "(none)"}`,
  ];
  for (const po of f.pos) {
    lines.push(`Purchase order ${po.number}: ${money(po.total)}, dated ${po.date}, ${po.status ?? "status unknown"}. Note: ${po.note ?? "(none)"}`);
  }
  lines.push(
    `Earlier bills from this vendor in the window: ${
      f.history.length
        ? f.history.slice(0, 4).map((h) => `${h.invoiceNumber ?? h.id} on ${h.date} for ${money(h.total)} (${h.balance === 0 ? "paid" : "unpaid"}): ${h.lines.map((l) => l.description).join("; ")}`).join(" | ")
        : "none, this is the first"
    }`,
    `Flags raised in code:`,
    ...f.flags.map((fl) => `  - ${describeFlag(fl)}`),
  );
  return lines.join("\n");
}

/** Kept separate from the call so the exact prompt can be read, tested and recorded. */
export function buildPrompt(flagged: BillFacts[]): string {
  return `You review unpaid vendor bills before the weekly payment run. Code has already checked every open bill and flagged the ones below; every bill not listed here is clear to pay and is not your concern. Every fact and every flag below was established in code from the books. Do not re-derive them. Your job is the call on each bill: pay it in this run, or hold it until someone answers one question.

## Our accounts payable policy

${loadPolicy()}

## The flagged bills

${flagged.map(describeBill).join("\n\n")}

## Instructions

- One decision per billId above, with billId copied exactly.
- verdict: "pay" or "hold", per the policy.
- reason: one or two sentences naming the fact that drove the call, with the numbers.
- ask: for a hold, who has to answer ("to": a named person from the notes, or a role such as "AP" or "Receiving") and the one-line question. Null when the verdict is pay.
- Never invent a fact, a person, a phone call or a document that is not given above.
- No em dashes or en dashes anywhere. Use a comma, period, colon or parentheses.`;
}

export interface JudgeResult {
  output: ModelDecisions;
  usage: { input_tokens: number; output_tokens: number } | null;
}

/** $ per token for the cost line. Claude Opus 5.5: $4 in, $20 out per million. */
const PRICE = { input: 4 / 1_000_000, output: 20 / 1_000_000 };

/**
 * One Claude call for the whole queue: every flagged bill with its lines, its
 * purchase order, the vendor's recent history and the flags code raised.
 * Which bills reach this function is decided in code (src/flags.ts); what
 * comes back is checked in code (src/gate.ts). Without an Anthropic key this
 * returns the output Claude actually produced for the recorded books.
 */
export async function judgeBills(flagged: BillFacts[]): Promise<JudgeResult> {
  if (flagged.length === 0) return { output: { decisions: [] }, usage: null };
  if (MODEL_DEMO) return { output: DecisionsSchema.parse(loadFixture("decisions.json")), usage: null };

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    messages: [{ role: "user", content: buildPrompt(flagged) }],
    output_config: { effort: "high", format: zodOutputFormat(DecisionsSchema) },
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to review these bills.");
  if (!response.parsed_output) throw new Error("Claude returned output that did not match the schema.");

  const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };
  if (RECORD) {
    writeFileSync(new URL("../fixtures/decisions.json", import.meta.url), JSON.stringify(response.parsed_output, null, 2) + "\n");
    writeFileSync(
      new URL("../fixtures/decisions.meta.json", import.meta.url),
      JSON.stringify(
        {
          model: response.model,
          recorded_at: new Date().toISOString().slice(0, 10),
          ...usage,
          cost_usd: Math.round((usage.input_tokens * PRICE.input + usage.output_tokens * PRICE.output) * 10000) / 10000,
          note: "One real Claude call on the exact prompt src/judge.ts builds for the recorded books. npm start replays it when no ANTHROPIC_API_KEY is set.",
        },
        null,
        2,
      ) + "\n",
    );
  }
  return { output: response.parsed_output, usage };
}

export function costOf(usage: { input_tokens: number; output_tokens: number }): number {
  return usage.input_tokens * PRICE.input + usage.output_tokens * PRICE.output;
}
