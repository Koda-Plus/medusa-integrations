/**
 * TYPOGRAPHY OF POLISH MESSAGES. Zero imports.
 *
 * The same rule as `nb()` of the admin page kit and of Koda Plus offers: no
 * one-letter word or short conjunction is left at the end of a line, numbers
 * keep their thousands and units together, and "e-mail" never breaks after
 * "e-". The admin copy of the rule lives in `src/admin/lib/emails-guide.tsx`
 * (shared by every Koda Plus integration); the server needs its own, because
 * admin code is not part of the server build.
 */

export const NBSP = " "
/* A non-breaking hyphen: "e-mail" never ends a line on "e-". */
const NBHY = "‑"
/* A one-letter word or a short conjunction or preposition, with the space after it. */
const SHORT = /(^|[\s("„])(oraz|albo|lub|ale|że|bo|czy|gdy|aby|by|więc|jak|na|do|za|ze|we|od|po|to|[aiouwze])[ \t]+/gi

/**
 * Glues "w", "i", "z", "na", "do", "że" and the like to the next word and a
 * number to its thousands and units. Two passes catch runs like "i w domu".
 */
export function nb(text: string): string {
  let out = text
  for (let k = 0; k < 2; k++) out = out.replace(SHORT, `$1$2${NBSP}`)
  out = out.replace(/(\d) (?=\d{3}\b)/g, `$1${NBSP}`)
  out = out.replace(/\b([eE])-(?=mail)/g, `$1${NBHY}`)
  return out.replace(/(\d) (zł|€|Kč|EUR|USD|PLN|CZK|mln|tys\.|cm|mm|m²|%|szt\.)/g, `$1${NBSP}$2`)
}

/**
 * `nb` over the text between the tags of the body: never inside a tag, a
 * <style> or an Outlook conditional comment, so no attribute and no style
 * changes. The glue goes out as `&nbsp;`, which every mail client reads the
 * same. Entities such as `&amp;` are left alone (they contain no spaces).
 */
export function typesetHtml(html: string): string {
  const at = html.indexOf("<body")
  if (at < 0) return html
  const body = html
    .slice(at)
    .replace(/<!--[\s\S]*?-->|<style[\s\S]*?<\/style>|>([^<]+)</g, (whole: string, words?: string) =>
      words === undefined ? whole : `>${nb(words).split(NBSP).join("&nbsp;")}<`,
    )
  return html.slice(0, at) + body
}
