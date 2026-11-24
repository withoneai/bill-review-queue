/** One line on a QuickBooks Bill or PurchaseOrder, trimmed to what this repo reads. */
export interface QuickBooksLine {
  Amount?: number;
  Description?: string;
  DetailType?: string;
  ItemBasedExpenseLineDetail?: { ItemRef?: { name?: string }; Qty?: number; UnitPrice?: number };
  AccountBasedExpenseLineDetail?: { AccountRef?: { name?: string } };
  LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
}

export interface QuickBooksBill {
  Id: string;
  DocNumber?: string;
  TxnDate: string;
  DueDate?: string;
  TotalAmt: number;
  Balance: number;
  PrivateNote?: string;
  VendorRef?: { value?: string; name?: string };
  Line?: QuickBooksLine[];
}

export interface QuickBooksPurchaseOrder {
  Id: string;
  DocNumber?: string;
  TxnDate: string;
  TotalAmt: number;
  POStatus?: string;
  PrivateNote?: string;
  VendorRef?: { value?: string; name?: string };
  Line?: QuickBooksLine[];
}

export interface BillLine {
  description: string;
  /** The item name for item lines, the account for account lines. What price history is matched on. */
  key: string;
  qty: number | null;
  unitPrice: number | null;
  amount: number;
  poId: string | null;
}

export interface Bill {
  id: string;
  vendorId: string;
  vendor: string;
  invoiceNumber: string | null;
  date: string;
  dueDate: string | null;
  total: number;
  balance: number;
  note: string | null;
  lines: BillLine[];
  poIds: string[];
}

export interface PurchaseOrder {
  id: string;
  number: string;
  vendor: string;
  date: string;
  total: number;
  status: string | null;
  note: string | null;
}

/** Every reason code can find to look twice at a bill. Each one is arithmetic, none is judgment. */
export type Flag =
  | { kind: "duplicate_invoice"; otherBillId: string; otherInvoice: string | null; otherDate: string; otherPaid: boolean }
  | { kind: "near_duplicate"; otherBillId: string; otherInvoice: string | null; otherDate: string; days: number }
  | { kind: "price_creep"; item: string; was: number; now: number; pct: number; lastBillDate: string }
  | { kind: "over_po"; poNumber: string; poTotal: number; billedAgainstPo: number; pct: number; poStatus: string | null; otherBills: string[] }
  | { kind: "off_po_lines"; poNumber: string; lines: string[]; amount: number }
  | { kind: "new_vendor_no_po"; amount: number };

export interface BillFacts {
  bill: Bill;
  flags: Flag[];
  daysUntilDue: number | null;
  /** The vendor's earlier bills in the window, newest first, for the model's context. */
  history: Bill[];
  pos: PurchaseOrder[];
}

export type Verdict = "pay" | "hold";

export interface Decision {
  billId: string;
  verdict: Verdict;
  /** One or two sentences naming the fact that drove the call. */
  reason: string;
  /** Who has to answer before this is paid, and what to ask them. Null on pay. */
  ask: { to: string; question: string } | null;
}

export interface Reviewed {
  facts: BillFacts;
  decision: Decision;
  /** Who made the call: code (no flags, or a hard rule) or the model. */
  by: "clean" | "rule" | "model" | "fallback";
}
