import "dotenv/config";
import { readFileSync } from "node:fs";
import { One } from "@withone/sdk";

/**
 * Two switches, so a fresh clone runs with nothing configured and gets more
 * real as you add keys:
 *
 *  - BOOKS_DEMO: the QuickBooks read comes from fixtures/ (a fictional coffee
 *    roaster's books) when the One keys are missing, or with --demo.
 *  - MODEL_DEMO: Claude's decisions are replayed from fixtures/decisions.json
 *    (one real recorded call) unless ANTHROPIC_API_KEY is set. Set only that
 *    key and Claude judges the recorded books live.
 */
const ONE_KEYS = Boolean(
  process.env.ONE_SECRET && process.env.ONE_CONNECTION_QUICKBOOKS && process.env.QUICKBOOKS_REALM_ID,
);
const FORCE_DEMO = process.argv.includes("--demo");

export const BOOKS_DEMO = FORCE_DEMO || !ONE_KEYS;
export const MODEL_DEMO = FORCE_DEMO || !process.env.ANTHROPIC_API_KEY;
export const RECORD = process.argv.includes("--record");

export function demoReason(): string {
  if (FORCE_DEMO) return "--demo";
  if (!ONE_KEYS) return "no QuickBooks keys in the environment";
  return "";
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    console.error("Or run `npm start -- --demo` to replay the recorded books, no keys needed.");
    process.exit(1);
  }
  return value;
}

let client: One | undefined;
export function oneClient(): One {
  client ??= new One(required("ONE_SECRET"));
  return client;
}

export const connections = {
  quickbooks: () => required("ONE_CONNECTION_QUICKBOOKS"),
  slack: () => required("ONE_CONNECTION_SLACK"),
};

export const quickbooksRealmId = () => required("QUICKBOOKS_REALM_ID");

/** Slack is an optional output: configured means both env lines are set. */
export const slackConfigured = () => Boolean(process.env.ONE_CONNECTION_SLACK && process.env.SLACK_CHANNEL);
export const slackChannel = () => required("SLACK_CHANNEL");

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    console.error(`${name} must be a number of 0 or more, not "${raw}".`);
    process.exit(1);
  }
  return value;
}

/** The arithmetic thresholds. The judgment lives in config/ap-policy.md. */
export const thresholds = {
  lookbackMonths: numberEnv("LOOKBACK_MONTHS", 12),
  priceCreepPct: numberEnv("PRICE_CREEP_PCT", 3),
  nearDuplicateDays: numberEnv("NEAR_DUPLICATE_DAYS", 10),
  noPoOver: numberEnv("NO_PO_OVER", 5000),
  overPoPct: numberEnv("OVER_PO_PCT", 1),
};
export type Thresholds = typeof thresholds;

export function loadFixture(relPath: string): unknown {
  const url = new URL(`../fixtures/${relPath}`, import.meta.url);
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch {
    throw new Error(`No fixture at fixtures/${relPath}.`);
  }
}

/**
 * "Today" for the run. Live, it is the clock. With the recorded books it is
 * pinned to the day they were captured, so due dates stay in the future no
 * matter when you clone the repo.
 */
export function runDate(): Date {
  if (BOOKS_DEMO) return new Date((loadFixture("meta.json") as { captured_at: string }).captured_at);
  return new Date();
}

export function loadPolicy(): string {
  return readFileSync(new URL("../config/ap-policy.md", import.meta.url), "utf8");
}
