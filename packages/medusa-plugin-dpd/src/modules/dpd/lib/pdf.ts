import type { LabelPage } from "./constants"

/**
 * THE SAMPLE LABEL: a one page PDF with the reference, the waybills, the
 * cash on delivery and a clear note that it is not a DPD label. Built by
 * hand (Helvetica, a frame, lines of text), so demo mode and the tests need
 * no PDF library and never call DPD. Used by the demo client and by the
 * label route of demo mode for seeded rows without a stored label.
 *
 * Polish letters are written without their marks (the standard PDF fonts
 * have no Latin 2 encoding); this is a stand-in, not a document.
 */

const ASCII: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  Ą: "A", Ć: "C", Ę: "E", Ł: "L", Ń: "N", Ó: "O", Ś: "S", Ź: "Z", Ż: "Z",
}

/** Text a standard PDF font can show: Polish letters without marks, PDF specials escaped, other characters dropped. */
export function pdfText(s: string): string {
  return String(s ?? "")
    .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => ASCII[c] ?? c)
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[\\()]/g, (c) => `\\${c}`)
}

export type LabelLine = { text: string; size?: number; bold?: boolean }

/** Page sizes in points: A4 595 x 842, LBL_PRINTER 288 x 432 (4 x 6 in, the DPD label printer page measured in the sandbox). */
const PAGES: Record<LabelPage, readonly [number, number]> = { A4: [595, 842], LBL_PRINTER: [288, 432] }

export function simpleLabelPdf(lines: LabelLine[], page: LabelPage): Uint8Array {
  const [w, h] = PAGES[page] ?? PAGES.A4
  const margin = page === "LBL_PRINTER" ? 18 : 48
  let y = h - margin - 16
  const ops: string[] = [`0.2 w ${margin} ${margin} ${w - 2 * margin} ${h - 2 * margin} re S`]
  for (const line of lines) {
    const size = line.size ?? 10
    ops.push(`BT /${line.bold ? "F2" : "F1"} ${size} Tf ${margin + 10} ${y.toFixed(2)} Td (${pdfText(line.text)}) Tj ET`)
    y -= size + 7
    if (y < margin + 10) break
  }
  const content = ops.join("\n")
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ]
  let body = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(body)
}

/** A part of a file name: characters outside [A-Za-z0-9_-] dropped, at most 60 characters. */
function namePart(s: string | null): string {
  return String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60)
}

/** "dpd-label-<order or reference>-<first waybill>.pdf", characters outside [A-Za-z0-9_-] dropped; a missing part is left out. */
export function labelFileName(prefix: string | null, waybill: string | null): string {
  return `${["dpd-label", namePart(prefix), namePart(waybill)].filter(Boolean).join("-")}.pdf`
}
