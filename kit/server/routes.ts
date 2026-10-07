import { createHash } from "node:crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ATTENTION_SCOPES,
  ENTITY_KINDS,
  FACT_SLOTS,
  ID_PATTERN,
  KODA_CONTRACT,
  KODA_CONTRACT_HEADER,
  MAX_BATCH,
  TONE_OF,
  safeAdminPath,
  safeExternalUrl,
  stateOf,
  type AttentionCounter,
  type AttentionResponse,
  type AttentionScope,
  type EntityKind,
  type EntitySummary,
  type EntitySummaryBatch,
  type Fact,
  type FactSlot,
  type HostZone,
  type IntegrationManifest,
  type Link,
  type Message,
  type SummaryState,
  type Tone,
} from "./kit-contract"

export { STATE_TEXTS } from "./kit-contract"

/**
 * The three contract routes of a plugin, from one definition:
 *
 *   // src/modules/<ns>/lib/integration.ts
 *   export const integration = integrationRoutes({ ns: "inpost", ..., status, summarize, count })
 *   // src/api/admin/<ns>/integration/route.ts
 *   export const GET = integration.manifest
 *
 * The kit does the parts every plugin would otherwise do differently:
 * query validation, `lang` and `tz`, the tone of each state, the fallback
 * sentence of every message from the plugin's own texts, link checks, the
 * ETag and the contract header. The plugin only maps its rows to drafts.
 */

export type Lang = "en" | "pl"

/** A message as a plugin writes it: the kit adds the fallback sentence in `lang`. */
export interface MessageDraft {
  key: string
  params?: Record<string, string | number>
}

export interface LinkDraft {
  kind: "admin" | "external"
  href: string
  label?: MessageDraft
}

export interface FactDraft {
  slot: FactSlot
  priority: number
  value: MessageDraft
  sub?: MessageDraft
  tone?: Tone
  link?: LinkDraft
}

export interface SummaryDraft {
  state: SummaryState
  title: MessageDraft
  detail?: MessageDraft
  facts?: FactDraft[]
  counts?: Record<string, number>
  links?: LinkDraft[]
  widget?: string | null
  updatedAt?: string | Date | null
  stale?: boolean
}

export interface CounterDraft {
  key: string
  scope: AttentionScope
  count: number
  capped?: boolean
  tone: "red" | "orange" | "blue"
  /** Defaults to integration.attention.<key>, with params.count = count. */
  label?: MessageDraft
  link: LinkDraft
  entity?: EntityKind
  ids?: string[]
}

export interface StatusDraft {
  mode: IntegrationManifest["mode"]
  configured: boolean
  writers?: { armed: number; total: number }
  lastSyncAt?: string | Date | null
  problems?: MessageDraft[]
}

export interface IntegrationContext {
  /** The request container (req.scope). */
  scope: MedusaRequest["scope"]
  lang: Lang
  /** IANA time zone for day boundaries ("overdue today"). */
  tz: string
  actor: { id: string | null; type: string | null }
  /** Formats money in `lang` from major units, e.g. money(12.5, "pln"). */
  money: (amount: number, currency: string) => string
  /** Formats a date (and time when `withTime`) in `lang` and `tz`. */
  date: (value: string | Date, withTime?: boolean) => string
  req: MedusaRequest
}

/** Nested texts: `{ order: { paidFee: "Paid by {{method}}" } }`, the subtree under "integration". */
export type Texts = { [key: string]: string | Texts }

export interface IntegrationDefinition {
  ns: string
  package: string
  version: string
  /** The brand, never translated. */
  name: string
  kind: "integration" | "module"
  /** Dashboard route of the plugin page, e.g. "/inpost". */
  adminPath: string
  entities: EntityKind[]
  attention: AttentionScope[]
  widgets: Array<{ id: string; zone: HostZone }>
  /** The `integration` subtree of the admin dictionaries, plain (no typeset). */
  texts: { en: Texts; pl: Texts }
  /** Hosts an external link may point to (https only). */
  externalHosts?: string[]
  /** Default time zone when the request names none. */
  timeZone?: string
  status(ctx: IntegrationContext): Promise<StatusDraft>
  /** Drafts for the ids the plugin knows; a missing id reads as state "none". */
  summarize(ctx: IntegrationContext, entity: EntityKind, ids: string[]): Promise<Map<string, SummaryDraft> | Record<string, SummaryDraft>>
  count(ctx: IntegrationContext, scopes: AttentionScope[]): Promise<CounterDraft[]>
}

