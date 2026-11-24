<h3 align="center">Bill Review Queue</h3>
<p align="center">An AI agent for accounts payable: read every unpaid bill in QuickBooks before the payment run, catch the duplicate invoice, the purchase order billed twice and the price nobody agreed to, and have Claude write the case for the few bills a human should look at, with the one question to ask before each one gets paid.<br />Built on <a href="https://withone.ai">One</a>. Nothing is paid, voided, or changed in QuickBooks; this only reads and reports.</p>

<p align="center">
  <a href="https://withone.ai"><strong>Website</strong></a>
  &nbsp;·&nbsp;
  <a href="https://withone.ai/docs"><strong>Docs</strong></a>
  &nbsp;·&nbsp;
  <a href="https://app.withone.ai"><strong>Dashboard</strong></a>
</p>

---

## Try it in 60 seconds, no keys

```bash
git clone https://github.com/withoneai/bill-review-queue
cd bill-review-queue
npm install
npm start
```

With nothing configured, the same pipeline runs against the recorded books of a fictional coffee roaster (22 bills, 3 purchase orders) and replays the decisions Claude made on one real run over them. Add only `ANTHROPIC_API_KEY` to `.env` and Claude judges those books live. `npm test` runs the seven checks on the flags and the gate.

## What it does

The week's payment run is where an AP clerk either catches the copy of last month's freight invoice or pays it twice. Run this the day before and it:

1. **Reads every bill from QuickBooks**, paid and unpaid, plus every purchase order, for the last 12 months. Paid bills matter: the duplicate is usually a copy of one you already paid, and a price rise is measured against the vendor's last bill.
2. **Flags in code, never in the model**:
   - the same invoice number from the same vendor twice (`INV-0020417` and `inv 20417` count as the same);
   - the same vendor and total within 10 days under a different invoice number;
   - a unit price up more than 3% on the same item on the vendor's last bill;
   - a purchase order billed past its total, across every bill linked to it;
   - lines on a PO-backed bill that the PO does not cover;
   - a first-ever bill from a new vendor over $5,000 with no PO.
3. **Clears the clean bills without asking anyone.** A bill with no flag is clear to pay on arithmetic alone.
4. **Holds a duplicate invoice number by rule.** No policy wording can talk the model into paying the same invoice twice.
5. **Sends the rest to Claude in one call**, with each bill's lines, its PO and requester, the vendor's recent bills, and your AP policy written in plain English in `config/ap-policy.md`. Claude decides pay or hold, names the fact that decided it, and writes the one question for the one person who can answer it.
6. **Checks what comes back.** A flagged bill the model skipped is held, never paid by default. A decision for a bill that was never sent is ignored.
7. **Posts one brief to Slack**: what is clear to pay, what is held and why, and which flags were cleared and why.

## A real run

The recorded books, run on 2026-11-20. Claude's part is one real call to `claude-opus-5-5` (3,461 input tokens, 1,666 output tokens, $0.047), saved in `fixtures/decisions.json` and replayed by `npm start`.

