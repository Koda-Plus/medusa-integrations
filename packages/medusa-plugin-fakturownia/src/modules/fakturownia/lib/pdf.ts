/**
 * PDF FILES OF DOCUMENTS. Zero imports apart from the demo numbering, so the
 * unit tests load it without a build.
 *
 *   pdfFileName   "FV 12/10/2026" becomes "FV-12-10-2026.pdf"
 *   buildDemoPdf  a small, valid one page PDF for a simulated document (demo
 *                 mode has no Fakturownia to render one): the kind, the
 *                 number and a clear "simulation" note
 *
 * THE DEMO PDF is written by hand (no dependency): one page, the standard
 * Helvetica fonts, and a font encoding whose /Differences map sixteen spare
 * byte codes to the Polish letters (ą ć ę ł ń ś ź ż and their capitals; ó and
 * Ó are in WinAnsi already), so Polish text prints with its diacritics. The
 * cross reference table carries exact byte offsets, so strict readers open it
 * without a repair.
 */

import { decodeDemoId } from "./demo"

/** A document file name from its number: "FV 12/10/2026" becomes "FV-12-10-2026.pdf". */
export function pdfFileName(number: string | null | undefined, fallback: string): string {
  const base = (number ?? "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || fallback
  return `${base}.pdf`
}

/** Polish letters outside WinAnsi, on the byte codes 128 to 143 of the font encoding. */
const POLISH: ReadonlyArray<[string, string]> = [
  ["ą", "aogonek"],
  ["ć", "cacute"],
  ["ę", "eogonek"],
  ["ł", "lslash"],
  ["ń", "nacute"],
  ["ś", "sacute"],
  ["ź", "zacute"],
  ["ż", "zdotaccent"],
  ["Ą", "Aogonek"],
  ["Ć", "Cacute"],
  ["Ę", "Eogonek"],
  ["Ł", "Lslash"],
  ["Ń", "Nacute"],
  ["Ś", "Sacute"],
  ["Ź", "Zacute"],
  ["Ż", "Zdotaccent"],
]
const POLISH_CODE = new Map(POLISH.map(([ch], i) => [ch, 128 + i]))

/** Text as the bytes of a PDF string literal in the encoding above. Unknown characters become "?". */
export function pdfStringBytes(text: string): number[] {
  const out: number[] = [0x28]
  for (const ch of String(text)) {
    const polish = POLISH_CODE.get(ch)
    let code = polish ?? ch.codePointAt(0) ?? 63
    if (polish === undefined && (code > 255 || (code >= 128 && code < 160))) code = 63
    if (code === 0x28 || code === 0x29 || code === 0x5c) out.push(0x5c)
    out.push(code)
  }
  out.push(0x29)
  return out
}

export interface PdfLine {
  text: string
  size?: number
  bold?: boolean
  /** Extra space above the line, in points. */
  gap?: number
}

/** A one page A4 PDF with the given lines, top to bottom. */
export function buildPdf(lines: readonly PdfLine[]): Buffer {
  const content: number[] = []
  const push = (s: string) => {
    for (const c of s) content.push(c.charCodeAt(0))
  }
  let y = 790
  for (const line of lines) {
    const size = line.size ?? 11
    y -= (line.gap ?? 0) + size * 1.45
    push(`BT /${line.bold ? "F2" : "F1"} ${size} Tf 56 ${Math.max(40, Math.round(y))} Td `)
    content.push(...pdfStringBytes(line.text))
    push(" Tj ET\n")
  }

  const differences = POLISH.map(([, name]) => `/${name}`).join(" ")
  const objects: Array<number[]> = [
    ascii("<< /Type /Catalog /Pages 2 0 R >>"),
    ascii("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    ascii("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>"),
    ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding 7 0 R >>"),
    ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding 7 0 R >>"),
    [...ascii(`<< /Length ${content.length} >>\nstream\n`), ...content, ...ascii("\nendstream")],
    ascii(`<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [128 ${differences}] >>`),
  ]

  const bytes: number[] = [...ascii("%PDF-1.4\n%"), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(bytes.length)
    bytes.push(...ascii(`${i + 1} 0 obj\n`), ...body, ...ascii("\nendobj\n"))
  })
  const xref = bytes.length
  bytes.push(...ascii(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`))
  for (const offset of offsets) bytes.push(...ascii(`${String(offset).padStart(10, "0")} 00000 n \n`))
  bytes.push(...ascii(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`))
  return Buffer.from(bytes)
}

function ascii(text: string): number[] {
  const out: number[] = []
  for (const c of text) out.push(c.charCodeAt(0) & 0xff)
  return out
}

const KIND_TITLE: Record<string, string> = {
  vat: "Faktura VAT",
  proforma: "Faktura pro forma",
  receipt: "Paragon",
  correction: "Faktura korygująca",
}

export interface DemoPdfInput {
  /** The simulated Fakturownia id. Since 0.2.0 it carries the kind and the number. */
  externalId: string
  /** Known from the database (the admin route); otherwise read from the id. */
  number?: string | null
  kind?: string | null
  issueDate?: string | null
  total?: string | null
}

/** The PDF of a simulated document and its file name. */
export function buildDemoPdf(input: DemoPdfInput): { filename: string; data: Buffer } {
  const decoded = decodeDemoId(input.externalId)
  const number = input.number ?? decoded?.number ?? null
  const kind = input.kind ?? decoded?.kind ?? null
  const title = (kind && KIND_TITLE[kind]) || "Dokument"
  const lines: PdfLine[] = [
    { text: "Fakturownia (symulacja)", size: 9 },
    { text: title, size: 20, bold: true, gap: 18 },
    { text: number ? `Nr ${number}` : `Dokument ${input.externalId}`, size: 14, bold: true, gap: 4 },
  ]
  if (input.issueDate) lines.push({ text: `Data wystawienia: ${input.issueDate}`, gap: 10 })
  if (input.total) lines.push({ text: `Razem brutto: ${input.total}`, gap: input.issueDate ? 0 : 10 })
  lines.push(
    { text: "Dokument demonstracyjny z symulowanego konta Fakturowni.", gap: 24 },
    { text: "Nie został wystawiony naprawdę i nie ma mocy prawnej." },
    { text: "Demo document from a simulated Fakturownia account, never issued for real.", size: 9, gap: 8 },
    { text: "Fakturownia by Koda Plus", size: 9, gap: 30 },
  )
  return { filename: pdfFileName(number, `document-${input.externalId}`), data: buildPdf(lines) }
}
