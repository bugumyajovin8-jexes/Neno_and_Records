// =============================================================================
// Mobile numbers — the identity key for this app
// =============================================================================
// The TypeScript twin of `public.normalize_phone(text)` in database/schema.sql,
// and a byte-for-byte copy of Pastor/src/lib/phone.ts. The two apps are separate
// bundles with no shared package, so this is duplicated rather than imported —
// if you change one, change all three (here, the Pastor app, and the SQL).
// The two MUST agree: the database matches a member, an invitation and a
// profile by comparing normalised numbers, and if this file disagrees with that
// function the app writes a number the database will never match. That failure
// is silent — no error, no rows, just a treasurer who cannot be found and a
// member with no church — so any change here needs the same change there.
//
// Everything is reduced to bare digits in international form, WITHOUT the '+':
//
//     0754 112 233   ->  255754112233
//     +255754112233  ->  255754112233
//     754112233      ->  255754112233
//
// That is deliberately the shape Supabase stores in `auth.users.phone` and
// hands back in the JWT's `phone` claim, so a stored value and a token compare
// equal without either side having to remember to convert.

/** Tanzania. Kept in step with the `cc` constant in normalize_phone(). */
export const COUNTRY_CODE = '255';

/**
 * Canonical form: bare digits, international, no '+'. Returns '' for anything
 * with no digits in it at all, so callers can test it as falsy.
 */
export function normalizePhone(input: string | null | undefined): string {
  if (!input) return '';

  // Punctuation is notation, not identity.
  let d = String(input).replace(/[^0-9]/g, '');
  if (!d) return '';

  // 00255… — the older international prefix.
  if (d.startsWith('00')) d = d.slice(2);

  // Order matters, exactly as in the SQL. A leading zero is a NATIONAL prefix
  // and never appears in E.164, so testing it first is unambiguous; testing the
  // country code first would misread a short local number beginning 255.
  if (d.startsWith('0') && d.length > 1) {
    d = COUNTRY_CODE + d.slice(1);
  } else if (d.startsWith(COUNTRY_CODE)) {
    // already international
  } else if (d.length === 9) {
    d = COUNTRY_CODE + d;
  }

  return d;
}

/**
 * What `supabase.auth.signUp` / `signInWithPassword` are given. GoTrue strips
 * the '+' before storing, so this and the stored value differ by that one
 * character — send the documented E.164 form and let it do so.
 */
export function toE164(input: string | null | undefined): string {
  const d = normalizePhone(input);
  return d ? `+${d}` : '';
}

/**
 * Tanzanian mobile numbers: country code plus nine digits, and every mobile
 * prefix in the country starts 6 or 7 (61 62 65 67 68 69 71 73 74 75 76 77 78
 * 79). Landlines (255 22 …) are rejected on purpose — this number is a login,
 * and it is where an SMS code will be sent once a provider is wired up, so a
 * number that cannot receive one should be refused now rather than after it has
 * locked somebody out.
 *
 * If the product is ever sold outside Tanzania, this is the check to relax —
 * normalizePhone() already passes foreign numbers through untouched.
 */
export function isValidPhone(input: string | null | undefined): boolean {
  return /^255[67]\d{8}$/.test(normalizePhone(input));
}

/** How a number is shown back to a human: 0754 112 233. */
export function formatPhoneDisplay(input: string | null | undefined): string {
  const d = normalizePhone(input);
  if (!d) return '';

  if (d.startsWith(COUNTRY_CODE) && d.length === COUNTRY_CODE.length + 9) {
    const local = '0' + d.slice(COUNTRY_CODE.length);
    return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }

  // Anything we do not recognise is shown as the caller gave it rather than
  // mangled into a shape it does not have.
  return String(input ?? '');
}

/** The Swahili message every screen shows for a number that fails the check. */
export const PHONE_INVALID_MESSAGE =
  'Namba ya simu si sahihi. Tumia muundo 07XX XXX XXX au +255 7XX XXX XXX.';
