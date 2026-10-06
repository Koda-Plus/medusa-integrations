/**
 * THE LAYOUT KIT: the blocks every message is built from, in the look of the
 * Koda Plus templates. The built-in templates use it, and so can yours
 * (`kit` in the render context of a custom template).
 *
 * Built for mail clients, not browsers: tables and inline styles, and NO
 * IMAGES. Many mail apps block remote images until the reader allows them and
 * then draw a broken image icon next to the alt text; a test in a real inbox
 * showed exactly that for a logo and every product photo. So the store name
 * is live text, and a product is a tile with a short code from its SKU,
 * which reads the same in every app.
 *
 * Dark mode: `prefers-color-scheme` for Apple Mail and most apps,
 * `[data-ogsc]` / `[data-ogsb]` for Outlook.com, and the classes
 * `em-theme-dark` / `em-theme-light` on <html> for the admin preview, which
 * can force either one. The band is dark in both modes.
 *
 * SAFETY BY CONSTRUCTION. Text goes in as `Inline`: plain strings and
 * numbers (escaped here), or the nodes `accent`, `strong`, `nowrap`, `mono`,
 * `muted`, `link` (http(s) and mailto only) and `br`. There is no way to pass
 * raw HTML except `trusted(html, text)`, meant for markup you wrote yourself.
 * Every block renders HTML and a plain-text twin, so every message has a
 * text part.
 */

import { MAX_ITEMS_SHOWN, type EmailLocale } from "./constants"
import { esc, safeUrl } from "./html"
import type { Palette, Surface } from "./theme"

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

export interface KitFonts {
  head: string
  body: string
  mono: string
  /** @font-face rules, inside `@media screen` so Outlook on Windows never falls back to Times. */
  faces: Array<{ family: string; url: string }>
}

export interface KitBrand {
  /** The store name, or null when it is not set (sentences then avoid it). */
  name: string | null
  /** Always some text: the name, the storefront host, or a plain word. */
  logo: { text: string; accent: string | null; suffix: string | null; italic: boolean }
  supportEmail: string | null
  /** Replies reach a person (a Reply-To is set). */
  replyTo: boolean
  storeUrl: string | null
  accountUrl: string | null
  /** The footer line in the language of the message (an address, a legal line). */
  footer: string | null
}

/** Words the kit itself writes, in the language of the message. */
export interface KitCopy {
  helpTitle: string
  helpReply: string
  helpReplyOr: (email: string) => string
  helpWrite: (email: string) => string
  footerNotice: (store: string | null) => string
  linkStore: string
  linkAccount: string
  more: (count: number) => string
  quantity: (quantity: string) => string
  each: (price: string) => string
  track: string
  trackingNumber: string
  carrier: string
  linkFallback: string
}

export interface KitContext {
  locale: EmailLocale
  palette: Palette
  fonts: KitFonts
  brand: KitBrand
  copy: KitCopy
}

/* ------------------------------------------------------------------ */
/* Inline text                                                         */
/* ------------------------------------------------------------------ */

export type InlineNode =
  | { readonly kind: "accent" | "strong" | "nowrap" | "mono" | "muted"; readonly content: Inline }
  | { readonly kind: "link"; readonly href: string; readonly content: Inline }
  | { readonly kind: "br" }
  | { readonly kind: "trusted"; readonly html: string; readonly text: string }

export type Inline = string | number | null | undefined | false | InlineNode | readonly Inline[]

export const accent = (content: Inline): InlineNode => ({ kind: "accent", content })
export const strong = (content: Inline): InlineNode => ({ kind: "strong", content })
export const nowrap = (content: Inline): InlineNode => ({ kind: "nowrap", content })
export const mono = (content: Inline): InlineNode => ({ kind: "mono", content })
export const muted = (content: Inline): InlineNode => ({ kind: "muted", content })
export const link = (href: string, content: Inline): InlineNode => ({ kind: "link", href, content })
export const br: InlineNode = { kind: "br" }
/** Markup you wrote yourself, with its plain-text twin. Never pass data from customers here. */
export const trusted = (html: string, text: string): InlineNode => ({ kind: "trusted", html, text })

type Where = "light" | "night" | "paper"
type Out = { html: string; text: string }

function isNode(v: unknown): v is InlineNode {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v) && typeof (v as { kind?: unknown }).kind === "string"
}

