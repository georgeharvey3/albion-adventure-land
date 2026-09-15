// Text normalisation for matching (issue #28). British place names are a minefield
// of accents, apostrophes, hyphens and two spellings of everything, and nobody
// types any of it correctly on a phone in a lay-by.
//
// The rule: normalise BOTH sides the same way, then do plain string work. No
// fuzzy-matching library, no edit distance — dependency-free, and predictable
// enough that you can reason about why a result did or didn't appear.

/**
 * Fold a name or query to its comparable form: lowercase, accent-stripped,
 * punctuation-free, single-spaced.
 *
 *   "Y Bala"            → "y bala"
 *   "Bourton-on-the-Water" → "bourton on the water"
 *   "St. Ives"          → "st ives"
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    // Combining marks: "Ynys Môn" → "Ynys Mon".
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Curly and straight apostrophes vanish rather than becoming spaces, so
    // "Land's End" folds to "lands end" and matches someone typing "lands end".
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Spelling variants that are the same word to a human and different strings to
// a computer. Applied token-by-token AFTER folding, so both the gazetteer entry
// and the query land on the same canonical token.
//
// "upon"/"on" is deliberately here: Stratford-upon-Avon and Stratford on Avon
// are typed interchangeably. "st"/"saint" likewise — and the Welsh/Gaelic
// prefixes matter because a guidebook writes one and a road sign the other.
const SYNONYMS: Record<string, string> = {
  saint: 'st',
  sainte: 'st',
  upon: 'on',
  under: 'on',
  mount: 'mt',
  great: 'gt',
  little: 'lt',
};

/** Fold, then split into canonical tokens. Empty query → empty array. */
export function tokenize(text: string): string[] {
  const folded = fold(text);
  if (!folded) return [];
  return folded.split(' ').map((t) => SYNONYMS[t] ?? t);
}

/** Fold to a single canonical string — tokens joined, synonyms applied. */
export function canonical(text: string): string {
  return tokenize(text).join(' ');
}

/**
 * How well `query` matches `name`, both already canonical. Returns 0 for no
 * match, or a positive score where a better match scores higher:
 *
 *   1.0  exact                     "bala"    vs "bala"
 *   0.8  name starts with query    "bal"     vs "bala"
 *   0.6  a word of the name starts with the query   "avon" vs "stratford on avon"
 *   0.4  name contains the query   "ratf"    vs "stratford"
 *
 * Prefix beats contains because typing is left-to-right: someone typing "bal"
 * means Bala far more often than they mean Dunbalnagask.
 */
export function matchScore(query: string, name: string): number {
  if (!query) return 0;
  if (name === query) return 1;
  if (name.startsWith(query)) return 0.8;
  if (name.includes(` ${query}`)) return 0.6;
  if (name.includes(query)) return 0.4;
  return 0;
}
