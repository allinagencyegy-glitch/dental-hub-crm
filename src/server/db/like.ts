/**
 * ILIKE helpers for user-entered search terms.
 *
 * User input must match literally: a term like "50% off" must not become a
 * wildcard pattern. These helpers escape the three LIKE metacharacters and
 * wrap the result in wildcards; the SQL must pair them with ESCAPE '\'.
 */

/** Escapes LIKE/ILIKE metacharacters so the term matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** The escaped term wrapped in wildcards, for `col ILIKE $n ESCAPE '\'`. */
export function likePattern(value: string): string {
  return `%${escapeLike(value)}%`;
}
