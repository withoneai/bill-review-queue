import { BOOKS_DEMO, MODEL_DEMO, demoReason, runDate, slackConfigured, thresholds } from "./config.js";
import { readBooks } from "./quickbooks.js";
import { buildFacts, describeFlag, money } from "./flags.js";
import { costOf, judgeBills } from "./judge.js";
import { applyDecisions, decideInCode } from "./gate.js";
import { briefText, postBrief } from "./slack.js";
import type { BillFacts, Reviewed } from "./types.js";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    [
      "Usage:",
      "  npm start                 review every unpaid bill, post the brief to Slack if configured",
      "  npm start -- --dry-run    print the brief, post nothing",
      "  npm start -- --demo       replay the recorded books and the recorded Claude call, no keys",
      "  npm start -- --record     (with ANTHROPIC_API_KEY) save Claude's output as the demo fixture",
    ].join("\n"),
  );
  process.exit(0);
}
const dryRun = args.includes("--dry-run");

const now = runDate();
const since = new Date(now);
since.setUTCMonth(since.getUTCMonth() - thresholds.lookbackMonths);
const today = now.toISOString().slice(0, 10);

console.log(`── bill review queue${BOOKS_DEMO ? ` (demo: ${demoReason()})` : ""}\n`);
if (BOOKS_DEMO) {
  console.log("   Replaying the recorded books of Larkspur Coffee Roasters, a fictional company.");
  console.log(
    MODEL_DEMO
      ? "   Claude's calls are the recorded output of one real run on these books.\n"
      : "   Claude is judging them live with your ANTHROPIC_API_KEY.\n",
  );
}

const { bills, pos } = await readBooks(since);
const facts = buildFacts(bills, pos, now, thresholds);
const open = money(facts.reduce((s, f) => s + f.bill.balance, 0));
console.log(
  `${bills.length} bills and ${pos.length} purchase orders since ${since.toISOString().slice(0, 10)}; ${facts.length} unpaid, ${open} open\n`,
);

const reviewed: Reviewed[] = [];
const flagged: BillFacts[] = [];
for (const f of facts) {
  const tag = `${f.bill.vendor} ${f.bill.invoiceNumber ?? ""}`.padEnd(44);
  const amount = money(f.bill.balance).padStart(10);
  const inCode = decideInCode(f);
  if (inCode?.by === "clean") console.log(`   ${tag}${amount}  clean`);
  else if (inCode) console.log(`   ${tag}${amount}  HOLD (rule: same invoice number twice)`);
  else {
    console.log(`   ${tag}${amount}  flagged`);
    flagged.push(f);
  }
  for (const fl of f.flags) console.log(`      · ${describeFlag(fl)}`);
  if (inCode) reviewed.push(inCode);
}

console.log(`\n${flagged.length} flagged bill(s) go to Claude, in one call\n`);
const { output, usage } = await judgeBills(flagged);
const { reviewed: judged, dropped } = applyDecisions(flagged, output);
for (const r of judged) {
  console.log(`── ${r.facts.bill.vendor} ${r.facts.bill.invoiceNumber ?? ""}  ${money(r.facts.bill.balance)}`);
  console.log(`   ${r.decision.verdict}${r.by === "fallback" ? " (no decision returned, held)" : ""}: ${r.decision.reason}`);
  if (r.decision.ask) console.log(`   ask ${r.decision.ask.to}: ${r.decision.ask.question}`);
}
if (dropped.length) console.log(`\n   ignored ${dropped.length} decision(s) for bills that were never sent: ${dropped.join(", ")}`);
reviewed.push(...judged);

const order = new Map(facts.map((f, i) => [f.bill.id, i]));
reviewed.sort((a, b) => (order.get(a.facts.bill.id) ?? 0) - (order.get(b.facts.bill.id) ?? 0));
const pay = reviewed.filter((r) => r.decision.verdict === "pay");
const hold = reviewed.filter((r) => r.decision.verdict === "hold");
const total = (rs: Reviewed[]) => money(rs.reduce((s, r) => s + r.facts.bill.balance, 0));
console.log(`\nClear to pay: ${pay.length} bills, ${total(pay)}. Hold: ${hold.length} bills, ${total(hold)}.`);
if (usage) {
  console.log(`Claude: ${usage.input_tokens} input tokens, ${usage.output_tokens} output tokens, about $${costOf(usage).toFixed(3)}`);
}

const brief = briefText(reviewed, today);
if (dryRun || BOOKS_DEMO || !slackConfigured()) {
  console.log("\nThe Slack brief this run would post:\n");
  console.log(brief.replace(/^/gm, "   "));
}
if (dryRun) console.log("\ndry run: nothing posted to Slack");
else if (BOOKS_DEMO) console.log("\ndemo: nothing posted, nothing paid, nothing changed in QuickBooks");
else if (slackConfigured()) {
  await postBrief(brief);
  console.log("\nposted to Slack. Nothing was paid or changed in QuickBooks.");
} else console.log("\nSlack not configured (optional). Nothing was paid or changed in QuickBooks.");
