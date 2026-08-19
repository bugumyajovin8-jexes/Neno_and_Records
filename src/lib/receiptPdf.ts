/**
 * Renders a giving receipt to PDF.
 *
 * Portrait A5 (148 x 210 mm), not the landscape shape of the paper pad. Almost
 * everyone opens this on a phone, where a wide strip has to be zoomed or turned
 * sideways to read; a tall page scrolls naturally and still prints two-up on A4.
 *
 * The layout is its own thing rather than a copy of the pre-printed form — no
 * ruled empty rows, no dotted fill-in lines — but it keeps the part that
 * carries meaning: giving divided into the field's share (A) and the local
 * church's share (B), and the two adding up to what was actually handed over.
 *
 * jsPDF is imported dynamically. It is ~390 KB and most sessions never open a
 * receipt, so it must not sit in the initial bundle of an app people open on a
 * slow connection. Workbox precaches every built .js chunk (see
 * vite.config.ts), so the chunk is still there when the phone is offline.
 */

import type { Receipt, ReceiptSettings } from "./receipt";
import { formatMoney, churchLineName } from "./receipt";

export interface ReceiptContext {
  memberName: string;
  churchName: string;
  settings?: ReceiptSettings | null;
}

const PAGE_W = 148;
const MARGIN = 12;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Vertical rhythm. Named because the page height is CALCULATED from these
// before the document exists — a receipt may carry two amount lines or ten,
// and a fixed page either overflowed the footer or left half of it blank.
const ROW_H = 6.6;          // one amount line
const GAP_SECTION = 12;     // above a section heading
const GAP_HEADING = 7;      // heading to its first line
const GAP_SUBTOTAL = 2.2;   // last line to its subtotal rule
const TOTAL_BOX_H = 26;
const NOTE_RESERVE = 12;    // room for the wrapped footnote
const FOOT_PAD = 14;        // below the footnote, holding the credit line

/** Height of everything between the header band and the bottom of the page. */
const bodyHeight = (fieldRows: number, churchRows: number) =>
  46.1 +                                        // number/date + recipient block
  GAP_SECTION + GAP_HEADING + Math.max(fieldRows, 1) * ROW_H + GAP_SUBTOTAL +
  GAP_SECTION + GAP_HEADING + Math.max(churchRows, 1) * ROW_H + GAP_SUBTOTAL +
  8 + TOTAL_BOX_H + 10 + 5.5 + NOTE_RESERVE + FOOT_PAD;

// Kept dark-on-light so it stays legible photocopied or printed in mono.
const INK: [number, number, number] = [16, 24, 40];
const GOLD: [number, number, number] = [176, 132, 34];
const TEXT: [number, number, number] = [26, 26, 26];
const MUTED: [number, number, number] = [110, 118, 132];
const RULE: [number, number, number] = [216, 220, 227];

