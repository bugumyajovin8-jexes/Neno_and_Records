/**
 * Contribution category handling — shared by the browser (App.tsx) and the
 * Express API (server.ts) so both read the database the same way.
 *
 * WHY THIS EXISTS
 * ---------------
 * `contributions.type` is CHECK-constrained to 'Zaka' | 'Sadaka'. To record any
 * other category the Pastor app (PFRO) smuggles the real label through the
 * `payment_method` column:
 *
 *   Zaka / Sadaka        ->  { type: 'Zaka',   payment_method: null      }
 *   Majengo / Makambi /  ->  { type: 'Sadaka', payment_method: 'Majengo' }
 *   any custom label
 *
 * Every reader must un-map this. Reading `type` directly reports a member's
 * Majengo gift to them as Sadaka, and leaves the Majengo/Makambi totals at zero.
 */

/** Categories the member report always shows, even when the total is zero. */
export const CONTRIBUTION_CATEGORIES = ["Zaka", "Sadaka", "Majengo", "Makambi"] as const;

export interface ContributionStats {
  totalZaka: number;
  totalSadaka: number;
  totalContributions: number;
  typeBreakdown: Record<string, number>;
}

/** The real category of a contribution row: `payment_method` wins over `type`. */
export const resolveContributionType = (row: any): string => {
  const smuggled = typeof row?.payment_method === "string" ? row.payment_method.trim() : "";
  if (smuggled) return smuggled;
  const base = typeof row?.type === "string" ? row.type.trim() : "";
  return base || "Nyingine";
};

/** Rewrites `type` on each row to the resolved category, leaving other fields intact. */
export const normalizeContributions = <T extends Record<string, any>>(rows: T[] | null | undefined): T[] =>
  (rows || []).map((row) => ({ ...row, type: resolveContributionType(row) }));

/**
 * Totals for the member report. Accepts either raw or already-normalized rows —
 * `resolveContributionType` is idempotent, so calling this after
 * `normalizeContributions` is safe.
 */
export const summarizeContributions = (rows: any[] | null | undefined): ContributionStats => {
  const typeBreakdown: Record<string, number> = {};
  for (const category of CONTRIBUTION_CATEGORIES) {
    typeBreakdown[category] = 0;
  }

  let totalZaka = 0;
  let totalSadaka = 0;
  let totalContributions = 0;

  (rows || []).forEach((row) => {
    const amount = parseFloat(row?.amount) || 0;
    const type = resolveContributionType(row);

    totalContributions += amount;
    if (type === "Zaka") totalZaka += amount;
    else if (type === "Sadaka") totalSadaka += amount;

    typeBreakdown[type] = (typeBreakdown[type] || 0) + amount;
  });

  return { totalZaka, totalSadaka, totalContributions, typeBreakdown };
};
