/**
 * Building a giving receipt (STAKABADHI) from recorded contributions.
 *
 * Mirrors the pre-printed SDA form. Everything a member gave on one day forms
 * ONE receipt, and the amounts table divides it between the field and the local
 * church exactly as the paper does:
 *
 *   Zaka                              -> field       (section A)
 *   Sadaka ya Pamoja  (field share)   -> field       (section A)
 *   Sadaka ya Kambi                   -> field       (section A)
 *                                        = Jumla Fedha ya (FIELD) - A
 *   Sadaka ya Pamoja  (church share)  -> local church (section B)
 *   Michango ya Majengo ya Kanisa     -> local church (section B)
 *                                        = Jumla Fedha ya Kanisa  - B
 *                                        = Jumla ya Fedha zote    A + B
 *
 * The split percentage is per-field configuration, not a constant — see
 * church_receipt_settings.field_share_percent in database/schema.sql.
 */

import { resolveContributionType } from "./contributions";

export interface ReceiptSettings {
  denomination?: string | null;
  field_name?: string | null;
  field_code?: string | null;
  po_box?: string | null;
  location?: string | null;
  field_share_percent?: number | null;
}

export interface ReceiptLine {
  label: string;
  amount: number;
}

export interface Receipt {
  receiptNo: string;
  isoDate: string;      // yyyy-mm-dd, the day the giving was recorded
  dateLabel: string;    // dd/mm/yy, as written on the paper form
  fieldLines: ReceiptLine[];
  fieldTotal: number;   // A
  churchLines: ReceiptLine[];
  churchTotal: number;  // B
  grandTotal: number;   // A + B
  amountInWords: string;
  contributionCount: number;
}

export const DEFAULT_FIELD_SHARE = 58;

// -----------------------------------------------------------------------------
// Amount in words — "Jumla ya fedha kwa maneno"
// -----------------------------------------------------------------------------

const ONES = ["", "moja", "mbili", "tatu", "nne", "tano", "sita", "saba", "nane", "tisa"];
const TENS = ["", "kumi", "ishirini", "thelathini", "arobaini", "hamsini", "sitini", "sabini", "themanini", "tisini"];

/** 1–99. "kumi na tano", "arobaini na sita". */
const under100 = (n: number): string => {
  if (n < 10) return ONES[n];
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  return unit ? `${TENS[tens]} na ${ONES[unit]}` : TENS[tens];
};

/** 1–999, as separate parts so the caller can place "na" before the last one. */
const under1000Parts = (n: number): string[] => {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(`mia ${ONES[hundreds]}`);
  if (rest) parts.push(under100(rest));
  return parts;
};

const under1000 = (n: number): string => {
  const parts = under1000Parts(n);
  return parts.length > 1 ? `${parts[0]} na ${parts[1]}` : parts[0] || "";
};

/**
 * Swahili words for a whole number of shillings.
 * 2000 -> "elfu mbili", 1580 -> "elfu moja mia tano na themanini".
 */
export const numberToSwahiliWords = (value: number): string => {
  const n = Math.round(Math.abs(value));
  if (n === 0) return "sifuri";

  const parts: string[] = [];

  // Tanzanian Swahili counts hundred-thousands as "laki", not as hundreds of
  // thousands. Without it 123,456 comes out "elfu mia moja na ishirini na
  // tatu ..." — understandable, but not how anyone would read it aloud, and a
  // receipt is exactly where that matters.
  const millions = Math.floor(n / 1_000_000);
  const afterMillions = n % 1_000_000;
  const laki = Math.floor(afterMillions / 100_000);
  const afterLaki = afterMillions % 100_000;
  const thousands = Math.floor(afterLaki / 1000);
  const remainder = afterLaki % 1000;

  if (millions) parts.push(`milioni ${under1000(millions)}`);
  if (laki) parts.push(`laki ${ONES[laki]}`);
  if (thousands) parts.push(`elfu ${under1000(thousands)}`);
  parts.push(...under1000Parts(remainder));

  if (parts.length === 0) return "sifuri";
  if (parts.length === 1) return parts[0];

  // "na" separates only the final component, as it is spoken.
  return `${parts.slice(0, -1).join(" ")} na ${parts[parts.length - 1]}`;
};

/** The full phrase written on the receipt line. */
export const amountInWords = (value: number): string => {
  const words = numberToSwahiliWords(value);
  return `Shilingi ${words} tu`;
};

// -----------------------------------------------------------------------------
// Receipt number
// -----------------------------------------------------------------------------

/**
 * Derived, not stored — the same member and the same day always produce the
 * same number, on any device, with no counter to keep in sync and no risk of
 * two devices issuing the same one while offline.
 *
 * It is NOT the number in the church's paper receipt book. Those are issued by
 * hand from a pre-printed pad and there is no way to know them from here.
 */
const hash4 = (input: string): string => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return String(h % 10000).padStart(4, "0");
};

export const buildReceiptNumber = (congregantId: string, isoDate: string): string =>
  `${isoDate.slice(2, 4)}${isoDate.slice(5, 7)}${isoDate.slice(8, 10)}-${hash4(`${congregantId}|${isoDate}`)}`;

