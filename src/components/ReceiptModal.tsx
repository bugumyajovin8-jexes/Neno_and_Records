// Fragment carries the list key here. This app has no @types/react installed,
// so JSX props are not run through LibraryManagedAttributes and `key` on a
// custom component is type-checked as an ordinary prop. Keying a Fragment
// sidesteps that without adding a wrapper element.
import { useState, Fragment } from "react";
import type { ReactNode } from "react";
import { X, Download, Loader2 } from "lucide-react";
import type { Receipt, ReceiptSettings } from "../lib/receipt";
import { formatMoney, churchLineName } from "../lib/receipt";
import { downloadReceiptPdf } from "../lib/receiptPdf";

interface Props {
  receipt: Receipt;
  memberName: string;
  churchName: string;
  settings?: ReceiptSettings | null;
  onClose: () => void;
}

/**
 * A giving receipt.
 *
 * Deliberately identical in structure to the PDF in lib/receiptPdf.ts — a
 * member who taps download should get the document they were just looking at,
 * not a different rendering of the same numbers.
 *
 * The document keeps its own light palette in both themes. It is a record
 * someone may show to a treasurer or forward on, and it should look the same
 * every time regardless of the phone's theme.
 */

function AmountRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[7px]">
      <span className="text-[12.5px] text-neutral-700 leading-snug min-w-0">{label}</span>
      <span className="text-[13px] font-bold text-neutral-900 tabular-nums shrink-0">
        {formatMoney(amount)}
      </span>
    </div>
  );
}

function SubtotalRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 pt-2.5 mt-1 border-t border-neutral-200">
      <span className="text-[12.5px] font-bold text-neutral-900 leading-snug min-w-0">{label}</span>
      <span className="text-[13.5px] font-black text-neutral-900 tabular-nums shrink-0">
        {formatMoney(amount)}
      </span>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className="w-[3px] h-[11px] rounded-full bg-[#b08422] shrink-0" />
      <span className="text-[9.5px] font-black uppercase tracking-[0.11em] text-neutral-500">
        {children}
      </span>
    </div>
  );
}