```
22 bills and 3 purchase orders since 2025-11-20; 13 unpaid, $60,376.80 open

   Brightline Software Ltd BL-2026-0193            $9,800  flagged
      · First bill ever from this vendor, $9,800, with no purchase order behind it.
   Mill Creek Dairy MC-7804                     $1,666.80  flagged
      · Whole milk, gallon: unit price $4.39, up 4.5% on $4.20 on this vendor's bill of 2026-10-27.
   Northside Electric 3321                         $2,140  flagged
      · Same vendor and same total as invoice 3340 dated 2026-11-10, 7 day(s) apart, different invoice number.
   Keel Roaster Service K-4471                     $3,400  flagged
      · Lines not on PO-1051: Burner igniter assembly, replaced during service ($800).
   Altura Green Coffee Importers 8830             $18,400  flagged
      · PO-1043 (Closed) is for $18,400; $36,800 has now been billed against it, 100% over, including invoice 8812.
   Ridgeline Freight RF-55102                      $1,180  HOLD (rule: same invoice number twice)
      · Same invoice number as RF-55102 entered 2026-10-30, which is already paid.
   Pacific Packaging Co. INV-20417                 $4,860  flagged
      · 12oz valve bag, kraft: unit price $0.405, up 12.5% on $0.36 on this vendor's bill of 2026-10-02.
   ... 5 clean bills, 1 more flagged

── Altura Green Coffee Importers 8830  $18,400
   hold: Invoice 8830 ($18,400) plus paid invoice 8812 ($18,400) bring $36,800 billed against
   closed PO-1043, which is for $18,400 (40 bags of Huila).
   ask Jonah Reyes: Did we receive a second delivery of 40 bags of Colombia Huila beyond the
   shipment billed on invoice 8812?
── Mill Creek Dairy MC-7804  $1,666.80
   pay: The whole milk rise from $4.20 to $4.39 (4.5%) on MC-7804 was announced in the vendor
   letter dated 2026-10-15, before the bill, and is under 6%.
── Northside Electric 3340  $2,140
   pay: Invoice 3340 ($2,140) is the 11/7 walk-in cooler compressor relay and contactor call with
   4.5 hrs labor, a different job and day from invoice 3321 (11/1 roaster exhaust fan motor),
   so the matching total is coincidence.

Clear to pay: 8 bills, $22,736.80. Hold: 5 bills, $37,640.
```

## Go live (about 5 minutes)

```bash
npm i -g @withone/cli
one init                 # create an account or log in
one add quickbooks
one add slack            # optional, for the brief
cp .env.example .env
```

Fill in `ONE_SECRET`, `ANTHROPIC_API_KEY`, `ONE_CONNECTION_QUICKBOOKS` (from `one --agent connection list`) and `QUICKBOOKS_REALM_ID` (the company ID in your QuickBooks URL). Add `ONE_CONNECTION_SLACK` and `SLACK_CHANNEL` to post the brief. Then:

```bash
npm run check            # policy parses, QuickBooks answers
npm start -- --dry-run   # print the brief, post nothing
npm start                # post it
```

**Write your policy.** `config/ap-policy.md` is the whole judgment configuration: what earns a hold, what does not, who gets asked. The thresholds that decide what is flagged at all are numbers in `.env` (`PRICE_CREEP_PCT`, `NEAR_DUPLICATE_DAYS`, `NO_PO_OVER`, `OVER_PO_PCT`, `LOOKBACK_MONTHS`).

## What a run costs

Two paged QuickBooks queries (bills and purchase orders, 1,000 rows a page) and one Claude call for all the flagged bills together, however many there are. The recorded run cost $0.047 for seven flagged bills. Clean bills never reach the model, so the cost tracks how messy the week is, not how many bills you have.

## What it does not do

- **It does not pay, void, or edit anything.** The brief is for a human, who pays from the usual run.
- **It does not read the invoice PDF.** It sees what was keyed into QuickBooks. A wrong amount keyed by hand looks right to it.
- **It does not know what was received.** "Did the second delivery arrive?" is a question it asks; it cannot check a receiving log.
- **It does not catch a changed bank account.** QuickBooks bills carry no remittance details, which is where most invoice fraud actually lands. The new-vendor flag is the only guard here, and the policy says to confirm bank details by phone.
- **Price creep needs item lines.** Bills keyed to an expense account with no item and unit price are compared on totals only (the near-duplicate check), never on price.
- **It keeps no state.** A bill held this week is flagged again next week until someone pays or voids it.

## How it is wired

| File | What it does |
| --- | --- |
| `config/ap-policy.md` | The AP policy in plain English. Claude reads it verbatim |
| `src/quickbooks.ts` | Reads Bills and PurchaseOrders via `@withone/sdk/quickbooks`, paged |
| `src/flags.ts` | Every flag, in code: duplicates, price creep, PO over-billing, new vendors |
| `src/gate.ts` | Clean bills pass, duplicate invoice numbers hold, and the model's output is checked |
| `src/judge.ts` | The prompt and the one Claude call; `--record` saves it as the demo fixture |
| `src/slack.ts` | The brief, posted via `@withone/sdk/slack` |
| `src/index.ts` | The run: read, flag, gate, judge, brief |
| `fixtures/` | The recorded books and Claude's recorded decisions |

## License

MIT
