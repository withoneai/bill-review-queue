# Accounts payable review policy

Claude reads this file verbatim before it looks at a flagged bill. Write it the
way you would brief a new AP clerk. The numbers that decide whether a bill is
flagged at all live in `.env` (see `.env.example`); this file decides what a
flag means.

## What earns a hold

- A bill that appears to charge for the same goods or work twice. Two bills
  against one purchase order that together come to more than the order are a
  hold until receiving confirms the extra goods arrived.
- A price rise nobody told us about. If the vendor's own note or a letter on
  file announced the rise before the bill, and it is under 6%, it is not a
  hold. A rise over 10% is a hold even with notice, until the buyer agrees to it.
- A first bill from a vendor we have never paid, over the no-PO limit, with no
  named person inside the company who asked for it. This is how invoice fraud
  arrives. Hold it, find the person who bought it, and confirm the vendor's
  bank details on a phone number we already had, not one printed on the bill.
- Lines on a purchase-order bill that the order does not cover, when they add
  more than 10% to the order. Parts found during a service visit are normal;
  they still need the person who raised the order to say yes.

## What does not earn a hold

- Two bills from the same vendor for the same total, when the lines describe
  different work on different days. Service calls, freight and repairs often
  land on round numbers. Say why they are different jobs and pay both.
- Price changes under 3% (these are never flagged in the first place).

## How to write the call

- The reason names the one fact that decided it, with the numbers: the invoice
  number, the amounts, the dates. Do not restate every flag.
- When the verdict is hold, the ask goes to one named person or role, and is a
  question they can answer in one line. Use the purchase order's requester when
  there is one. For a vendor question, the ask is to AP, saying what to ask the
  vendor.
- Never suggest paying part of a bill, and never suggest a vendor is committing
  fraud. Say what needs confirming.
