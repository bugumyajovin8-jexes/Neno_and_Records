// =============================================================================
// Member field vocabularies — shared by BOTH apps
// =============================================================================
// These exist because the two apps quietly disagreed.
//
// The Congregant app wrote 'Mume'/'Mke' for jinsia while this app counted only
// 'Mwanaume'/'Mwanamke'. A member filling in their gender was saved perfectly —
// and then counted as nothing: the Wanaume/Wanawake totals at the top of
// Washiriki never moved, and no gender chip appeared on their row. Nothing
// errored, so nothing pointed at the cause.
//
// Hali ya Ndoa had the identical split ('Mseja' here vs 'single' there) and was
// one stat bar away from reproducing the whole bug.
//
// One list, deliberately duplicated into both apps (separate bundles, no shared
// package). If you change it here, change Pastor/src/lib/memberFields.ts
// AND the conversion block in database/schema.sql — otherwise old rows keep the
// old spelling and stop matching.

/** Jinsia. The stored value is the displayed value, so there is nothing to map. */
export const GENDERS = ['Mwanaume', 'Mwanamke'] as const;
export type Gender = (typeof GENDERS)[number];

export function isKnownGender(value: string | null | undefined): value is Gender {
  return value === 'Mwanaume' || value === 'Mwanamke';
}

/** Hali ya Ndoa: what is stored, and what a human sees. */
export const MARITAL_STATUSES = [
  { value: 'single', label: 'Single' },
  { value: 'mwenye ndoa', label: 'Mwenye Ndoa' },
  { value: 'mjane', label: 'Mjane' },
] as const;

export type MaritalStatus = (typeof MARITAL_STATUSES)[number]['value'];

/**
 * Spellings written by older builds, mapped onto the value stored today.
 *
 * database/schema.sql converts these in place, but only for databases where
 * that block has actually been run. Until then a legacy row reaches the UI
 * as-is and maritalLabel falls through to its "show unknown values verbatim"
 * branch — which is why a member saved as 'Mseja' still read "Mseja" on screen
 * long after the vocabulary moved to 'single'.
 */
const MARITAL_ALIASES: Record<string, MaritalStatus> = {
  mseja: 'single',
  married: 'mwenye ndoa',
  widowed: 'mjane',
};

export function maritalLabel(value: string | null | undefined): string {
  if (!value) return '';
  const key = value.trim().toLowerCase();
  const canonical = MARITAL_ALIASES[key] ?? key;
  const match = MARITAL_STATUSES.find(m => m.value === canonical);
  // An unrecognised value — a 'Mtaliki' row from an older build of the member
  // app, say — is shown exactly as stored. Blanking it would hide real data,
  // and inventing a label for it would be worse than an unfamiliar one.
  return match ? match.label : value;
}
