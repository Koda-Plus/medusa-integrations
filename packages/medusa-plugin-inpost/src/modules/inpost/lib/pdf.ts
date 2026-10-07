/**
 * THE LABEL OF A SIMULATED SHIPMENT (demo mode): a one page PDF with the
 * shipment's number, the locker or the city, the size and the cash on
 * delivery, and a clear note that it is not a real label. Zero imports, built
 * by hand (Helvetica, a box, lines of text), so demo mode needs no PDF library
 * and never calls InPost.
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

export interface LabelLine {
  text: string
  size?: number
  bold?: boolean
}

/** Page sizes in points: A6 is 105 x 148 mm, A4 210 x 297 mm. */
const PAGES = { A6: [297.64, 419.53], A4: [595.28, 841.89] } as const

export function simpleLabelPdf(lines: LabelLine[], page: "A6" | "A4" = "A6"): Uint8Array {
  const [w, h] = PAGES[page]
  const margin = page === "A6" ? 18 : 48
  let y = h - margin - 16
  const ops: string[] = [`0.2 w ${margin} ${margin} ${(w - 2 * margin).toFixed(2)} ${(h - 2 * margin).toFixed(2)} re S`]
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

/** The file name of a label: "inpost-label-1042.pdf". */
export function labelFileName(reference: string | null, shipmentId: string | null): string {
  const base = (reference || shipmentId || "label").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "label"
  return `inpost-label-${base}.pdf`
}