export interface IntegrationRoutes {
  manifest: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
  summary: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
  attention: (req: MedusaRequest, res: MedusaResponse) => Promise<void>
  /** The same answers without HTTP, for tests and for in-process hosts. */
  build: {
    manifest(ctx: IntegrationContext): Promise<IntegrationManifest>
    summaries(ctx: IntegrationContext, entity: EntityKind, ids: string[]): Promise<EntitySummary[]>
    attention(ctx: IntegrationContext, scopes: AttentionScope[]): Promise<AttentionResponse>
  }
  definition: IntegrationDefinition
}

/** Set by scripts/kit.mjs when the file is generated into a package. */
export const KIT_VERSION = "__KIT_VERSION__"

export class ContractError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ContractError"
    this.status = status
    this.code = code
  }
}

/* ------------------------------------------------------------------ */
/* Texts                                                               */
/* ------------------------------------------------------------------ */

const NBSP = " "

function lookup(texts: Texts, path: string): string | null {
  let node: string | Texts | undefined = texts
  for (const part of path.split(".")) {
    if (!node || typeof node === "string") return null
    node = node[part]
  }
  return typeof node === "string" ? node : null
}

function pluralKeys(lang: Lang, path: string, count: unknown): string[] {
  if (typeof count !== "number" || !Number.isFinite(count)) return [path]
  let form = "other"
  try {
    form = new Intl.PluralRules(lang === "pl" ? "pl-PL" : "en-GB").select(count)
  } catch {
    /* other */
  }
  return [`${path}_${form}`, `${path}_other`, path]
}

/** The sentence for a key in `lang`, English when Polish has none, the key itself as a last resort. */
export function textFor(texts: { en: Texts; pl: Texts }, lang: Lang, draft: MessageDraft): string {
  const path = draft.key.replace(/^integration\./, "")
  const params = draft.params ?? {}
  const keys = pluralKeys(lang, path, params.count)
  let template: string | null = null
  for (const dict of lang === "pl" ? [texts.pl, texts.en] : [texts.en]) {
    for (const k of keys) {
      template = lookup(dict, k)
      if (template !== null) break
    }
    if (template !== null) break
  }
  if (template === null) return draft.key
  return template
    .replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, name: string) => (params[name] === undefined ? "" : String(params[name])))
    .split(NBSP)
    .join(" ")
}

function message(def: IntegrationDefinition, lang: Lang, draft: MessageDraft): Message {
  if (!draft || typeof draft.key !== "string" || !draft.key.startsWith("integration.")) {
    throw new ContractError(500, "bad_message", `${def.ns}: message keys live under "integration.", got ${JSON.stringify(draft?.key)}`)
  }
  const params: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(draft.params ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) params[k] = v
    else if (typeof v === "string") params[k] = v.slice(0, 200)
  }
  return { key: draft.key, ...(Object.keys(params).length ? { params } : {}), fallback: textFor(def.texts, lang, { key: draft.key, params }) }
}

/* ------------------------------------------------------------------ */
/* Building the answers                                                */
/* ------------------------------------------------------------------ */

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function link(def: IntegrationDefinition, lang: Lang, draft: LinkDraft | undefined): Link | null {
  if (!draft) return null
  const href = draft.kind === "admin" ? safeAdminPath(draft.href) : draft.kind === "external" ? safeExternalUrl(draft.href, def.externalHosts ?? []) : null
  if (!href) return null
  return { kind: draft.kind, href, ...(draft.label ? { label: message(def, lang, draft.label) } : {}) }
}