export default function ReceiptModal({ receipt, memberName, churchName, settings, onClose }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const s = settings || {};
  const fieldCode = s.field_code?.trim() || "Field";
  const postal = [s.po_box, s.location].filter(Boolean).join(", ");
  const hasLetterhead = Boolean(s.denomination || s.field_name || postal);

  const handleDownload = async () => {
    setDownloading(true);
    setError("");
    try {
      await downloadReceiptPdf(receipt, { memberName, churchName, settings });
    } catch (err: any) {
      console.error("Receipt PDF failed:", err);
      setError("Imeshindwa kutengeneza PDF. Jaribu tena.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Stakabadhi ya michango"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-[420px] max-h-[94dvh] flex flex-col bg-white dark:bg-[#0d1024] rounded-t-3xl sm:rounded-3xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close affordance sits outside the document so it never looks printed. */}
        <div className="flex items-center justify-end px-3 py-2 shrink-0 bg-white dark:bg-[#0d1024]">
          <button
            onClick={onClose}
            aria-label="Funga"
            className="w-9 h-9 rounded-full flex items-center justify-center bg-slate-100 dark:bg-[#1c2245] text-neutral-600 dark:text-neutral-300"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <div className="rounded-2xl overflow-hidden border border-neutral-200 bg-white shadow-sm">
            {/* ---------------------------------------------------- letterhead */}
            <div className="bg-[#101828] px-5 pt-5 pb-4 text-center">
              <p className="text-[8.5px] font-black uppercase tracking-[0.28em] text-[#c79a2e]">
                Stakabadhi ya Michango
              </p>
              {hasLetterhead ? (
                <div className="mt-3">
                  {s.denomination && (
                    <p className="text-[13.5px] text-white leading-tight">{s.denomination}</p>
                  )}
                  {s.field_name && (
                    <p className="text-[14px] font-bold text-white leading-tight mt-0.5">
                      {s.field_name}
                    </p>
                  )}
                  {postal && (
                    <p className="text-[11.5px] text-slate-300 leading-tight mt-1">{postal}</p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-[11.5px] text-slate-300 leading-snug">
                  {churchName || "Kanisa"}
                </p>
              )}
            </div>
            <div className="h-[3px] bg-[#b08422]" />

            <div className="px-5 py-4">
              {/* ------------------------------------------- number and date */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[8.5px] font-black uppercase tracking-[0.1em] text-neutral-500">
                    Namba ya Stakabadhi
                  </p>
                  <p className="text-[15px] font-black text-neutral-900 tabular-nums mt-0.5">
                    {receipt.receiptNo}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[8.5px] font-black uppercase tracking-[0.1em] text-neutral-500">
                    Tarehe
                  </p>
                  <p className="text-[14px] font-bold text-neutral-900 tabular-nums mt-0.5">
                    {receipt.dateLabel}
                  </p>
                </div>
              </div>

              <div className="border-t border-neutral-200 mt-3.5 pt-4">
                <p className="text-[8.5px] font-black uppercase tracking-[0.1em] text-neutral-500">
                  Imepokewa kutoka kwa
                </p>
                <p className="text-[16px] font-black text-neutral-900 leading-tight mt-1">
                  {memberName || "—"}
                </p>

                <p className="text-[8.5px] font-black uppercase tracking-[0.1em] text-neutral-500 mt-3.5">
                  Kanisa
                </p>
                <p className="text-[13px] text-neutral-800 leading-tight mt-1">
                  {churchLineName(churchName) || "—"}
                </p>
              </div>

              {/* ---------------------------------------------------- amounts */}
              <div className="mt-5">
                <SectionHeading>Sehemu A — {fieldCode}</SectionHeading>
                {receipt.fieldLines.length === 0 ? (
                  <p className="text-[12.5px] text-neutral-400 py-[7px]">Hakuna</p>
                ) : (
                  receipt.fieldLines.map((l, i) => (
                    <Fragment key={`f${i}`}>
                      <AmountRow label={l.label} amount={l.amount} />
                    </Fragment>
                  ))
                )}
                <SubtotalRow label={`Jumla ya ${fieldCode} (A)`} amount={receipt.fieldTotal} />
              </div>

              <div className="mt-5">
                <SectionHeading>Sehemu B — Kanisa</SectionHeading>
                {receipt.churchLines.length === 0 ? (
                  <p className="text-[12.5px] text-neutral-400 py-[7px]">Hakuna</p>
                ) : (
                  receipt.churchLines.map((l, i) => (
                    <Fragment key={`c${i}`}>
                      <AmountRow label={l.label} amount={l.amount} />
                    </Fragment>
                  ))
                )}
                <SubtotalRow label="Jumla ya Kanisa (B)" amount={receipt.churchTotal} />
              </div>

              {/* ------------------------------------------------ grand total */}
              <div className="mt-5 rounded-xl bg-[#101828] px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[8.5px] font-black uppercase tracking-[0.12em] text-[#c79a2e]">
                    Jumla Kuu (A + B)
                  </span>
                  <span className="text-[19px] font-black text-white tabular-nums">
                    TZS {formatMoney(receipt.grandTotal)}
                  </span>
                </div>
                <p className="text-[10.5px] text-slate-300 leading-snug mt-1.5">
                  {receipt.amountInWords}
                </p>
              </div>

              <p className="text-[9.5px] text-neutral-500 leading-relaxed mt-4 pt-3 border-t border-neutral-200">
                Stakabadhi hii imetolewa kielektroniki na mfumo wa kanisa kwa kumbukumbu ya mshiriki.
                Inajumuisha michango {receipt.contributionCount} iliyopokewa tarehe {receipt.dateLabel}.
              </p>
            </div>
          </div>

          {error && (
            <p className="mt-3 text-[12px] font-semibold text-rose-600 dark:text-rose-400 text-center">
              {error}
            </p>
          )}
        </div>

        {/* Pinned so it stays reachable on a long receipt without scrolling. */}
        <div className="shrink-0 px-3 pb-3 pt-2 bg-white dark:bg-[#0d1024] border-t border-slate-100 dark:border-[#1c2245]">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-[var(--gold-fill)] text-[var(--on-gold)] font-black text-[13px] uppercase tracking-wide disabled:opacity-60"
          >
            {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {downloading ? "Inatengeneza..." : "Pakua PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