export async function buildReceiptDoc(receipt: Receipt, ctx: ReceiptContext): Promise<any> {
  const { jsPDF } = await import("jspdf");

  const s = ctx.settings || {};
  const fieldCode = s.field_code?.trim() || "Field";
  const postal = [s.po_box, s.location].filter(Boolean).join(", ");
  const right = PAGE_W - MARGIN;

  const headerH = postal ? 42 : 36;
  const PAGE_H = Math.min(
    420,
    Math.max(190, headerH + bodyHeight(receipt.fieldLines.length, receipt.churchLines.length))
  );

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [PAGE_W, PAGE_H] });

  const setText = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const setFill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const setDraw = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);

  /** Truncates to fit rather than letting text run into the amount column. */
  const clip = (text: string, maxW: number) => {
    let t = text || "";
    if (doc.getTextWidth(t) <= maxW) return t;
    while (t.length > 1 && doc.getTextWidth(`${t}...`) > maxW) t = t.slice(0, -1);
    return `${t}...`;
  };

  // ============================================================ header band
  setFill(INK);
  doc.rect(0, 0, PAGE_W, headerH, "F");

  // Thin gold rule under the band — the only decoration on the page.
  setFill(GOLD);
  doc.rect(0, headerH, PAGE_W, 1.1, "F");

  let y = 13;
  setText(GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.4);
  doc.text("S T A K A B A D H I   Y A   M I C H A N G O", PAGE_W / 2, y, { align: "center" });

  y += 7.5;
  doc.setTextColor(255, 255, 255);
  if (s.denomination) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(clip(s.denomination, CONTENT_W), PAGE_W / 2, y, { align: "center" });
    y += 5.6;
  }
  if (s.field_name) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text(clip(s.field_name, CONTENT_W), PAGE_W / 2, y, { align: "center" });
    y += 5.4;
  }
  if (postal) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(198, 204, 214);
    doc.text(clip(postal, CONTENT_W), PAGE_W / 2, y, { align: "center" });
  }
  if (!s.denomination && !s.field_name && !postal) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(198, 204, 214);
    doc.text(ctx.churchName || "Kanisa", PAGE_W / 2, y, { align: "center" });
  }

  // ====================================================== number + date row
  y = headerH + 9;
  setText(MUTED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.6);
  doc.text("NAMBA YA STAKABADHI", MARGIN, y);
  doc.text("TAREHE", right, y, { align: "right" });

  y += 5.4;
  setText(TEXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(receipt.receiptNo, MARGIN, y);
  doc.setFontSize(11.5);
  doc.text(receipt.dateLabel, right, y, { align: "right" });

  y += 5;
  setDraw(RULE);
  doc.setLineWidth(0.25);
  doc.line(MARGIN, y, right, y);

  // ============================================================== recipient
  y += 8;
  setText(MUTED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.6);
  doc.text("IMEPOKEWA KUTOKA KWA", MARGIN, y);

  y += 5.8;
  setText(TEXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(clip(ctx.memberName || "—", CONTENT_W), MARGIN, y);

  y += 7.5;
  setText(MUTED);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.6);
  doc.text("KANISA", MARGIN, y);

  y += 5.4;
  setText(TEXT);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(clip(churchLineName(ctx.churchName) || "—", CONTENT_W), MARGIN, y);

  // ================================================================ amounts
  const amountX = right;
  const labelMaxW = CONTENT_W - 30;

  const sectionHeading = (title: string, atY: number) => {
    setFill(GOLD);
    doc.rect(MARGIN, atY - 3.1, 1.6, 4.2, "F");
    setText(MUTED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.text(title.toUpperCase(), MARGIN + 4, atY);
  };

  const amountRow = (label: string, amount: number, atY: number) => {
    setText(TEXT);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.6);
    doc.text(clip(label, labelMaxW), MARGIN, atY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(formatMoney(amount), amountX, atY, { align: "right" });
  };

  const subtotalRow = (label: string, amount: number, atY: number) => {
    setDraw(RULE);
    doc.setLineWidth(0.25);
    doc.line(MARGIN, atY - 4.4, right, atY - 4.4);
    setText(TEXT);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.4);
    doc.text(clip(label, labelMaxW), MARGIN, atY);
    doc.setFontSize(10.4);
    doc.text(formatMoney(amount), amountX, atY, { align: "right" });
  };

  const emptySection = (atY: number) => {
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.4);
    doc.text("Hakuna", MARGIN, atY);
  };

  y += GAP_SECTION;
  sectionHeading(`Sehemu A — ${fieldCode}`, y);
  y += GAP_HEADING;
  if (receipt.fieldLines.length === 0) {
    emptySection(y);
    y += ROW_H;
  } else {
    receipt.fieldLines.forEach((l) => {
      amountRow(l.label, l.amount, y);
      y += ROW_H;
    });
  }
  y += GAP_SUBTOTAL;
  subtotalRow(`Jumla ya ${fieldCode} (A)`, receipt.fieldTotal, y);

  y += GAP_SECTION;
  sectionHeading("Sehemu B — Kanisa", y);
  y += GAP_HEADING;
  if (receipt.churchLines.length === 0) {
    emptySection(y);
    y += ROW_H;
  } else {
    receipt.churchLines.forEach((l) => {
      amountRow(l.label, l.amount, y);
      y += ROW_H;
    });
  }
  y += GAP_SUBTOTAL;
  subtotalRow("Jumla ya Kanisa (B)", receipt.churchTotal, y);

  // ============================================================ grand total
  y += 8;
  const boxH = TOTAL_BOX_H;
  setFill(INK);
  doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 2.4, 2.4, "F");

  setText(GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.8);
  doc.text("JUMLA KUU  (A + B)", MARGIN + 6, y + 8);

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(`TZS ${formatMoney(receipt.grandTotal)}`, right - 6, y + 10.5, { align: "right" });

  doc.setTextColor(206, 212, 222);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.6);
  const words = doc.splitTextToSize(receipt.amountInWords, CONTENT_W - 12);
  doc.text(words.slice(0, 2), MARGIN + 6, y + 17.5);

  y += boxH + 10;

  // =============================================================== footnote
  setDraw(RULE);
  doc.setLineWidth(0.25);
  doc.line(MARGIN, y, right, y);

  y += 5.5;
  setText(MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const note = doc.splitTextToSize(
    `Stakabadhi hii imetolewa kielektroniki na mfumo wa kanisa kwa kumbukumbu ya mshiriki. Inajumuisha michango ${receipt.contributionCount} iliyopokewa tarehe ${receipt.dateLabel}.`,
    CONTENT_W
  );
  doc.text(note, MARGIN, y);

  doc.setFontSize(6.6);
  doc.text("Venics Software Company", PAGE_W / 2, PAGE_H - 8, { align: "center" });

  return doc;
}