function fact(def: IntegrationDefinition, lang: Lang, draft: FactDraft): Fact | null {
  if (!(FACT_SLOTS as readonly string[]).includes(draft.slot)) return null
  const out: Fact = { slot: draft.slot, priority: Math.max(0, Math.min(100, Math.round(draft.priority))), value: message(def, lang, draft.value) }
  if (draft.sub) out.sub = message(def, lang, draft.sub)
  if (draft.tone) out.tone = draft.tone
  const l = link(def, lang, draft.link)
  if (l) out.link = l
  return out
}

function noneSummary(def: IntegrationDefinition, lang: Lang, entity: EntityKind, id: string, state: SummaryState = "none"): EntitySummary {
  return {
    contract: KODA_CONTRACT,
    ns: def.ns,
    entity,
    id,
    state,
    tone: TONE_OF[state],
    title: message(def, lang, { key: `integration.state.${state}` }),
    facts: [],
    counts: {},
    links: [],
    widget: null,
    updatedAt: null,
    stale: false,
  }
}

function summaryOf(def: IntegrationDefinition, lang: Lang, entity: EntityKind, id: string, draft: SummaryDraft | undefined): EntitySummary {
  if (!draft) return noneSummary(def, lang, entity, id)
  const state = stateOf(draft.state)
  const counts: Record<string, number> = {}
  for (const [k, v] of Object.entries(draft.counts ?? {})) if (typeof v === "number" && Number.isFinite(v)) counts[k] = v
  const out: EntitySummary = {
    contract: KODA_CONTRACT,
    ns: def.ns,
    entity,
    id,
    state,
    tone: TONE_OF[state],
    title: message(def, lang, draft.title),
    facts: (draft.facts ?? []).map((f) => fact(def, lang, f)).filter((f): f is Fact => f !== null),
    counts,
    links: (draft.links ?? []).map((l) => link(def, lang, l)).filter((l): l is Link => l !== null),
    widget: draft.widget ?? null,
    updatedAt: iso(draft.updatedAt ?? null),
    stale: Boolean(draft.stale),
  }
  if (draft.detail) out.detail = message(def, lang, draft.detail)
  return out
}

function counterOf(def: IntegrationDefinition, lang: Lang, draft: CounterDraft): AttentionCounter | null {
  const count = Math.max(0, Math.floor(Number(draft.count) || 0))
  const href = link(def, lang, draft.link)
  if (!href) return null
  const label = draft.label ?? { key: `integration.attention.${draft.key}` }
  const out: AttentionCounter = {
    key: draft.key,
    scope: draft.scope,
    count,
    capped: Boolean(draft.capped),
    tone: draft.tone,
    label: message(def, lang, { key: label.key, params: { ...(label.params ?? {}), count } }),
    link: href,
  }
  if (draft.entity) out.entity = draft.entity
  if (draft.ids?.length) out.ids = draft.ids.filter((x) => ID_PATTERN.test(x)).slice(0, 20)
  return out
}

/* ------------------------------------------------------------------ */
/* Request parsing                                                     */
/* ------------------------------------------------------------------ */

function first(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === "string" ? v.trim() : ""
}

export function langOf(req: MedusaRequest): Lang {
  const q = first((req.query ?? {}).lang).toLowerCase()
  if (q === "pl" || q === "en") return q
  const header = String(req.headers?.["accept-language"] ?? "").toLowerCase()
  return header.startsWith("pl") ? "pl" : "en"
}

function tzOf(req: MedusaRequest, fallback: string | undefined): string {
  const q = first((req.query ?? {}).tz)
  for (const candidate of [q, fallback, "UTC"]) {
    if (!candidate) continue
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: candidate })
      return candidate
    } catch {
      /* next */
    }
  }
  return "UTC"
}

