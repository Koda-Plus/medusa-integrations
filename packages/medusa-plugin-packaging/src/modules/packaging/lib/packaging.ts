/**
 * The pure parts of wholesale packaging: the GS1 check digit, the SSCC
 * label number, the ladder of a quantity (how many pallets, boxes and
 * pieces) and the MOQ and step rule. Testable without a database.
 */

/** The GS1 check digit of a body of digits (weights 3 and 1, from the right). */
export function gs1Check(body: string): string {
  let sum = 0
  for (let i = body.length - 1, w = 3; i >= 0; i -= 1, w = w === 3 ? 1 : 3) {
    sum += w * Number(body[i])
  }
  return String((10 - (sum % 10)) % 10)
}

/** The 18-digit SSCC of a GS1 prefix and a serial: extension digit 0 + prefix + serial + check digit. */
export function makeSscc(prefix: string, serial: string): string {
  const digits = (prefix + serial).replace(/\D/g, "")
  const body = ("0" + digits).slice(0, 17).padEnd(17, "0")
  return body + gs1Check(body)
}

/** The human format of an SSCC: 3 4 5 5 1 groups. */
export function formatSscc(sscc: string): string {
  const d = sscc.replace(/\D/g, "").padEnd(18, "0").slice(0, 18)
  return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7, 12)} ${d.slice(12, 17)} ${d.slice(17)}`
}

/** The AI(00) GS1-128 payload of an SSCC, as it goes on the label. */
export function ssccPayload(sscc: string): string {
  const d = sscc.replace(/\D/g, "").padEnd(18, "0").slice(0, 18)
  const ai = "00"
  return `(00)${d}`.length > 0 ? `${ai}${d}${gs1Check(ai + d)}` : ""
}

export interface Ladder {
  name: string
  pieces: number
}

/** How a quantity splits into the ladder: pallets, then boxes, then pieces. */
export function splitQuantity(qty: number, ladder: Ladder[]): Array<{ name: string; pieces: number; count: number }> {
  const sorted = [...ladder].sort((a, b) => b.pieces - a.pieces)
  let rest = Math.max(0, Math.floor(qty))
  const out: Array<{ name: string; pieces: number; count: number }> = []
  for (const unit of sorted) {
    if (unit.pieces <= 0) continue
    const count = Math.floor(rest / unit.pieces)
    if (count > 0) out.push({ name: unit.name, pieces: unit.pieces, count })
    rest -= count * unit.pieces
  }
  if (rest > 0 || out.length === 0) out.push({ name: "szt.", pieces: 1, count: rest })
  return out
}

/** Whether a quantity satisfies the MOQ and the order step. */
export function satisfiesMoq(qty: number, moq: number, step: number): boolean {
  if (qty < moq) return false
  if (step > 0 && qty % step !== 0) return false
  return true
}
