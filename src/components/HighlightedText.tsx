import { highlightSegments } from "../lib/search";

interface Props {
  text: string;
  terms: string[];
  /** Extra classes for the matched run. */
  className?: string;
}

/**
 * Renders `text` with every search term picked out.
 *
 * Segments are rendered as separate React nodes rather than injected as HTML,
 * so verse text can never be interpreted as markup.
 */
export function HighlightedText({ text, terms, className = "" }: Props) {
  const segments = highlightSegments(text, terms);

  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            className={
              "rounded-[3px] px-[1px] py-0 not-italic font-semibold " +
              "bg-[#2563eb]/12 text-[#1d4ed8] " +
              "dark:bg-[#60a5fa]/20 dark:text-[#93c5fd] " +
              className
            }
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}