/** The context a plugin's mapping functions get, from a request. */
export function contextOf(def: IntegrationDefinition, req: MedusaRequest): IntegrationContext {
  const lang = langOf(req)
  const tz = tzOf(req, def.timeZone)
  const auth = (req as MedusaRequest & { auth_context?: { actor_id?: string | null; actor_type?: string | null } }).auth_context
  return makeContext({ scope: req.scope, req, lang, tz, actorId: auth?.actor_id ?? null, actorType: auth?.actor_type ?? null })
}

export function makeContext(input: {
  scope: MedusaRequest["scope"]
  req?: MedusaRequest
  lang?: Lang
  tz?: string
  actorId?: string | null
  actorType?: string | null
}): IntegrationContext {
  const lang = input.lang ?? "en"
  const tz = input.tz ?? "UTC"
  const locale = lang === "pl" ? "pl-PL" : "en-GB"
  return {
    scope: input.scope,
    req: input.req ?? ({ scope: input.scope, query: {}, headers: {} } as unknown as MedusaRequest),
    lang,
    tz,
    actor: { id: input.actorId ?? null, type: input.actorType ?? null },
    money: (amount, currency) => {
      try {
        return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(amount)
      } catch {
        return `${amount.toFixed(2)} ${currency.toUpperCase()}`
      }
    },
    date: (value, withTime = false) => {
      const d = value instanceof Date ? value : new Date(value)
      if (Number.isNaN(d.getTime())) return ""
      return new Intl.DateTimeFormat(locale, {
        timeZone: tz,
        day: "numeric",
        month: "short",
        ...(withTime ? { hour: "2-digit", minute: "2-digit" } : { year: "numeric" }),
      }).format(d)
    },
  }
}

function entityOf(def: IntegrationDefinition, req: MedusaRequest): EntityKind {
  const entity = first((req.query ?? {}).entity)
  if (!(ENTITY_KINDS as readonly string[]).includes(entity) || !def.entities.includes(entity as EntityKind)) {
    throw new ContractError(400, "unsupported_entity", `${def.ns} answers about: ${def.entities.join(", ") || "nothing"}`)
  }
  return entity as EntityKind
}

function idsOf(req: MedusaRequest): { ids: string[]; batch: boolean } {
  const q = req.query ?? {}
  const single = first(q.id)
  const many = first(q.ids)
  if (single && many) throw new ContractError(400, "invalid_ids", "Pass either id or ids, not both")
  const raw = single ? [single] : many ? many.split(",").map((s) => s.trim()).filter(Boolean) : []
  if (raw.length === 0) throw new ContractError(400, "invalid_ids", "id or ids is required")
  if (raw.length > MAX_BATCH) throw new ContractError(400, "invalid_ids", `At most ${MAX_BATCH} ids`)
  if (!raw.every((x) => ID_PATTERN.test(x))) throw new ContractError(400, "invalid_ids", "Ids are letters, digits and _ only, up to 64 characters")
  return { ids: raw, batch: !single }
}

