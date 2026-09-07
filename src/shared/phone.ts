/**
 * Phone-number helpers shared by the real WooCommerce client (main process)
 * and the browser mock, so «۰۹۱۲…» / «+98912…» / «912…» all resolve to the
 * same customer during quick-order lookup.
 */

/** Digits only, with a leading 00 / +98 collapsed into the local 0-prefixed form. */
export function normalizePhone(input: string | null | undefined): string {
  let d = String(input ?? '')
    // Persian + Arabic digits first (\D below only strips Latin non-digits).
    .replace(/[۰-۹]/g, (x) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x)))
    .replace(/[٠-٩]/g, (x) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x)))
    .replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('98') && d.length === 12) d = '0' + d.slice(2)
  return d
}

/** Lenient equality: exact match, or equal significant tails (09121234567 ≡ 9121234567). */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a)
  const nb = normalizePhone(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.length >= 10 && nb.length >= 10) return na.slice(-10) === nb.slice(-10)
  return false
}