/**
 * Saves the receipt.
 *
 * On the web, jsPDF's own `save()` triggers an ordinary browser download.
 *
 * Inside the Android build that does nothing useful: the WebView has no
 * download manager attached, so a blob: anchor click is silently dropped and
 * the user taps the button to no effect. There we write the file through
 * Capacitor's Filesystem and hand it to the system share sheet, which is how
 * "download" actually works on Android — the sheet offers Save to Files,
 * Downloads, Drive, WhatsApp and the rest.
 *
 * Directory.Cache is deliberate. Documents maps to public external storage,
 * which Android 11+ blocks for app writes, whereas the cache directory always
 * works, needs no permission, and is already covered by the FileProvider in
 * android/app/src/main/res/xml/file_paths.xml — without which the share sheet
 * refuses the file:// URI. The OS may reclaim it later, which costs nothing:
 * the receipt is regenerated from the member's own records on demand.
 */
export async function downloadReceiptPdf(receipt: Receipt, ctx: ReceiptContext): Promise<void> {
  const doc = await buildReceiptDoc(receipt, ctx);
  const fileName = `Stakabadhi-${receipt.receiptNo}.pdf`;

  // Imported here rather than at module scope so none of Capacitor reaches the
  // web bundle, where it is dead weight.
  const { Capacitor } = await import("@capacitor/core");

  if (!Capacitor.isNativePlatform()) {
    doc.save(fileName);
    return;
  }

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share")
  ]);

  // Filesystem wants bare base64, and jsPDF hands back a full data URI whose
  // prefix carries a `;filename=` segment. Cut at the first comma rather than
  // splitting on every one.
  const dataUri: string = doc.output("datauristring");
  const base64 = dataUri.slice(dataUri.indexOf(",") + 1);

  const written = await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
    recursive: true
  });

  try {
    await Share.share({
      title: "Stakabadhi ya Michango",
      text: `Stakabadhi ${receipt.receiptNo} — ${receipt.dateLabel}`,
      url: written.uri,
      dialogTitle: "Hifadhi au tuma stakabadhi"
    });
  } catch (err: any) {
    // Dismissing the share sheet rejects. That is the user changing their
    // mind, not a failure — surfacing it would show "Imeshindwa kutengeneza
    // PDF" over a receipt that generated perfectly well.
    const message = String(err?.message ?? err ?? "");
    if (!/cancel/i.test(message)) throw err;
  }
}