function scopesOf(def: IntegrationDefinition, req: MedusaRequest): AttentionScope[] {
  const raw = first((req.query ?? {}).scope)
  if (!raw || raw === "all") return [...def.attention]
  const asked = raw.split(",").map((s) => s.trim()).filter(Boolean)
  if (!asked.every((s) => (ATTENTION_SCOPES as readonly string[]).includes(s))) {
    throw new ContractError(400, "invalid_scope", `scope is a list of: ${ATTENTION_SCOPES.join(", ")}, or all`)
  }
  return def.attention.filter((s) => asked.includes(s))
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function send(req: MedusaRequest, res: MedusaResponse, body: unknown): void {
  const json = JSON.stringify(body)
  const etag = `W/"${createHash("sha1").update(json).digest("base64url").slice(0, 27)}"`
  res.setHeader(KODA_CONTRACT_HEADER, "1")
  res.setHeader("Cache-Control", "private, no-cache")
  res.setHeader("Vary", "Accept-Language")
  res.setHeader("ETag", etag)
  const match = String(req.headers?.["if-none-match"] ?? "")
  if (match && match.split(",").map((s) => s.trim()).includes(etag)) {
    res.status(304).end()
    return
  }
  res.status(200).json(body)
}

function fail(def: IntegrationDefinition, req: MedusaRequest, res: MedusaResponse, err: unknown): void {
  res.setHeader(KODA_CONTRACT_HEADER, "1")
  if (err instanceof ContractError && err.status < 500) {
    res.status(err.status).json({ code: err.code, message: err.message })
    return
  }
  try {
    const logger = req.scope.resolve("logger") as { error: (m: string) => void }
    logger.error(`[${def.ns}] integration route failed: ${err instanceof Error ? err.message : String(err)}`)
  } catch {
    /* no logger in tests */
  }
  res.status(500).json({ code: "integration_failed", message: `${def.name}: the integration answer failed` })
}

/** The three routes and their builders for one plugin. */
export function integrationRoutes(def: IntegrationDefinition): IntegrationRoutes {
  const build: IntegrationRoutes["build"] = {
    async manifest(ctx) {
      const s = await def.status(ctx)
      return {
        contract: KODA_CONTRACT,
        contracts: [KODA_CONTRACT],
        ns: def.ns,
        package: def.package,
        version: def.version,
        kit: KIT_VERSION,
        name: def.name,
        kind: def.kind,
        mode: s.mode,
        configured: Boolean(s.configured),
        adminPath: safeAdminPath(def.adminPath) ?? "/",
        entities: [...def.entities],
        attention: [...def.attention],
        widgets: def.widgets.map((w) => ({ id: w.id, zone: w.zone })),
        ...(s.writers ? { writers: { armed: s.writers.armed, total: s.writers.total } } : {}),
        lastSyncAt: iso(s.lastSyncAt ?? null),
        problems: (s.problems ?? []).map((p) => message(def, ctx.lang, p)),
      }
    },
    async summaries(ctx, entity, ids) {
      if (!def.entities.includes(entity)) throw new ContractError(400, "unsupported_entity", `${def.ns} answers about: ${def.entities.join(", ")}`)
      let drafts: Map<string, SummaryDraft>
      try {
        const got = await def.summarize(ctx, entity, ids)
        drafts = got instanceof Map ? got : new Map(Object.entries(got))
      } catch (err) {
        try {
          const logger = ctx.scope.resolve("logger") as { warn: (m: string) => void }
          logger.warn(`[${def.ns}] summary of ${entity} failed: ${err instanceof Error ? err.message : String(err)}`)
        } catch {
          /* no logger in tests */
        }
        return ids.map((id) => noneSummary(def, ctx.lang, entity, id, "unavailable"))
      }
      return ids.map((id) => summaryOf(def, ctx.lang, entity, id, drafts.get(id)))
    },
    async attention(ctx, scopes) {
      const drafts = scopes.length ? await def.count(ctx, scopes) : []
      return {
        contract: KODA_CONTRACT,
        ns: def.ns,
        generatedAt: new Date().toISOString(),
        items: drafts
          .filter((d) => scopes.includes(d.scope))
          .map((d) => counterOf(def, ctx.lang, d))
          .filter((c): c is AttentionCounter => c !== null),
      }
    },
  }

  return {
    definition: def,
    build,
    async manifest(req, res) {
      try {
        send(req, res, await build.manifest(contextOf(def, req)))
      } catch (err) {
        fail(def, req, res, err)
      }
    },
    async summary(req, res) {
      try {
        const entity = entityOf(def, req)
        const { ids, batch } = idsOf(req)
        const items = await build.summaries(contextOf(def, req), entity, ids)
        if (batch) {
          const body: EntitySummaryBatch = { contract: KODA_CONTRACT, ns: def.ns, entity, items }
          send(req, res, body)
        } else {
          send(req, res, items[0])
        }
      } catch (err) {
        fail(def, req, res, err)
      }
    },
    async attention(req, res) {
      try {
        send(req, res, await build.attention(contextOf(def, req), scopesOf(def, req)))
      } catch (err) {
        fail(def, req, res, err)
      }
    },
  }
}
