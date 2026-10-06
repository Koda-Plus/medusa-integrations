/**
 * COLOURS OF A MESSAGE, from two options: the accent and the header band.
 * Zero imports.
 *
 * The look comes from the Koda Plus templates: a dark band at the top with
 * the store name as live text, a light body, the accent on buttons and a few
 * highlights, and a dark twin of every light colour for mail apps in dark
 * mode. Everything else is derived, so any brand colour stays readable:
 *
 *   - neutrals (page, card, lines, text) take the hue of the band at a low
 *     saturation: with the default band they are the green-grey of Koda Plus,
 *     with a navy band a blue-grey;
 *   - text in the accent colour is darkened (light mode) or lightened (dark
 *     mode) until it reaches a 4.5:1 contrast with its background;
 *   - the text on an accent button is dark or white, whichever reads better;
 *   - a band colour too light for white text is darkened, keeping its hue.
 */

import { DEFAULT_ACCENT, DEFAULT_HEADER } from "./constants"

type Rgb = { r: number; g: number; b: number }
type Hsl = { h: number; s: number; l: number }

/** "#26d07c", "#26D07C" or "#2d7" as an RGB triple, or null. */
export function parseHex(value: unknown): Rgb | null {
  if (typeof value !== "string") return null
  const s = value.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  if (short) return { r: parseInt(short[1] + short[1], 16), g: parseInt(short[2] + short[2], 16), b: parseInt(short[3] + short[3], 16) }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s)
  if (long) return { r: parseInt(long[1], 16), g: parseInt(long[2], 16), b: parseInt(long[3], 16) }
  return null
}

/** A valid colour in the six-digit upper-case form, or null. */
export function normalizeHex(value: unknown): string | null {
  const rgb = parseHex(value)
  return rgb ? toHex(rgb) : null
}

export function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase()
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0)
  else if (max === gg) h = (bb - rr) / d + 2
  else h = (rr - gg) / d + 4
  return { h: h * 60, s, l }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hh = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/** `t` of the first colour and `1 - t` of the second. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a) ?? { r: 0, g: 0, b: 0 }
  const y = parseHex(b) ?? { r: 0, g: 0, b: 0 }
  return toHex({ r: x.r * t + y.r * (1 - t), g: x.g * t + y.g * (1 - t), b: x.b * t + y.b * (1 - t) })
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex) ?? { r: 0, g: 0, b: 0 }
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b)
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The colour with its lightness moved step by step towards `target` until it reaches `ratio` against `against`. */
function untilContrast(hex: string, against: string, ratio: number, direction: "darker" | "lighter"): string {
  const hsl = rgbToHsl(parseHex(hex) ?? { r: 0, g: 0, b: 0 })
  let current = hex
  for (let i = 0; i < 60 && contrast(current, against) < ratio; i++) {
    hsl.l = direction === "darker" ? Math.max(0, hsl.l - 0.02) : Math.min(1, hsl.l + 0.02)
    current = toHex(hslToRgb(hsl))
    if (hsl.l === 0 || hsl.l === 1) break
  }
  return current
}

function neutral(h: number, s: number, l: number): string {
  return toHex(hslToRgb({ h, s, l }))
}

export interface Surface {
  page: string
  card: string
  soft: string
  tint: string
  thumb: string
  ink: string
  sub: string
  faint: string
  line: string
  accentInk: string
  amber: string
  amberBg: string
  red: string
  redBg: string
}

export interface Palette {
  accent: string
  /** Text on an accent button. */
  onAccent: string
  night: string
  nightCard: string
  nightLine: string
  /** The accent at 14 % over the band, solid (Outlook ignores alpha). */
  nightPill: string
  onNight: string
  onNightSub: string
  onNightFaint: string
  /** Accent text on the band. */
  accentOnNight: string
  light: Surface
  dark: Surface
}

export function makePalette(accentOption: unknown, headerOption: unknown): Palette {
  const accent = normalizeHex(accentOption) ?? DEFAULT_ACCENT
  let night = normalizeHex(headerOption) ?? DEFAULT_HEADER
  const nightHsl = rgbToHsl(parseHex(night) as Rgb)
  if (contrast(night, "#FFFFFF") < 7 || nightHsl.l > 0.3) {
    night = toHex(hslToRgb({ h: nightHsl.h, s: nightHsl.s, l: Math.min(nightHsl.l, 0.16) }))
  }
  const { h, s: nightSat, l: nightL } = rgbToHsl(parseHex(night) as Rgb)
  const s = Math.min(nightSat, 0.12)
  const textSat = s * 0.7

  const lightCard = "#FFFFFF"
  const darkCard = neutral(h, s, 0.088)
  const light: Surface = {
    page: neutral(h, s, 0.935),
    card: lightCard,
    soft: neutral(h, s, 0.955),
    tint: mix(accent, "#FFFFFF", 0.12),
    thumb: neutral(h, s, 0.94),
    ink: neutral(h, textSat, 0.085),
    sub: neutral(h, textSat, 0.345),
    faint: neutral(h, textSat, 0.42),
    line: neutral(h, s, 0.89),
    accentInk: untilContrast(toHex(hslToRgb({ ...rgbToHsl(parseHex(accent) as Rgb), l: Math.min(rgbToHsl(parseHex(accent) as Rgb).l, 0.4) })), lightCard, 4.6, "darker"),
    amber: "#8A5800",
    amberBg: "#FFF3D6",
    red: "#B42318",
    redBg: "#FEECEB",
  }
  const dark: Surface = {
    page: neutral(h, s, 0.052),
    card: darkCard,
    soft: neutral(h, s, 0.122),
    tint: mix(accent, darkCard, 0.14),
    thumb: neutral(h, s, 0.145),
    ink: neutral(h, textSat * 0.6, 0.935),
    sub: neutral(h, textSat, 0.68),
    faint: neutral(h, textSat, 0.575),
    line: neutral(h, s, 0.18),
    accentInk: untilContrast(accent, darkCard, 4.6, "lighter"),
    amber: "#F2C25B",
    amberBg: "#30260F",
    red: "#F59E97",
    redBg: "#3A1714",
  }
  const darkText = light.ink
  const onAccent = contrast(accent, darkText) >= contrast(accent, "#FFFFFF") ? darkText : "#FFFFFF"
  return {
    accent,
    onAccent,
    night,
    nightCard: neutral(h, Math.min(nightSat, 0.1), Math.min(0.4, nightL + 0.045)),
    nightLine: neutral(h, Math.min(nightSat, 0.1), Math.min(0.5, nightL + 0.11)),
    nightPill: mix(accent, night, 0.14),
    onNight: "#FFFFFF",
    onNightSub: neutral(h, Math.min(nightSat, 0.1) * 0.8, 0.75),
    onNightFaint: neutral(h, Math.min(nightSat, 0.1) * 0.8, 0.6),
    accentOnNight: untilContrast(accent, night, 4.5, "lighter"),
    light,
    dark,
  }
}