/** Inline text as HTML (escaped) and plain text. */
export function inline(value: Inline, ctx: KitContext, where: Where = "light"): Out {
  if (value === null || value === undefined || value === false) return { html: "", text: "" }
  if (typeof value === "string" || typeof value === "number") {
    const s = String(value)
    return { html: esc(s), text: s }
  }
  if (Array.isArray(value)) {
    let html = ""
    let text = ""
    for (const part of value) {
      const o = inline(part as Inline, ctx, where)
      html += o.html
      text += o.text
    }
    return { html, text }
  }
  if (!isNode(value)) return { html: "", text: "" }
  const p = ctx.palette
  switch (value.kind) {
    case "accent": {
      const inner = inline(value.content, ctx, where)
      if (where === "night") return { html: `<span style="color:${p.accentOnNight}">${inner.html}</span>`, text: inner.text }
      return { html: `<span class="em-accent" style="color:${p.light.accentInk}">${inner.html}</span>`, text: inner.text }
    }
    case "strong": {
      const inner = inline(value.content, ctx, where)
      return { html: `<strong style="font-weight:700">${inner.html}</strong>`, text: inner.text }
    }
    case "nowrap": {
      const inner = inline(value.content, ctx, where)
      return { html: `<span style="white-space:nowrap">${inner.html}</span>`, text: inner.text }
    }
    case "mono": {
      const inner = inline(value.content, ctx, where)
      return { html: `<span style="font-family:${ctx.fonts.mono}">${inner.html}</span>`, text: inner.text }
    }
    case "muted": {
      const inner = inline(value.content, ctx, where)
      if (where === "night") return { html: `<span style="color:${p.onNightFaint}">${inner.html}</span>`, text: inner.text }
      return { html: `<span class="em-faint" style="color:${p.light.faint}">${inner.html}</span>`, text: inner.text }
    }
    case "link": {
      const inner = inline(value.content, ctx, where)
      const url = safeUrl(value.href, { mailto: true })
      if (!url) return inner
      const color = where === "night" ? p.accentOnNight : p.light.accentInk
      const cls = where === "light" ? ' class="em-accent"' : ""
      const shown = url.replace(/^mailto:/i, "")
      const text = inner.text === shown ? inner.text : `${inner.text} (${shown})`
      return { html: `<a href="${esc(url)}"${cls} style="color:${color};text-decoration:underline">${inner.html}</a>`, text }
    }
    case "br":
      return { html: "<br>", text: "\n" }
    case "trusted":
      return { html: String(value.html ?? ""), text: String(value.text ?? "") }
  }
  return { html: "", text: "" }
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

/** One block of a message: in the light body or in the dark band at the top. */
export interface Block {
  readonly kind: "block"
  readonly area: "body" | "band"
  render(ctx: KitContext): Out
}

function block(area: "body" | "band", render: (ctx: KitContext) => Out): Block {
  return { kind: "block", area, render }
}

const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"'

function para(html: string, style: string, cls = ""): string {
  return `<p${cls ? ` class="${cls}"` : ""} style="margin:0;${style}">${html}</p>`
}

const spacer = (px: number) => `<table ${TABLE} width="100%"><tr><td height="${px}" style="height:${px}px;font-size:0;line-height:0">&nbsp;</td></tr></table>`

function lightText(ctx: KitContext, size: number, line: number, weight = 400, tone: keyof Pick<Surface, "ink" | "sub" | "faint"> = "ink"): { style: string; cls: string } {
  return {
    style: `font-family:${ctx.fonts.body};font-size:${size}px;line-height:${line}px;font-weight:${weight};color:${ctx.palette.light[tone]}`,
    cls: `em-${tone}`,
  }
}

/** A paragraph of the body. */
export function paragraph(content: Inline, opts: { tone?: "ink" | "sub"; size?: "base" | "small" } = {}): Block {
  return block("body", (ctx) => {
    const o = inline(content, ctx)
    if (!o.text.trim()) return { html: "", text: "" }
    const small = opts.size === "small"
    const t = lightText(ctx, small ? 13 : 15, small ? 20 : 23, 400, opts.tone ?? "sub")
    return { html: para(o.html, t.style, t.cls), text: o.text }
  })
}

/** A small label above a group of blocks: "Ordered products", "Delivery address". */
export function section(label: Inline, ...content: Array<Block | null | undefined | false>): Block {
  return block("body", (ctx) => {
    const parts = content.filter((b): b is Block => Boolean(b)).map((b) => b.render(ctx)).filter((o) => o.html)
    if (parts.length === 0) return { html: "", text: "" }
    const l = inline(label, ctx)
    const t = lightText(ctx, 12, 16, 700, "faint")
    const head = l.text ? para(l.html, `${t.style};letter-spacing:0.03em;margin-bottom:12px`, t.cls) : ""
    return {
      html: head + parts.map((p) => p.html).join(spacer(14)),
      text: [l.text ? l.text.toUpperCase() : "", ...parts.map((p) => p.text)].filter(Boolean).join("\n"),
    }
  })
}

/** Label and value pairs, two per row; a phone puts them one under another. Empty values are left out. */
export function facts(pairs: Array<[Inline, Inline]>): Block {
  return block("body", (ctx) => {
    const cells = pairs.map(([k, v]) => [inline(k, ctx), inline(v, ctx)] as const).filter(([, v]) => v.text.trim())
    if (cells.length === 0) return { html: "", text: "" }
    const k = lightText(ctx, 12, 16, 400, "faint")
    const v = lightText(ctx, 15, 21, 600, "ink")
    const rows: string[] = []
    for (let i = 0; i < cells.length; i += 2) {
      const pair = cells.slice(i, i + 2)
      rows.push(
        `<tr>${pair
          .map(
            ([key, value], j) =>
              `<td class="em-stack${j ? " em-stack-gap" : ""}" width="50%" valign="top" style="padding:${i ? 16 : 0}px ${j ? 0 : 12}px 0 ${j ? 12 : 0}px">${para(key.html, k.style, k.cls)}${para(value.html, `margin-top:4px;${v.style}`, v.cls)}</td>`,
          )
          .join("")}${pair.length === 1 ? '<td class="em-hide-sm" width="50%"></td>' : ""}</tr>`,
      )
    }
    return {
      html: `<table ${TABLE} width="100%">${rows.join("")}</table>`,
      text: cells.map(([key, value]) => `${key.text}: ${value.text}`).join("\n"),
    }
  })
}

/** A product line: the price fields are ready to read (formatted by the template). */
export interface KitItem {
  title: string
  variant?: string | null
  sku?: string | null
  quantity: number | string
  unitPrice?: string | null
  total?: string | null
}

/**
 * The short code of a product tile, from its SKU: KS-ELN-18V gives ELN over
 * 18V (with three parts or more the first is taken for a store prefix), ABC-1
 * gives ABC over 1, and without a SKU the initials of the name.
 */
export function productCode(sku: string | null | undefined, title: string | null | undefined): [string, string] {
  const parts = String(sku ?? "")
    .split(/[-_\s/.]+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
  const use = parts.length >= 3 ? parts.slice(1) : parts
  if (use.length > 0) return [use[0].slice(0, 4).toUpperCase(), (use[1] ?? "").slice(0, 4).toUpperCase()]
  const words = String(title ?? "")
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
  const initials = words
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
  return [initials || "•", ""]
}

function tile(ctx: KitContext, sku: string | null | undefined, title: string | null | undefined, size: number, where: "light" | "night"): string {
  const [family, model] = productCode(sku, title)
  const p = ctx.palette
  const big = Math.round(size / 3.5)
  const small = Math.max(9, Math.round(size / 5.6))
  const ink = where === "night" ? p.onNight : p.light.ink
  const faint = where === "night" ? p.onNightFaint : p.light.faint
  const inkCls = where === "night" ? "" : "em-ink"
  const faintCls = where === "night" ? "" : "em-faint"
  const lines =
    para(esc(family), `font-family:${ctx.fonts.head};font-size:${big}px;line-height:${big + 1}px;font-weight:800;letter-spacing:0.02em;color:${ink}`, inkCls) +
    (model ? para(esc(model), `margin-top:2px;font-family:${ctx.fonts.mono};font-size:${small}px;line-height:${small + 2}px;color:${faint}`, faintCls) : "")
  const bg = where === "night" ? `background:${p.nightCard};border:1px solid ${p.nightLine}` : `background:${p.light.thumb}`
  const cls = where === "night" ? "" : ' class="em-thumb"'
  const bgAttr = where === "night" ? p.nightCard : p.light.thumb
  return `<table ${TABLE}><tr><td width="${size}" height="${size}" align="center" valign="middle"${cls} bgcolor="${bgAttr}" style="width:${size}px;height:${size}px;border-radius:12px;${bg}">${lines}</td></tr></table>`
}

/** Product lines: a tile, the name, the SKU, the quantity (and unit price), the line value. */
export function items(list: readonly KitItem[], opts: { max?: number } = {}): Block {
  return block("body", (ctx) => {
    const max = Math.max(1, opts.max ?? MAX_ITEMS_SHOWN)
    const shown = list.slice(0, max)
    const rest = list.length - shown.length
    if (shown.length === 0) return { html: "", text: "" }
    const p = ctx.palette
    const title = lightText(ctx, 15, 21, 600, "ink")
    const sku = { style: `font-family:${ctx.fonts.mono};font-size:11px;line-height:16px;color:${p.light.faint}`, cls: "em-faint" }
    const qty = lightText(ctx, 13, 18, 400, "sub")
    const value = lightText(ctx, 15, 21, 700, "ink")
    const rows = shown.map((it, i) => {
      const edge = i ? `border-top:1px solid ${p.light.line};` : ""
      const name = it.variant ? `${it.title}, ${it.variant}` : it.title
      const q = ctx.copy.quantity(String(it.quantity))
      const each = it.unitPrice ? ` ${ctx.copy.each(it.unitPrice)}` : ""
      return `<tr>
        <td width="56" valign="top" class="em-line" style="${edge}padding:${i ? 14 : 2}px 0 14px">${tile(ctx, it.sku, it.title, 56, "light")}</td>
        <td valign="top" class="em-line" style="${edge}padding:${i ? 14 : 2}px 0 14px 14px">
          ${para(esc(name), title.style, title.cls)}
          ${it.sku ? para(esc(it.sku), `margin-top:3px;${sku.style}`, sku.cls) : ""}
          ${para(esc(`${q}${each}`), `margin-top:3px;${qty.style}`, qty.cls)}
        </td>
        <td valign="top" align="right" class="em-line" style="${edge}padding:${i ? 14 : 2}px 0 14px 12px;white-space:nowrap">${it.total ? para(esc(it.total), value.style, value.cls) : ""}</td>
      </tr>`
    })
    if (rest > 0) {
      const more = lightText(ctx, 13, 18, 600, "sub")
      rows.push(`<tr><td colspan="3" class="em-line" style="border-top:1px solid ${p.light.line};padding:12px 0 2px">${para(esc(ctx.copy.more(rest)), more.style, more.cls)}</td></tr>`)
    }
    const text = shown
      .map((it) => {
        const name = it.variant ? `${it.title}, ${it.variant}` : it.title
        const each = it.unitPrice ? ` ${ctx.copy.each(it.unitPrice)}` : ""
        return `- ${name}${it.sku ? ` (${it.sku})` : ""}, ${ctx.copy.quantity(String(it.quantity))}${each}${it.total ? `: ${it.total}` : ""}`
      })
      .concat(rest > 0 ? [ctx.copy.more(rest)] : [])
      .join("\n")
    return { html: `<table ${TABLE} width="100%">${rows.join("")}</table>`, text }
  })
}

/** Summary lines and the total, with notes under it ("including VAT 23,00 zł"). */
export function totals(lines: Array<[Inline, string | null | undefined]>, total: [Inline, string | null | undefined], notes: Inline[] = []): Block {
  return block("body", (ctx) => {
    const p = ctx.palette
    const rows = lines
      .filter(([, v]) => typeof v === "string" && v.trim())
      .map(([k, v]) => {
        const key = inline(k, ctx)
        return {
          html: `<tr><td class="em-sub" style="padding:0 0 8px;font-family:${ctx.fonts.body};font-size:14px;line-height:20px;color:${p.light.sub}">${key.html}</td><td align="right" class="em-ink" style="padding:0 0 8px;font-family:${ctx.fonts.body};font-size:14px;line-height:20px;color:${p.light.ink};white-space:nowrap">${esc(v)}</td></tr>`,
          text: `${key.text}: ${v}`,
        }
      })
    const totalKey = inline(total[0], ctx)
    const totalValue = typeof total[1] === "string" ? total[1].trim() : ""
    const noteParts = notes.map((n) => inline(n, ctx)).filter((n) => n.text.trim())
    if (rows.length === 0 && !totalValue) return { html: "", text: "" }
    const html = `<table ${TABLE} width="100%" class="em-line" style="border-top:1px solid ${p.light.line}">
      <tr><td colspan="2" style="padding:14px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
      ${rows.map((r) => r.html).join("")}
      ${
        totalValue
          ? `<tr><td valign="bottom" class="em-ink" style="padding:8px 0 0;font-family:${ctx.fonts.head};font-size:17px;line-height:22px;font-weight:800;color:${p.light.ink}">${totalKey.html}</td><td valign="bottom" align="right" class="em-ink" style="padding:8px 0 0;font-family:${ctx.fonts.head};font-size:24px;line-height:28px;font-weight:800;letter-spacing:-0.01em;color:${p.light.ink};white-space:nowrap">${esc(totalValue)}</td></tr>`
          : ""
      }
      ${noteParts.map((n) => `<tr><td colspan="2" align="right" class="em-faint" style="padding:4px 0 0;font-family:${ctx.fonts.body};font-size:12px;line-height:16px;color:${p.light.faint}">${n.html}</td></tr>`).join("")}
    </table>`
    const text = [...rows.map((r) => r.text), totalValue ? `${totalKey.text}: ${totalValue}` : "", ...noteParts.map((n) => n.text)].filter(Boolean).join("\n")
    return { html, text }
  })
}

function badgeRows(ctx: KitContext, list: Array<{ title: Inline; body?: Inline }>, mark: (i: number) => string, size: number): Out {
  const t = lightText(ctx, 15, 21, 700, "ink")
  const b = lightText(ctx, 14, 21, 400, "sub")
  const rows = list.map((s, i) => {
    const title = inline(s.title, ctx)
    const body = inline(s.body, ctx)
    return {
      html: `<tr>
        <td width="${size + 6}" valign="top" style="padding:${i ? 16 : 0}px 0 0"><table ${TABLE}><tr><td width="${size}" height="${size}" align="center" valign="middle" class="em-tint" bgcolor="${ctx.palette.light.tint}" style="width:${size}px;height:${size}px;border-radius:${size / 2}px;background:${ctx.palette.light.tint};font-family:${ctx.fonts.head};font-size:${Math.round(size / 2)}px;line-height:${size}px;font-weight:800"><span class="em-accent" style="color:${ctx.palette.light.accentInk}">${mark(i)}</span></td></tr></table></td>
        <td valign="top" style="padding:${i ? 16 : 0}px 0 0 10px">${para(title.html, `padding-top:2px;${t.style}`, t.cls)}${body.text ? para(body.html, `margin-top:2px;${b.style}`, b.cls) : ""}</td>
      </tr>`,
      text: `${title.text}${body.text ? `: ${body.text}` : ""}`,
    }
  })
  return { html: `<table ${TABLE} width="100%">${rows.map((r) => r.html).join("")}</table>`, text: rows.map((r) => r.text).join("\n") }
}

/** Numbered steps: what to do first. */
export function steps(list: Array<{ title: Inline; body?: Inline }>): Block {
  return block("body", (ctx) => {
    if (list.length === 0) return { html: "", text: "" }
    const out = badgeRows(ctx, list, (i) => String(i + 1), 28)
    return { html: out.html, text: out.text.split("\n").map((l, i) => `${i + 1}. ${l}`).join("\n") }
  })
}

/** A list with check marks: what the customer gets. */
export function checks(list: Array<{ title: Inline; body?: Inline }>): Block {
  return block("body", (ctx) => {
    if (list.length === 0) return { html: "", text: "" }
    const out = badgeRows(ctx, list, () => "&#10003;", 22)
    return { html: out.html, text: out.text.split("\n").map((l) => `+ ${l}`).join("\n") }
  })
}

/** A tinted box with one sentence: in the accent colour or, for a warning, amber. */
export function note(content: Inline, tone: "accent" | "amber" = "accent"): Block {
  return block("body", (ctx) => {
    const o = inline(content, ctx)
    if (!o.text.trim()) return { html: "", text: "" }
    const p = ctx.palette
    const bg = tone === "amber" ? p.light.amberBg : p.light.tint
    const bgCls = tone === "amber" ? "em-amber-bg" : "em-tint"
    const markColor = tone === "amber" ? p.light.amber : p.light.accentInk
    const markCls = tone === "amber" ? "em-amber" : "em-accent"
    const mark = tone === "amber" ? "!" : "&#10003;"
    return {
      html: `<table ${TABLE} width="100%" class="${bgCls}" bgcolor="${bg}" style="background:${bg};border-radius:14px;border-collapse:separate"><tr>
        <td width="30" valign="top" style="padding:16px 0 16px 16px;font-family:${ctx.fonts.body};font-size:14px;line-height:20px;font-weight:800"><span class="${markCls}" style="color:${markColor}">${mark}</span></td>
        <td valign="top" class="em-ink" style="padding:16px 18px 16px 4px;font-family:${ctx.fonts.body};font-size:14px;line-height:21px;color:${p.light.ink}">${o.html}</td>
      </tr></table>`,
      text: o.text,
    }
  })
}

export interface Action {
  label: Inline
  href: string | null | undefined
}

/**
 * The main button and an optional text link next to it. A link that is not a
 * valid http(s) address is left out; with no valid link the block is empty.
 */
export function actions(primary: Action | null, secondary?: Action | null): Block {
  return block("body", (ctx) => {
    const valid = [primary, secondary].filter((a): a is Action => Boolean(a) && Boolean(safeUrl(a?.href)))
    if (valid.length === 0) return { html: "", text: "" }
    const [main, second] = valid
    const p = ctx.palette
    const mainUrl = safeUrl(main.href) as string
    const mainLabel = inline(main.label, ctx)
    const button = `<table ${TABLE}><tr><td bgcolor="${p.accent}" style="background:${p.accent};border-radius:12px;mso-padding-alt:14px 24px"><a href="${esc(mainUrl)}" style="display:inline-block;padding:14px 24px;font-family:${ctx.fonts.body};font-size:15px;line-height:20px;font-weight:700;color:${p.onAccent};text-decoration:none;border-radius:12px">${mainLabel.html}&nbsp;&nbsp;&rarr;</a></td></tr></table>`
    let secondHtml = ""
    let secondText = ""
    if (second) {
      const url = safeUrl(second.href) as string
      const label = inline(second.label, ctx)
      secondHtml = `<td class="em-stack em-stack-gap" valign="middle" style="padding-left:20px"><a href="${esc(url)}" class="em-accent" style="font-family:${ctx.fonts.body};font-size:14px;line-height:20px;font-weight:700;color:${p.light.accentInk};text-decoration:none">${label.html}</a></td>`
      secondText = `\n${label.text}: ${url}`
    }
    return {
      html: `<table ${TABLE}><tr><td class="em-stack" valign="middle">${button}</td>${secondHtml}</tr></table>`,
      text: `${mainLabel.text}: ${mainUrl}${secondText}`,
    }
  })
}

/** "The button does not work? Copy this address": the full link in small monospace, for the text-minded. */
export function linkFallback(url: string | null | undefined): Block {
  return block("body", (ctx) => {
    const safe = safeUrl(url)
    if (!safe) return { html: "", text: "" }
    const t = lightText(ctx, 12.5, 19, 400, "faint")
    return {
      html: `${para(esc(ctx.copy.linkFallback), t.style, t.cls)}${para(`<a href="${esc(safe)}" class="em-accent" style="color:${ctx.palette.light.accentInk};text-decoration:underline;word-break:break-all">${esc(safe)}</a>`, `margin-top:4px;font-family:${ctx.fonts.mono};font-size:12px;line-height:18px;word-break:break-all`)}`,
      text: "",
    }
  })
}

/** Parcels: the tracking number, the carrier and a "Track the parcel" link per label. */
export function tracking(list: Array<{ number: string; url?: string | null; carrier?: string | null }>): Block {
  return block("body", (ctx) => {
    const rows = list.filter((t) => typeof t.number === "string" && t.number.trim())
    if (rows.length === 0) return { html: "", text: "" }
    const p = ctx.palette
    const k = lightText(ctx, 12, 16, 400, "faint")
    const v = { style: `font-family:${ctx.fonts.mono};font-size:15px;line-height:21px;font-weight:600;color:${p.light.ink}`, cls: "em-ink" }
    const html = rows
      .map((t, i) => {
        const url = safeUrl(t.url)
        const carrier = t.carrier ? para(esc(`${ctx.copy.carrier}: ${t.carrier}`), `margin-top:3px;${k.style}`, k.cls) : ""
        const go = url
          ? `<td valign="middle" align="right" style="padding-left:12px;white-space:nowrap"><a href="${esc(url)}" class="em-accent" style="font-family:${ctx.fonts.body};font-size:14px;line-height:20px;font-weight:700;color:${p.light.accentInk};text-decoration:none">${esc(ctx.copy.track)}&nbsp;&rarr;</a></td>`
          : ""
        return `<table ${TABLE} width="100%" class="em-soft" bgcolor="${p.light.soft}" style="background:${p.light.soft};border-radius:14px;border-collapse:separate${i ? ";margin-top:10px" : ""}"><tr>
          <td valign="middle" style="padding:14px 18px">${para(esc(ctx.copy.trackingNumber), k.style, k.cls)}${para(esc(t.number.trim()), `margin-top:3px;${v.style};word-break:break-all`, v.cls)}${carrier}</td>${go}
        </tr></table>`
      })
      .join("")
    const text = rows.map((t) => `${ctx.copy.trackingNumber}: ${t.number.trim()}${t.carrier ? ` (${t.carrier})` : ""}${safeUrl(t.url) ? `\n${ctx.copy.track}: ${safeUrl(t.url)}` : ""}`).join("\n")
    return { html, text }
  })
}

/** Prices on examples: the old one struck through, the new one in the accent colour, an optional badge (-18%). */
export function priceList(rows: Array<{ title: string; sku?: string | null; was?: string | null; now: string; badge?: string | null }>): Block {
  return block("body", (ctx) => {
    if (rows.length === 0) return { html: "", text: "" }
    const p = ctx.palette
    const t = lightText(ctx, 14, 20, 600, "ink")
    const html = rows
      .map((r, i) => {
        const edge = i ? `border-top:1px solid ${p.light.line};` : ""
        const badge = r.badge
          ? ` <span class="em-tint" style="display:inline-block;margin-left:4px;padding:1px 6px;border-radius:999px;background:${p.light.tint};font-size:11px;line-height:16px;font-weight:700"><span class="em-accent" style="color:${p.light.accentInk}">${esc(r.badge)}</span></span>`
          : ""
        return `<tr>
          <td width="48" valign="middle" class="em-line" style="${edge}padding:12px 0">${tile(ctx, r.sku, r.title, 44, "light")}</td>
          <td valign="middle" class="em-line" style="${edge}padding:12px 0 12px 12px">${para(esc(r.title), t.style, t.cls)}${r.sku ? para(esc(r.sku), `margin-top:2px;font-family:${ctx.fonts.mono};font-size:11px;line-height:15px;color:${p.light.faint}`, "em-faint") : ""}</td>
          <td valign="middle" align="right" class="em-line" style="${edge}padding:12px 0 12px 10px;white-space:nowrap">${r.was ? para(esc(r.was), `font-family:${ctx.fonts.body};font-size:12.5px;line-height:17px;color:${p.light.faint};text-decoration:line-through`, "em-faint") : ""}${para(`${esc(r.now)}${badge}`, `margin-top:2px;font-family:${ctx.fonts.body};font-size:15px;line-height:21px;font-weight:800;color:${p.light.accentInk}`, "em-accent")}</td>
        </tr>`
      })
      .join("")
    const text = rows.map((r) => `- ${r.title}${r.sku ? ` (${r.sku})` : ""}: ${r.was ? `${r.was} > ` : ""}${r.now}${r.badge ? ` (${r.badge})` : ""}`).join("\n")
    return { html: `<table ${TABLE} width="100%">${html}</table>`, text }
  })
}

/** A thin line between two parts of the body. */
export function divider(): Block {
  return block("body", (ctx) => ({
    html: `<table ${TABLE} width="100%"><tr><td class="em-line" style="border-top:1px solid ${ctx.palette.light.line};font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table>`,
    text: "",
  }))
}

/* ------------------------------------------------------------------ */
/* Blocks of the dark band                                             */
/* ------------------------------------------------------------------ */

export type StepState = "done" | "current" | "todo"

/** The road of an order, drawn with table cells so it holds in Outlook too. */
export function tracker(list: Array<{ label: Inline; when?: Inline; state: StepState }>): Block {
  return block("band", (ctx) => {
    if (list.length === 0) return { html: "", text: "" }
    const p = ctx.palette
    const lit = (a: StepState, b: StepState) => a === "done" && b !== "todo"
    const line = (color: string) => `<div style="height:2px;line-height:2px;font-size:0;background:${color}">&nbsp;</div>`
    const width = Math.floor(100 / list.length)
    const parts = list.map((s) => ({ label: inline(s.label, ctx, "night"), when: inline(s.when, ctx, "night"), state: s.state }))
    const cells = parts
      .map((s, i) => {
        const left = i === 0 ? "transparent" : lit(parts[i - 1].state, s.state) ? p.accent : p.nightLine
        const right = i === parts.length - 1 ? "transparent" : lit(s.state, parts[i + 1].state) ? p.accent : p.nightLine
        const dot =
          s.state === "done"
            ? `background:${p.accent};border:2px solid ${p.accent}`
            : s.state === "current"
              ? `background:${p.night};border:2px solid ${p.accent}`
              : `background:${p.night};border:2px solid ${p.nightLine}`
        const ink = s.state === "todo" ? p.onNightFaint : p.onNight
        return `<td width="${width}%" valign="top" align="center">
          <table ${TABLE} width="100%"><tr>
            <td width="50%" valign="middle">${line(left)}</td>
            <td width="14" valign="middle"><div style="width:10px;height:10px;border-radius:7px;${dot}"></div></td>
            <td width="50%" valign="middle">${line(right)}</td>
          </tr></table>
          ${para(s.label.html, `margin-top:10px;font-family:${ctx.fonts.body};font-size:13px;line-height:18px;font-weight:700;color:${ink}`, "em-step")}
          ${para(s.when.html || "&nbsp;", `margin-top:2px;font-family:${ctx.fonts.body};font-size:12px;line-height:16px;color:${s.state === "todo" ? p.onNightFaint : p.accentOnNight}`, "em-step")}
        </td>`
      })
      .join("")
    const text = parts.map((s) => `${s.state === "todo" ? "( )" : "(x)"} ${s.label.text}${s.when.text ? ` ${s.when.text}` : ""}`).join("\n")
    return { html: `<table ${TABLE} width="100%"><tr>${cells}</tr></table>`, text }
  })
}

function bandPill(ctx: KitContext, label: Out, tone: "accent" | "amber" | "muted" | "red"): string {
  const p = ctx.palette
  if (tone === "muted") return `<span style="font-family:${ctx.fonts.body};font-size:11px;line-height:14px;color:${p.onNightFaint};white-space:nowrap">${label.html}</span>`
  const colors = tone === "amber" ? { bg: "#3A3420", fg: "#F2C25B" } : tone === "red" ? { bg: "#3D1F1C", fg: "#F59E97" } : { bg: p.nightPill, fg: p.accentOnNight }
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${colors.bg};font-family:${ctx.fonts.body};font-size:11px;line-height:14px;font-weight:700;color:${colors.fg};white-space:nowrap">${label.html}</span>`
}

/** The customer card on the band: the store mark, a name, a status and a few small facts, like a member card. */
export function card(input: { title: Inline; subtitle?: Inline; status?: { label: Inline; tone: "accent" | "amber" | "muted" }; pairs?: Array<[Inline, Inline]>; highlight?: number }): Block {
  return block("band", (ctx) => {
    const p = ctx.palette
    const title = inline(input.title, ctx, "night")
    const subtitle = inline(input.subtitle, ctx, "night")
    const status = input.status ? bandPill(ctx, inline(input.status.label, ctx, "night"), input.status.tone) : ""
    const pairs = (input.pairs ?? []).map(([k, v]) => [inline(k, ctx, "night"), inline(v, ctx, "night")] as const).filter(([, v]) => v.text.trim())
    const small = pairs
      .map(
        ([k, v], i) =>
          `<td valign="bottom" style="padding-right:22px;white-space:nowrap">${para(k.html, `font-family:${ctx.fonts.body};font-size:11px;line-height:15px;color:${p.onNightFaint}`)}${para(v.html, `margin-top:3px;font-family:${ctx.fonts.body};font-size:14px;line-height:19px;font-weight:700;color:${i === input.highlight ? p.accentOnNight : p.onNight};white-space:nowrap`)}</td>`,
      )
      .join("")
    const html = `<table ${TABLE} width="380" class="em-full" style="width:380px;max-width:100%"><tr>
      <td bgcolor="${p.nightCard}" style="background:${p.nightCard};border:1px solid ${p.nightLine};border-radius:18px;padding:20px 22px 18px">
        <table ${TABLE} width="100%">
          <tr><td valign="middle" style="white-space:nowrap">${brandmark(ctx, 15)}</td><td valign="middle" align="right">${status}</td></tr>
          <tr><td colspan="2" style="padding:28px 0 0">${para(title.html, `font-family:${ctx.fonts.head};font-size:20px;line-height:24px;font-weight:800;letter-spacing:-0.01em;color:${p.onNight}`)}${subtitle.text ? para(subtitle.html, `margin-top:3px;font-family:${ctx.fonts.body};font-size:13px;line-height:18px;color:${p.onNightSub}`) : ""}</td></tr>
          ${small ? `<tr><td colspan="2" style="padding:22px 0 0"><table ${TABLE}><tr>${small}</tr></table></td></tr>` : ""}
        </table>
      </td>
    </tr></table>`
    const text = [title.text, subtitle.text, ...pairs.map(([k, v]) => `${k.text}: ${v.text}`)].filter(Boolean).join("\n")
    return { html, text }
  })
}

/**
 * A document as a paper slip on the band: a label and a number, a status
 * pill, a row of cells (the last one can be big, an amount), and an optional
 * perforated stub (a KSeF number, a reference).
 */
export function slip(input: {
  label: Inline
  number: Inline
  status?: { label: Inline; tone: "accent" | "amber" | "red" | "muted" }
  cells: Array<{ label: Inline; value: Inline; big?: boolean }>
  stub?: { tag: Inline; text: Inline; status?: Inline }
}): Block {
  return block("band", (ctx) => {
    /* Paper stays light in dark mode, like a printed document. */
    const ink = "#151915"
    const sub = "#535D53"
    const faint = "#687168"
    const paperLine = "#E2E6E0"
    const p = ctx.palette
    const label = inline(input.label, ctx, "paper")
    const number = inline(input.number, ctx, "paper")
    let status = ""
    if (input.status) {
      const s = inline(input.status.label, ctx, "paper")
      const colors =
        input.status.tone === "accent"
          ? { bg: p.light.tint, fg: p.light.accentInk }
          : input.status.tone === "amber"
            ? { bg: "#FFF3D6", fg: "#8A5800" }
            : input.status.tone === "red"
              ? { bg: "#FEECEB", fg: "#B42318" }
              : { bg: "#EFF2ED", fg: sub }
      status = `<span style="display:inline-block;padding:5px 11px;border-radius:999px;background:${colors.bg};font-family:${ctx.fonts.body};font-size:12px;line-height:15px;font-weight:700;color:${colors.fg};white-space:nowrap">${s.html}</span>`
    }
    const cells = input.cells.map((c) => ({ label: inline(c.label, ctx, "paper"), value: inline(c.value, ctx, "paper"), big: Boolean(c.big) })).filter((c) => c.value.text.trim())
    const cellHtml = cells
      .map(
        (c, i) =>
          `<td class="em-stack" valign="top" style="padding:0 ${i === cells.length - 1 ? 0 : 14}px 12px 0">${para(c.label.html, `font-family:${ctx.fonts.body};font-size:11.5px;line-height:15px;color:${faint}`)}${para(
            c.value.html,
            c.big
              ? `margin-top:3px;font-family:${ctx.fonts.head};font-size:20px;line-height:24px;font-weight:800;color:${ink};white-space:nowrap`
              : `margin-top:4px;font-family:${ctx.fonts.body};font-size:14px;line-height:19px;font-weight:600;color:${ink};white-space:nowrap`,
          )}</td>`,
      )
      .join("")
    let stub = ""
    let stubText = ""
    if (input.stub) {
      const tag = inline(input.stub.tag, ctx, "paper")
      const st = inline(input.stub.text, ctx, "paper")
      const ss = inline(input.stub.status, ctx, "paper")
      if (st.text.trim()) {
        stub = `<tr><td style="border-top:2px dashed ${paperLine};padding:14px 22px 16px"><table ${TABLE} width="100%"><tr>
          <td valign="middle" width="1" style="padding-right:10px"><span style="display:inline-block;padding:4px 8px;border-radius:6px;background:${p.night};font-family:${ctx.fonts.body};font-size:11px;line-height:14px;font-weight:800;letter-spacing:0.04em;color:${p.onNight};white-space:nowrap">${tag.html}</span></td>
          <td valign="middle" style="font-family:${ctx.fonts.mono};font-size:11.5px;line-height:16px;color:${sub};word-break:break-all">${st.html}</td>
          ${ss.text ? `<td valign="middle" align="right" style="padding-left:10px;font-family:${ctx.fonts.body};font-size:12px;line-height:16px;font-weight:700;color:${p.light.accentInk};white-space:nowrap">${ss.html}</td>` : ""}
        </tr></table></td></tr>`
        stubText = `${tag.text}: ${st.text}${ss.text ? ` (${ss.text})` : ""}`
      }
    }
    const html = `<table ${TABLE} width="100%" bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:16px;border-collapse:separate">
      <tr><td style="padding:20px 22px 8px">
        <table ${TABLE} width="100%"><tr>
          <td valign="top">${para(label.html, `font-family:${ctx.fonts.body};font-size:12px;line-height:16px;color:${faint}`)}${para(number.html, `margin-top:3px;font-family:${ctx.fonts.head};font-size:22px;line-height:27px;font-weight:800;letter-spacing:-0.01em;color:${ink}`)}</td>
          <td valign="top" align="right" style="padding-left:12px">${status}</td>
        </tr></table>
        ${cellHtml ? `<table ${TABLE} width="100%" style="margin-top:18px"><tr>${cellHtml}</tr></table>` : ""}
      </td></tr>
      ${stub}
    </table>`
    const statusText = input.status ? inline(input.status.label, ctx, "paper").text : ""
    const text = [`${label.text}: ${number.text}${statusText ? ` (${statusText})` : ""}`, ...cells.map((c) => `${c.label.text}: ${c.value.text}`), stubText].filter(Boolean).join("\n")
    return { html, text }
  })
}

/** Up to four product tiles and a value, on the band: the cart at a glance. */
export function tiles(list: readonly KitItem[], value?: { label: Inline; amount: string | null | undefined }): Block {
  return block("band", (ctx) => {
    if (list.length === 0) return { html: "", text: "" }
    const p = ctx.palette
    const shown = list.slice(0, 4)
    const more = list.length - shown.length
    const cells = shown.map((it) => `<td style="padding-right:8px">${tile(ctx, it.sku, it.title, 52, "night")}</td>`).join("")
    const extra = more > 0 ? `<td style="padding-right:8px;font-family:${ctx.fonts.body};font-size:13px;font-weight:700;color:${p.onNightSub}">+${more}</td>` : ""
    const amount = value && typeof value.amount === "string" && value.amount.trim() ? value.amount.trim() : ""
    const label = value ? inline(value.label, ctx, "night") : { html: "", text: "" }
    const sum = amount
      ? `<td align="right" valign="middle">${para(label.html, `font-family:${ctx.fonts.body};font-size:11px;line-height:15px;color:${p.onNightFaint}`)}${para(esc(amount), `margin-top:3px;font-family:${ctx.fonts.head};font-size:24px;line-height:28px;font-weight:800;color:${p.onNight};white-space:nowrap`)}</td>`
      : ""
    return {
      html: `<table ${TABLE} width="100%"><tr><td valign="middle"><table ${TABLE}><tr>${cells}${extra}</tr></table></td>${sum}</tr></table>`,
      text: amount ? `${label.text}: ${amount}` : "",
    }
  })
}

/* ------------------------------------------------------------------ */
/* The document                                                        */
/* ------------------------------------------------------------------ */

/** A message as the templates describe it; `layout` turns it into HTML and text. */
export interface EmailDocument {
  /** Plain text, no HTML. */
  subject: string
  /** The grey line mail apps show after the subject. Plain text. */
  preheader?: string
  /** Top right of the band: what this message is about ("Order 1042"). */
  chip?: Inline
  /** The pill above the title ("Order placed"). */
  eyebrow?: Inline
  title: Inline
  intro?: Inline
  /** One block on the band, under the intro: a tracker, a card, a slip, tiles. */
  band?: Block | null
  /** The light body, top to bottom. Empty blocks are skipped. */
  blocks: Array<Block | null | undefined | false>
  /** The "Questions?" box at the end. Default true (shown when there is a way to reach the store). */
  help?: boolean
}

export interface Rendered {
  subject: string
  preheader: string
  html: string
  text: string
}

/** Live text in the shape of a logo: the name, an accent part (the "+"), a lighter suffix. */
export function brandmark(ctx: KitContext, size: number): string {
  const p = ctx.palette
  const { text, accent: accentPart, suffix, italic } = ctx.brand.logo
  const wrap = text.length + (suffix?.length ?? 0) > 22 ? "normal" : "nowrap"
  const main = `<span style="font-family:${ctx.fonts.head};font-size:${size}px;line-height:${size + 2}px;font-weight:800;${italic ? "font-style:italic;" : ""}letter-spacing:-0.02em;color:${p.onNight};white-space:${wrap}">${esc(text)}${accentPart ? `<span style="color:${p.accentOnNight};font-weight:900;padding-left:0.04em">${esc(accentPart)}</span>` : ""}</span>`
  const rest = suffix
    ? `<span style="font-family:${ctx.fonts.body};font-size:${Math.round(size * 0.62)}px;line-height:${size + 2}px;font-weight:500;color:${p.onNightFaint};padding-left:${Math.round(size * 0.36)}px;white-space:${wrap}">${esc(suffix)}</span>`
    : ""
  return main + rest
}

function logoText(ctx: KitContext): string {
  const { text, accent: accentPart, suffix } = ctx.brand.logo
  return `${text}${accentPart ?? ""}${suffix ? ` ${suffix}` : ""}`
}

type ThemeClass = { cls: string; prop: "color" | "background-color" | "border-color"; light: string; dark: string }

function themeClasses(p: Palette): ThemeClass[] {
  return [
    { cls: "em-page", prop: "background-color", light: p.light.page, dark: p.dark.page },
    { cls: "em-card", prop: "background-color", light: p.light.card, dark: p.dark.card },
    { cls: "em-soft", prop: "background-color", light: p.light.soft, dark: p.dark.soft },
    { cls: "em-tint", prop: "background-color", light: p.light.tint, dark: p.dark.tint },
    { cls: "em-thumb", prop: "background-color", light: p.light.thumb, dark: p.dark.thumb },
    { cls: "em-amber-bg", prop: "background-color", light: p.light.amberBg, dark: p.dark.amberBg },
    { cls: "em-ink", prop: "color", light: p.light.ink, dark: p.dark.ink },
    { cls: "em-sub", prop: "color", light: p.light.sub, dark: p.dark.sub },
    { cls: "em-faint", prop: "color", light: p.light.faint, dark: p.dark.faint },
    { cls: "em-accent", prop: "color", light: p.light.accentInk, dark: p.dark.accentInk },
    { cls: "em-amber", prop: "color", light: p.light.amber, dark: p.dark.amber },
    { cls: "em-line", prop: "border-color", light: p.light.line, dark: p.dark.line },
  ]
}

function css(ctx: KitContext): string {
  const classes = themeClasses(ctx.palette)
  const scope = (prefix: string, mode: "light" | "dark") => classes.map((s) => `${prefix}.${s.cls}{${s.prop}:${s[mode]}!important}`).join("")
  const outlook = classes
    .filter((s) => s.prop !== "border-color")
    .map((s) => `[data-${s.prop === "color" ? "ogsc" : "ogsb"}] .${s.cls}{${s.prop}:${s.dark}!important}`)
    .join("")
  const faces = ctx.fonts.faces
    .map((f) => `@font-face{font-family:'${f.family}';font-style:normal;font-weight:100 900;font-display:swap;src:url('${f.url}')}`)
    .join("")
  return [
    faces ? `@media screen{${faces}}` : "",
    ":root{color-scheme:light dark;supported-color-schemes:light dark}",
    "body{margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}",
    "a{text-decoration:none}",
    `@media (prefers-color-scheme:dark){${scope("", "dark")}}`,
    scope("html.em-theme-dark ", "dark"),
    scope("html.em-theme-light ", "light"),
    outlook,
    "@media only screen and (max-width:620px){" +
      ".em-outer{padding:16px 8px 28px!important}" +
      ".em-px{padding-left:22px!important;padding-right:22px!important}" +
      ".em-h1{font-size:28px!important;line-height:33px!important}" +
      ".em-stack{display:block!important;width:100%!important}" +
      ".em-stack-gap{padding-top:14px!important;padding-left:0!important}" +
      ".em-full{width:100%!important;max-width:100%!important}" +
      ".em-step{font-size:11px!important}" +
      ".em-hide-sm{display:none!important}" +
      "}",
  ]
    .filter(Boolean)
    .join("\n")
}

function preheaderHtml(text: string): string {
  const filler = "&#8199;&#847; ".repeat(60)
  return `<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:transparent;opacity:0">${esc(text)}${filler}</div>`
}

function pill(ctx: KitContext, label: Out): string {
  const p = ctx.palette
  return `<table ${TABLE}><tr><td bgcolor="${p.nightPill}" style="background:${p.nightPill};border-radius:999px;padding:6px 13px 6px 11px;font-family:${ctx.fonts.body};font-size:12px;line-height:16px;font-weight:700;color:${p.accentOnNight};white-space:nowrap"><span style="display:inline-block;width:6px;height:6px;border-radius:3px;background:${p.accentOnNight};vertical-align:middle"></span><span style="vertical-align:middle;padding-left:7px">${label.html}</span></td></tr></table>`
}

function helpBox(ctx: KitContext): Out | null {
  const { supportEmail, replyTo } = ctx.brand
  if (!supportEmail && !replyTo) return null
  const p = ctx.palette
  const mail = supportEmail ? link(`mailto:${supportEmail}`, supportEmail) : null
  const body: Inline = supportEmail && replyTo ? withEmail(ctx.copy.helpReplyOr("\u0000"), mail) : supportEmail ? withEmail(ctx.copy.helpWrite("\u0000"), mail) : ctx.copy.helpReply
  const title = lightText(ctx, 14, 20, 700, "ink")
  const sub = lightText(ctx, 13.5, 20, 400, "sub")
  const b = inline(body, ctx)
  return {
    html: `<table ${TABLE} width="100%" class="em-soft" bgcolor="${p.light.soft}" style="background:${p.light.soft};border-radius:14px;border-collapse:separate"><tr>
      <td width="44" valign="top" style="padding:18px 0 18px 18px"><table ${TABLE}><tr><td width="30" height="30" align="center" valign="middle" class="em-tint" bgcolor="${p.light.tint}" style="width:30px;height:30px;border-radius:15px;background:${p.light.tint};font-family:${ctx.fonts.head};font-size:15px;line-height:30px;font-weight:800"><span class="em-accent" style="color:${p.light.accentInk}">?</span></td></tr></table></td>
      <td valign="top" style="padding:18px 20px 18px 12px">${para(esc(ctx.copy.helpTitle), title.style, title.cls)}${para(b.html, `margin-top:2px;${sub.style}`, sub.cls)}</td>
    </tr></table>`,
    text: `${ctx.copy.helpTitle} ${b.text}`,
  }
}

/** A sentence with a placeholder (\u0000) replaced by an inline node, so the address can be a link. */
function withEmail(sentence: string, node: Inline): Inline {
  const at = sentence.indexOf("\u0000")
  if (at < 0) return sentence
  return [sentence.slice(0, at), node, sentence.slice(at + 1)]
}

/** HTML and plain text of a whole message. */
export function layout(doc: EmailDocument, ctx: KitContext): Rendered {
  const p = ctx.palette
  const f = ctx.fonts
  const chip = inline(doc.chip, ctx, "night")
  const eyebrow = inline(doc.eyebrow, ctx, "night")
  const title = inline(doc.title, ctx, "night")
  const intro = inline(doc.intro, ctx, "night")
  const band = doc.band ? doc.band.render(ctx) : null
  const bodyParts = doc.blocks.filter((b): b is Block => Boolean(b)).map((b) => b.render(ctx)).filter((o) => o.html)
  const help = doc.help === false ? null : helpBox(ctx)
  const subject = doc.subject.replace(/\s+/g, " ").trim()
  const preheader = (doc.preheader ?? "").replace(/\s+/g, " ").trim()

  const rows = bodyParts.map((o, i) => `<tr><td class="em-px" style="padding:${i === 0 ? 36 : 32}px 40px 0">${o.html}</td></tr>`)
  if (help) rows.push(`<tr><td class="em-px" style="padding:32px 40px 40px">${help.html}</td></tr>`)
  else rows.push(`<tr><td style="padding:0 0 40px;font-size:0;line-height:0">&nbsp;</td></tr>`)

  const header = `
<tr><td bgcolor="${p.night}" style="background:${p.night};border-radius:20px 20px 0 0">
  <table ${TABLE} width="100%">
    <tr><td class="em-px" style="padding:26px 40px 0">
      <table ${TABLE} width="100%"><tr>
        <td valign="middle">${brandmark(ctx, 22)}</td>
        <td valign="middle" align="right" style="font-family:${f.body};font-size:12px;line-height:16px;font-weight:500;color:${p.onNightFaint}">${chip.html}</td>
      </tr></table>
    </td></tr>
    <tr><td class="em-px" style="padding:44px 40px 0">
      ${eyebrow.text ? pill(ctx, eyebrow) : ""}
      <h1 class="em-h1" style="margin:${eyebrow.text ? 18 : 0}px 0 0;font-family:${f.head};font-size:34px;line-height:39px;font-weight:800;letter-spacing:-0.02em;color:${p.onNight}">${title.html}</h1>
      ${intro.text ? para(intro.html, `margin-top:14px;font-family:${f.body};font-size:16px;line-height:25px;color:${p.onNightSub}`) : ""}
    </td></tr>
    ${band && band.html ? `<tr><td class="em-px" style="padding:30px 40px 0">${band.html}</td></tr>` : ""}
    <tr><td style="padding:0 0 38px;font-size:0;line-height:0">&nbsp;</td></tr>
  </table>
</td></tr>`

  const store = ctx.brand.storeUrl
  const account = ctx.brand.accountUrl
  const footerLinks = [
    store ? `<a href="${esc(store)}" class="em-sub" style="font-family:${f.body};font-size:13px;line-height:20px;font-weight:600;color:${p.light.sub};text-decoration:none;padding:0 9px">${esc(ctx.copy.linkStore)}</a>` : "",
    account && account !== store ? `<a href="${esc(account)}" class="em-sub" style="font-family:${f.body};font-size:13px;line-height:20px;font-weight:600;color:${p.light.sub};text-decoration:none;padding:0 9px">${esc(ctx.copy.linkAccount)}</a>` : "",
  ]
    .filter(Boolean)
    .join("")
  const faint = lightText(ctx, 13, 20, 400, "faint")
  const tiny = lightText(ctx, 11.5, 18, 400, "faint")

  const html = `<!DOCTYPE html>
<html lang="${ctx.locale}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<!--[if mso]><style>*{font-family:Arial,sans-serif!important}</style><![endif]-->
<style>
${css(ctx)}
</style>
</head>
<body class="em-page" style="margin:0;padding:0;background:${p.light.page}">
${preheader ? preheaderHtml(preheader) : ""}
<table ${TABLE} width="100%" class="em-page" bgcolor="${p.light.page}" style="background:${p.light.page}">
<tr><td align="center" class="em-outer" style="padding:32px 12px 40px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table ${TABLE} width="100%" style="max-width:600px;margin:0 auto">
  <tr><td>
    <table ${TABLE} width="100%" class="em-card" bgcolor="${p.light.card}" style="background:${p.light.card};border-radius:20px;border-collapse:separate">
      ${header}
      ${rows.join("\n")}
    </table>
  </td></tr>
  <tr><td align="center" style="padding:30px 24px 0">
    <table ${TABLE} align="center" style="margin:0 auto"><tr>
      <td bgcolor="${p.night}" style="background:${p.night};border-radius:999px;padding:9px 18px">${brandmark(ctx, 16)}</td>
    </tr></table>
    ${ctx.brand.footer ? para(esc(ctx.brand.footer), `margin-top:12px;${faint.style}`, faint.cls) : ""}
    ${footerLinks ? `<p style="margin:14px 0 0">${footerLinks}</p>` : ""}
    ${para(esc(ctx.copy.footerNotice(ctx.brand.name)), `margin-top:16px;${tiny.style}`, tiny.cls)}
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`

  const text = [
    logoText(ctx),
    "",
    eyebrow.text,
    title.text,
    intro.text ? `\n${intro.text}` : "",
    band?.text ? `\n${band.text}` : "",
    ...bodyParts.filter((o) => o.text.trim()).map((o) => `\n${o.text}`),
    help ? `\n${help.text}` : "",
    "",
    [ctx.brand.name, store].filter(Boolean).join(", "),
    ctx.brand.footer ?? "",
    ctx.copy.footerNotice(ctx.brand.name),
  ]
    .join("\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return { subject, preheader, html, text: `${text}\n` }
}