// -----------------------------------------------------------------------------
// Grouping and totals
// -----------------------------------------------------------------------------

/** Local-time yyyy-mm-dd. Using the UTC date would file a Saturday evening
 *  gift under Sunday for anyone east of Greenwich, Tanzania included. */
const localIsoDate = (value: string): string => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const toDateLabel = (isoDate: string): string =>
  `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(2, 4)}`;

/** Categories that belong to the field rather than the local church. */
const FIELD_ONLY = new Set(["Makambi", "Kambi"]);
/** Categories the form prints on their own line under the church section. */
const CHURCH_ONLY = new Set(["Majengo"]);

/**
 * One receipt per member per day, newest first.
 *
 * `contributions` may be raw or already normalized — resolveContributionType is
 * idempotent, so either is safe.
 */
export const buildReceipts = (
  contributions: any[] | null | undefined,
  congregantId: string,
  settings?: ReceiptSettings | null
): Receipt[] => {
  const rawShare = settings?.field_share_percent;
  const fieldShare =
    typeof rawShare === "number" && rawShare >= 0 && rawShare <= 100 ? rawShare : DEFAULT_FIELD_SHARE;
  const fieldCode = settings?.field_code?.trim() || "Field";

  const byDate = new Map<string, any[]>();
  (contributions || []).forEach((row) => {
    if (!row?.created_at) return;
    const iso = localIsoDate(row.created_at);
    if (!iso) return;
    if (!byDate.has(iso)) byDate.set(iso, []);
    byDate.get(iso)!.push(row);
  });

  const receipts: Receipt[] = [];

  Array.from(byDate.keys())
    .sort((a, b) => (a < b ? 1 : -1))
    .forEach((iso) => {
      const rows = byDate.get(iso)!;

      let zaka = 0;
      let sadaka = 0;
      const otherField = new Map<string, number>();
      const otherChurch = new Map<string, number>();

      rows.forEach((row) => {
        const amount = parseFloat(row?.amount) || 0;
        const category = resolveContributionType(row);

        if (category === "Zaka") zaka += amount;
        else if (category === "Sadaka") sadaka += amount;
        else if (FIELD_ONLY.has(category)) otherField.set(category, (otherField.get(category) || 0) + amount);
        else otherChurch.set(category, (otherChurch.get(category) || 0) + amount);
      });

      // The church share is the remainder, never a second rounding. Splitting
      // 1001 at 58% otherwise loses a shilling and A + B stops matching what
      // the member actually handed over.
      const sadakaField = Math.round((sadaka * fieldShare) / 100);
      const sadakaChurch = sadaka - sadakaField;
      const churchShare = 100 - fieldShare;

      const fieldLines: ReceiptLine[] = [{ label: "Zaka", amount: zaka }];
      fieldLines.push({
        label: `Sadaka ya Pamoja (${fieldCode}) (${fieldShare}%)`,
        amount: sadakaField
      });
      otherField.forEach((amount, label) => {
        fieldLines.push({ label: label === "Makambi" ? "Sadaka ya Kambi" : label, amount });
      });

      const churchLines: ReceiptLine[] = [
        { label: `Sadaka ya Pamoja ya Kanisa ${churchShare}%`, amount: sadakaChurch }
      ];
      otherChurch.forEach((amount, label) => {
        churchLines.push({
          label: CHURCH_ONLY.has(label) ? "Michango ya Majengo ya Kanisa" : label,
          amount
        });
      });

      // Total from every line, then show only the ones that carry money. The
      // pre-printed pad needs its empty rows; a generated receipt listing
      // "Sadaka ya Pamoja  0" for someone who only paid Zaka is just noise.
      const fieldTotal = fieldLines.reduce((sum, l) => sum + l.amount, 0);
      const churchTotal = churchLines.reduce((sum, l) => sum + l.amount, 0);
      const grandTotal = fieldTotal + churchTotal;

      receipts.push({
        receiptNo: buildReceiptNumber(congregantId || "", iso),
        isoDate: iso,
        dateLabel: toDateLabel(iso),
        fieldLines: fieldLines.filter((l) => l.amount > 0),
        fieldTotal,
        churchLines: churchLines.filter((l) => l.amount > 0),
        churchTotal,
        grandTotal,
        amountInWords: amountInWords(grandTotal),
        contributionCount: rows.length
      });
    });

  return receipts;
};

/**
 * The church name as it belongs on the "Kanisa la ______" line.
 *
 * The label already supplies "Kanisa la", and most churches are registered in
 * the system as "Kanisa la Bagamoyo" — printing both gives "Kanisa la Kanisa
 * la Bagamoyo". Strips the leading article when the name carries one.
 */
export const churchLineName = (name?: string | null): string => {
  const trimmed = (name || "").trim();
  return trimmed.replace(/^kanisa\s+(la|cha|ya)\s+/i, "");
};

export const formatMoney = (value: number): string =>
  new Intl.NumberFormat("sw-TZ", { maximumFractionDigits: 0 }).format(Math.round(value || 0));
