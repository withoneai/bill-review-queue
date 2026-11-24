import * as quickbooks from "@withone/sdk/quickbooks";
import { BOOKS_DEMO, connections, loadFixture, oneClient, quickbooksRealmId } from "./config.js";
import type { Bill, BillLine, PurchaseOrder, QuickBooksBill, QuickBooksLine, QuickBooksPurchaseOrder } from "./types.js";

const qbConn = () => oneClient().connection(connections.quickbooks());
const PAGE = 1000;

/**
 * Reads every Bill (paid and unpaid) and every PurchaseOrder dated on or after
 * `since`, through the typed `@withone/sdk/quickbooks` query actions. Paid
 * bills matter as much as open ones: a duplicate invoice is usually a copy of
 * one you already paid, and price creep is measured against the vendor's last
 * bill, which is paid by the time the next one arrives.
 */
export async function readBooks(since: Date): Promise<{ bills: Bill[]; pos: PurchaseOrder[] }> {
  if (BOOKS_DEMO) {
    const from = since.toISOString().slice(0, 10);
    const bills = (loadFixture("quickbooks/bills.json") as QuickBooksBill[]).filter((b) => b.TxnDate >= from);
    const pos = (loadFixture("quickbooks/purchase-orders.json") as QuickBooksPurchaseOrder[]).filter((p) => p.TxnDate >= from);
    return { bills: bills.map(toBill), pos: pos.map(toPurchaseOrder) };
  }
  const [bills, pos] = await Promise.all([
    queryAll<QuickBooksBill>("Bill", since),
    queryAll<QuickBooksPurchaseOrder>("PurchaseOrder", since),
  ]);
  return { bills: bills.map(toBill), pos: pos.map(toPurchaseOrder) };
}

async function queryAll<T>(entity: "Bill" | "PurchaseOrder", since: Date): Promise<T[]> {
  const all: T[] = [];
  for (let start = 1; ; start += PAGE) {
    const input = {
      path: { realmId: quickbooksRealmId() },
      query: {
        query: `select * from ${entity} where TxnDate >= '${since.toISOString().slice(0, 10)}' startposition ${start} maxresults ${PAGE}`,
      },
    };
    const res = await qbConn().run(entity === "Bill" ? quickbooks.queryBillsSql(input) : quickbooks.queryPurchaseOrders(input));
    const data = res.data as { QueryResponse?: Record<string, T[] | undefined> };
    const page = data.QueryResponse?.[entity] ?? [];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

function toLine(l: QuickBooksLine): BillLine | null {
  if (l.DetailType === "SubTotalLineDetail" || l.Amount === undefined) return null;
  const itemDetail = l.ItemBasedExpenseLineDetail;
  const account = l.AccountBasedExpenseLineDetail?.AccountRef?.name;
  const description = (l.Description ?? itemDetail?.ItemRef?.name ?? account ?? "").trim();
  return {
    description,
    key: itemDetail?.ItemRef?.name?.trim() ?? description,
    qty: itemDetail?.Qty ?? null,
    unitPrice: itemDetail?.UnitPrice ?? null,
    amount: l.Amount,
    poId: l.LinkedTxn?.find((t) => t.TxnType === "PurchaseOrder")?.TxnId ?? null,
  };
}

export function toBill(b: QuickBooksBill): Bill {
  const lines = (b.Line ?? []).map(toLine).filter((l): l is BillLine => l !== null);
  return {
    id: b.Id,
    vendorId: b.VendorRef?.value ?? b.VendorRef?.name ?? "",
    vendor: b.VendorRef?.name?.trim() ?? "(no vendor)",
    invoiceNumber: b.DocNumber?.trim() || null,
    date: b.TxnDate,
    dueDate: b.DueDate ?? null,
    total: b.TotalAmt,
    balance: b.Balance,
    note: b.PrivateNote?.trim() || null,
    lines,
    poIds: [...new Set(lines.map((l) => l.poId).filter((id): id is string => id !== null))],
  };
}

export function toPurchaseOrder(p: QuickBooksPurchaseOrder): PurchaseOrder {
  return {
    id: p.Id,
    number: p.DocNumber?.trim() || `PO ${p.Id}`,
    vendor: p.VendorRef?.name?.trim() ?? "(no vendor)",
    date: p.TxnDate,
    total: p.TotalAmt,
    status: p.POStatus ?? null,
    note: p.PrivateNote?.trim() || null,
  };
}

/** A cheap liveness probe for `npm run check`: the company record. */
export async function probeQuickBooks(): Promise<string> {
  const res = await qbConn().run(
    quickbooks.queryCompanyInfoSqlQuery({
      path: { realmId: quickbooksRealmId() },
      query: { query: "select * from CompanyInfo" },
    }),
  );
  const data = res.data as { QueryResponse?: { CompanyInfo?: Array<{ CompanyName?: string }> } };
  const name = data.QueryResponse?.CompanyInfo?.[0]?.CompanyName;
  if (!name) throw new Error("QuickBooks answered, but not with a company record.");
  return name;
}
