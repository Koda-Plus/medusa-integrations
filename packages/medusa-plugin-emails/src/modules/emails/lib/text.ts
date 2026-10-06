/**
 * A PLAIN-TEXT PART FROM HTML, for messages given as finished HTML without
 * one (your own markup, or `content` passed to the notification module).
 * Zero imports. The built-in templates write their text part themselves.
 *
 * Simple on purpose: drops the head, styles, scripts and comments, keeps a
 * link as "text (address)", turns block ends into line breaks and decodes
 * the common entities.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rarr: "->",
  larr: "<-",
  hellip: "...",
  copy: "(c)",
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      if (!Number.isFinite(n) || n === 8199 || n === 847) return ""
      try {
        return String.fromCodePoint(n)
      } catch {
        return ""
      }
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

export function htmlToText(html: string): string {
  let s = String(html ?? "")
  s = s.replace(/<head[\s\S]*?<\/head>/gi, "")
  s = s.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
  s = s.replace(/<!--[\s\S]*?-->/g, "")
  s = s.replace(/<div[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/div>/gi, "")
  s = s.replace(/<a\s[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
    const text = label.replace(/<[^>]+>/g, "").trim()
    const url = decode(href).replace(/^mailto:/i, "")
    return text && text !== url ? `${text} (${url})` : url
  })
  s = s.replace(/<br\s*\/?>/gi, "\n")
  s = s.replace(/<\/(p|div|tr|h[1-6]|li|table|ul|ol)>/gi, "\n")
  s = s.replace(/<li[^>]*>/gi, "- ")
  s = s.replace(/<[^>]+>/g, "")
  s = decode(s)
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
