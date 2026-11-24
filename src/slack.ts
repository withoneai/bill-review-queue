import * as slack from "@withone/sdk/slack";
import { connections, oneClient, slackChannel } from "./config.js";
import { money } from "./flags.js";
import type { Reviewed } from "./types.js";

const sum = (rs: Reviewed[]) => rs.reduce((s, r) => s + r.facts.bill.balance, 0);
const label = (r: Reviewed) => `${r.facts.bill.vendor} ${r.facts.bill.invoiceNumber ?? ""}`.trim();

export function briefText(reviewed: Reviewed[], runDay: string): string {
  const pay = reviewed.filter((r) => r.decision.verdict === "pay");
  const hold = reviewed.filter((r) => r.decision.verdict === "hold");
  const lines = [
    `*Bills to review before the payment run, ${runDay}*`,
    "",
    `${reviewed.length} unpaid bills, ${money(sum(reviewed))}. Clear to pay: ${pay.length} (${money(sum(pay))}). Hold: ${hold.length} (${money(sum(hold))}).`,
  ];
  for (const r of hold) {
    const b = r.facts.bill;
    lines.push("", `:double_vertical_bar: *${label(r)}*, ${money(b.balance)}, due ${b.dueDate ?? "n/a"}`, `    ${r.decision.reason}`);
    if (r.decision.ask) lines.push(`    _Ask ${r.decision.ask.to}:_ ${r.decision.ask.question}`);
  }
  const cleared = pay.filter((r) => r.by === "model");
  if (cleared.length) {
    lines.push("", "*Flagged, then cleared:*");
    for (const r of cleared) lines.push(`    ${label(r)}: ${r.decision.reason}`);
  }
  const clean = pay.filter((r) => r.by === "clean");
  if (clean.length) {
    lines.push("", `No flags: ${clean.map((r) => `${label(r)} (${money(r.facts.bill.balance)})`).join(", ")}.`);
  }
  lines.push("", "_Nothing was paid or changed in QuickBooks. Pay from your usual run._");
  return lines.join("\n");
}

export async function postBrief(text: string): Promise<void> {
  const res = await oneClient()
    .connection(connections.slack())
    .run(slack.sendMessageChannelChatPostmessage({ body: { channel: slackChannel(), text } }));
  const data = res.data as { ok?: boolean; error?: string };
  if (data?.ok === false) throw new Error(`Slack rejected the message: ${data.error}`);
}
