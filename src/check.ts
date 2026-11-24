import { BOOKS_DEMO, MODEL_DEMO, loadPolicy, slackConfigured, thresholds } from "./config.js";
import { probeQuickBooks } from "./quickbooks.js";

/** Proves the run will work before you rely on it: the policy parses, and (live) QuickBooks answers. */
let failed = false;
try {
  const rules = loadPolicy().split("\n").filter((l) => l.startsWith("- ")).length;
  console.log(`✓ config/ap-policy.md parses (${rules} policy lines for Claude to apply)`);
  console.log(
    `✓ flags: price rise over ${thresholds.priceCreepPct}%, same total within ${thresholds.nearDuplicateDays} days, ` +
      `new vendor over $${thresholds.noPoOver} with no PO, over a PO by more than ${thresholds.overPoPct}%`,
  );
  if (BOOKS_DEMO) console.log("· No QuickBooks keys, so nothing was probed. `npm start` replays the recorded books.");
  else console.log(`✓ QuickBooks answers (${await probeQuickBooks()})`);
  console.log(MODEL_DEMO ? "· No ANTHROPIC_API_KEY: Claude's decisions will be the recorded ones" : "✓ ANTHROPIC_API_KEY set");
  if (!BOOKS_DEMO) console.log(slackConfigured() ? "✓ Slack brief configured" : "· Slack brief not configured (optional)");
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  failed = true;
}
process.exit(failed ? 1 : 0);
