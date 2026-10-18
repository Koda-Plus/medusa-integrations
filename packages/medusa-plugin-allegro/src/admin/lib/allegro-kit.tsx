// GENERATED from kit/admin/kit.tsx (kit 1.1.0) by scripts/kit.mjs. Do not edit here: change the kit and run `npm run kit:sync`.
import { useLayoutEffect, useMemo, useSyncExternalStore, type ComponentType, type ReactNode } from "react"
import { Container, clx } from "@medusajs/ui"
import type { HostZone } from "../../modules/allegro/lib/kit-contract"

/**
 * The admin half of the kit, the same in every Koda Plus plugin:
 *
 * - kitFetch: the admin API from a plugin page or card, on the backend the
 *   dashboard talks to (`__BACKEND_URL__`), with the dashboard's own auth
 *   (session cookie, or the JWT when the admin was built with
 *   `__AUTH_TYPE__ = "jwt"`), and the header that the server's writeGuard
 *   asks writes for.
 * - The integration registry: every card registers itself with `hostable`,
 *   and an app that shows all plugins in one place (a host) claims the zones
 *   it takes over. Until a host claims a zone, Medusa shows the card in its
 *   own spot as always. One registry per page, shared by every plugin bundle
 *   through a global symbol.
 * - WidgetFrame: the card's own frame, or none when a host embeds the card
 *   in its tab.
 * - Page tabs: plugins of one family share one sidebar entry, each page a
 *   tab of the host plugin's page (hostPageTabs, addPageTab, hostedNavIcon).
 */

/* ------------------------------------------------------------------ */
/* Admin API                                                           */
/* ------------------------------------------------------------------ */

declare const __BACKEND_URL__: string | undefined
declare const __AUTH_TYPE__: string | undefined
declare const __JWT_TOKEN_STORAGE_KEY__: string | undefined

/** Same origin by default; the admin build defines `__BACKEND_URL__` when the backend lives elsewhere. */
export function backendUrl(): string {
  try {
    if (typeof __BACKEND_URL__ !== "undefined" && __BACKEND_URL__ && __BACKEND_URL__ !== "/") return String(__BACKEND_URL__).replace(/\/+$/, "")
  } catch {
    /* not defined in this build */
  }
  return ""
}

/** The dashboard's auth for a request: the session cookie, or the bearer token in JWT mode. */
export function authHeaders(): Record<string, string> {
  let type = "session"
  try {
    if (typeof __AUTH_TYPE__ !== "undefined" && __AUTH_TYPE__) type = String(__AUTH_TYPE__)
  } catch {
    /* session */
  }
  if (type !== "jwt") return {}
  let key = "medusa_auth_token"
  try {
    if (typeof __JWT_TOKEN_STORAGE_KEY__ !== "undefined" && __JWT_TOKEN_STORAGE_KEY__) key = String(__JWT_TOKEN_STORAGE_KEY__)
  } catch {
    /* default key of @medusajs/js-sdk */
  }
  let token: string | null = null
  try {
    token = window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key)
  } catch {
    token = null
  }
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export class KitRequestError extends Error {
  readonly status: number
  readonly code: string | null
  readonly body: unknown
  constructor(status: number, message: string, code: string | null, body: unknown) {
    super(message)
    this.name = "KitRequestError"
    this.status = status
    this.code = code
    this.body = body
  }
}

export type KitInit = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
}

/** The request options a plugin's own fetch helper spreads in: base URL aside, auth and the write header. */
export function kitRequestInit(init: KitInit = {}): RequestInit {
  const method = init.method ?? "GET"
  const write = method !== "GET"
  const hasBody = init.body !== undefined
  return {
    method,
    credentials: "include",
    signal: init.signal,
    headers: {
      Accept: "application/json",
      ...(write ? { "Content-Type": "application/json", "x-koda-request": "1" } : {}),
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
    body: write ? JSON.stringify(hasBody ? init.body : {}) : undefined,
  }
}

/** GET or a write against the admin API; throws KitRequestError with the server's code and message. */
export async function kitFetch<T>(path: string, init: KitInit = {}): Promise<T> {
  const res = await fetch(`${backendUrl()}${path}`, kitRequestInit(init))
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const body = (json && typeof json === "object" ? json : {}) as { message?: unknown; code?: unknown }
    throw new KitRequestError(res.status, typeof body.message === "string" ? body.message : `HTTP ${res.status}`, typeof body.code === "string" ? body.code : null, json)
  }
  return json as T
}

/* ------------------------------------------------------------------ */
/* Integration registry                                                */
/* ------------------------------------------------------------------ */

export type IconComponent = ComponentType<{ width?: number; height?: number; className?: string }>

export interface IntegrationWidget {
  /** "stripe.order" */
  id: string
  ns: string
  zone: HostZone
  /** The brand, never translated: "Stripe". */
  name: string
  /** Tab order in a host, low first. */
  order: number
  Icon: IconComponent
  /** The card; `embedded` drops its own frame and header inside a host tab. */
  Component: ComponentType<{ data: any; embedded?: boolean }>
  /** A host hides the tab while the record's summary says "none" (InPost on an order not shipped with InPost). */
  hideWhenNone?: boolean
}

export interface IntegrationEntry {
  ns: string
  name: string
  /** Dashboard route of the plugin page, e.g. "/inpost". */
  adminPath: string
  Icon: IconComponent
}

export interface IntegrationRegistry {
  readonly version: 1
  announce(entry: IntegrationEntry): void
  register(widget: IntegrationWidget): void
  claim(zones: HostZone[], host: string): void
  isHosted(zone: HostZone): boolean
  widgets(zone?: HostZone): IntegrationWidget[]
  integrations(): IntegrationEntry[]
  subscribe(listener: () => void): () => void
  /** Changes on every announce, register and claim, for useSyncExternalStore. */
  revision(): number
}

export const REGISTRY_KEY = Symbol.for("koda.integration.registry/1")

function createRegistry(): IntegrationRegistry {
  const entries = new Map<string, IntegrationEntry>()
  const widgets = new Map<string, IntegrationWidget>()
  const claimed = new Map<HostZone, string>()
  const listeners = new Set<() => void>()
  let rev = 0
  const changed = () => {
    rev += 1
    for (const l of [...listeners]) {
      try {
        l()
      } catch {
        /* a listener never breaks the others */
      }
    }
  }
  return {
    version: 1,
    announce(entry) {
      entries.set(entry.ns, entry)
      changed()
    },
    register(widget) {
      widgets.set(widget.id, widget)
      if (!entries.has(widget.ns)) entries.set(widget.ns, { ns: widget.ns, name: widget.name, adminPath: `/${widget.ns}`, Icon: widget.Icon })
      changed()
    },
    claim(zones, host) {
      for (const z of zones) claimed.set(z, host)
      changed()
    },
    isHosted: (zone) => claimed.has(zone),
    widgets: (zone) => [...widgets.values()].filter((w) => !zone || w.zone === zone).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    integrations: () => [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    revision: () => rev,
  }
}

/** The page's registry, created by whichever bundle comes first. */
export function registry(): IntegrationRegistry {
  const g = globalThis as unknown as Record<symbol, IntegrationRegistry | undefined>
  const existing = g[REGISTRY_KEY]
  if (existing && existing.version === 1) return existing
  const created = createRegistry()
  g[REGISTRY_KEY] = created
  return created
}

/** Re-renders when the registry changes; returns its revision. */
export function useRegistryRevision(): number {
  const r = registry()
  return useSyncExternalStore(r.subscribe, r.revision, r.revision)
}

/** True when a host has taken this zone over. */
export function useZoneHosted(zone: HostZone): boolean {
  useRegistryRevision()
  return registry().isHosted(zone)
}

/**
 * A card that a host can take over. The widget file keeps its
 * `defineWidgetConfig({ zone })`; its default export becomes
 * `hostable({ id, ns, zone, name, order, Icon }, Card)`. Registration
 * happens when Medusa imports the widget, at dashboard start.
 */
export function hostable<P extends { data: any }>(
  meta: Omit<IntegrationWidget, "Component">,
  Card: ComponentType<P & { embedded?: boolean }>,
): ComponentType<P> {
  registry().register({ ...meta, Component: Card as unknown as IntegrationWidget["Component"] })
  const Hosted = (props: P) => {
    const hosted = useZoneHosted(meta.zone)
    if (hosted) return null
    return <Card {...props} />
  }
  Hosted.displayName = `Hostable(${meta.id})`
  return Hosted
}

/* ------------------------------------------------------------------ */
/* Host slots: sections the store adds to a plugin page                 */
/* ------------------------------------------------------------------ */

/*
 * A plugin page marks places with <KitHostSlot id="stripe.panel.after" />;
 * the store adds its own sections there with addToSlot(...) from any admin
 * file Medusa loads (a widget file runs at dashboard start). The plugin knows
 * nothing about the store: an empty slot renders nothing.
 */
export const SLOTS_KEY = Symbol.for("koda.page.slots/1")

type SlotEntry = { id: string; slot: string; order: number; Component: ComponentType }
interface SlotRegistry {
  readonly version: 1
  add(e: SlotEntry): void
  list(slot: string): SlotEntry[]
  subscribe(listener: () => void): () => void
  revision(): number
}

function slots(): SlotRegistry {
  const g = globalThis as unknown as Record<symbol, SlotRegistry | undefined>
  const existing = g[SLOTS_KEY]
  if (existing && existing.version === 1) return existing
  const entries = new Map<string, SlotEntry>()
  const listeners = new Set<() => void>()
  let rev = 0
  const created: SlotRegistry = {
    version: 1,
    add(e) {
      entries.set(e.id, e)
      rev += 1
      for (const l of [...listeners]) {
        try {
          l()
        } catch {
          /* a listener never breaks the others */
        }
      }
    },
    list: (slot) => [...entries.values()].filter((e) => e.slot === slot).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    revision: () => rev,
  }
  g[SLOTS_KEY] = created
  return created
}

/** Adds a store section to a plugin page slot (same id again replaces it). */
export function addToSlot(slot: string, id: string, Component: ComponentType, order = 100): void {
  slots().add({ id, slot, order, Component })
}

/** The place in a plugin page where the store's sections go. */
export function KitHostSlot({ id }: { id: string }) {
  const r = slots()
  useSyncExternalStore(r.subscribe, r.revision, r.revision)
  const list = r.list(id)
  if (!list.length) return null
  return (
    <>
      {list.map((e) => (
        <e.Component key={e.id} />
      ))}
    </>
  )
}

/** A plugin page without cards says it is installed, so a host can list it. */
export function announce(entry: IntegrationEntry): void {
  registry().announce(entry)
}

/* ------------------------------------------------------------------ */
/* Page tabs: one menu entry for a family of plugins                   */
/* ------------------------------------------------------------------ */

/*
 * Plugins of one family (InPost: shipping, InPost Pay, Von Halsky) can share
 * one sidebar entry while each stays its own package. The host plugin calls
 * hostPageTabs(...) at module load of its page file and draws its page
 * inside <KitTabbedPage> (the page kit); every other plugin of the family
 * calls addPageTab(...) at module load of its own page file, with its own
 * page component. Medusa imports every route file when the dashboard starts,
 * so both calls have run before the first render. The two sides meet only
 * in this registry (a global symbol, the same in every bundle); no package
 * imports another:
 *
 * - the host alone: its page as always, no tab bar;
 * - a contributor alone: its own sidebar entry and page as always;
 * - both: one sidebar entry, the contributor's page is a tab of the host
 *   page (`?service=<tab>`), the contributor's own address redirects there
 *   (<KitTabRoute>) and its own sidebar entry steps aside (hostedNavIcon).
 *
 * Why the entry is hidden at runtime: Medusa builds the sidebar from the
 * route `config` it reads from the source when the admin is built, so an
 * entry cannot be made conditional. The only part of an entry a plugin draws
 * at runtime is its icon: hostedNavIcon draws the mark when no host is there
 * and a hidden marker when one is, and one CSS rule (added to the page only
 * then) hides the sidebar link that holds a marker. Where the rule does not
 * apply (a browser without :has(), a changed sidebar), the entry just stays
 * and leads to the tab.
 */
export const PAGE_TABS_KEY = Symbol.for("koda.page.tabs/1")

/** The query parameter of the tab on a host page; `view`, `tab`, `section`, `filter` and `q` stay the pages' own. */
export const PAGE_TAB_PARAM = "service"

export interface PageTabHost {
  /** "inpost" */
  id: string
  /** Dashboard route of the host page, e.g. "/inpost". */
  path: string
  /** The brand, never translated: "InPost". */
  name: string
}

export interface PageTab {
  /** The host page this tab goes to: "inpost". */
  host: string
  /** The tab in the URL, `?service=<id>`: "pay". Lowercase letters, digits and dashes. */
  id: string
  ns: string
  /** The tab label, a brand, never translated: "InPost Pay". */
  name: string
  /** Tab order on the host page, low first (the host's own tab is always first). */
  order: number
  Icon: IconComponent
  /** The plugin's whole page, drawn by the plugin's own code. */
  Component: ComponentType
}

interface PageTabRegistry {
  readonly version: 1
  host(h: PageTabHost): void
  add(t: PageTab): void
  hostOf(id: string): PageTabHost | null
  tabs(host: string): PageTab[]
  subscribe(listener: () => void): () => void
  revision(): number
}

const TAB_ID = /^[a-z0-9][a-z0-9-]{0,39}$/

function pageTabs(): PageTabRegistry {
  const g = globalThis as unknown as Record<symbol, PageTabRegistry | undefined>
  const existing = g[PAGE_TABS_KEY]
  if (existing && existing.version === 1) return existing
  const hosts = new Map<string, PageTabHost>()
  const tabs = new Map<string, PageTab>()
  const listeners = new Set<() => void>()
  let rev = 0
  const changed = () => {
    rev += 1
    for (const l of [...listeners]) {
      try {
        l()
      } catch {
        /* a listener never breaks the others */
      }
    }
  }
  const created: PageTabRegistry = {
    version: 1,
    host(h) {
      hosts.set(h.id, h)
      changed()
    },
    add(t) {
      if (!TAB_ID.test(t.id)) return
      tabs.set(`${t.host}:${t.id}`, t)
      changed()
    },
    hostOf: (id) => hosts.get(id) ?? null,
    tabs: (host) => [...tabs.values()].filter((t) => t.host === host).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    revision: () => rev,
  }
  g[PAGE_TABS_KEY] = created
  return created
}

/** The host plugin: its page takes the tabs of its family. Call at module load of the page file. */
export function hostPageTabs(host: PageTabHost): void {
  pageTabs().host(host)
}

/** A plugin of the family: its page becomes a tab of the host page, when the host is installed. Call at module load of the page file. */
export function addPageTab(tab: PageTab): void {
  pageTabs().add(tab)
}

function usePageTabsRevision(): number {
  const r = pageTabs()
  return useSyncExternalStore(r.subscribe, r.revision, r.revision)
}

/** The tabs other plugins gave this host page, in their order. */
export function usePageTabs(host: string): PageTab[] {
  const rev = usePageTabsRevision()
  return useMemo(() => pageTabs().tabs(host), [host, rev])
}

/** The host page that shows this tab, or null when the host plugin is not installed (the plugin then stands alone). */
export function usePageTabHost(host: string, tab: string): PageTabHost | null {
  usePageTabsRevision()
  const r = pageTabs()
  const h = r.hostOf(host)
  return h && r.tabs(host).some((t) => t.id === tab) ? h : null
}

const NAV_HIDE_STYLE = "koda-page-tabs-nav"
/* The link that holds a marker, and Medusa's wrapper around exactly that one link (so no gap is left). */
const NAV_HIDE_CSS = "a:has([data-koda-nav-hosted]){display:none!important}div:has(>div:only-child>a:only-child [data-koda-nav-hosted]){display:none!important}"

function ensureNavHideStyle(): void {
  if (typeof document === "undefined" || document.getElementById(NAV_HIDE_STYLE)) return
  const style = document.createElement("style")
  style.id = NAV_HIDE_STYLE
  style.textContent = NAV_HIDE_CSS
  document.head.appendChild(style)
}

/**
 * The icon of a contributor's own sidebar entry, for `defineRouteConfig({ icon })`:
 * the plugin's mark when it stands alone, a hidden marker (and so no sidebar
 * entry) while a host page shows it as a tab.
 */
export function hostedNavIcon(Icon: IconComponent, at: { host: string; tab: string }): IconComponent {
  const NavIcon = (props: { width?: number; height?: number; className?: string }) => {
    const hosted = usePageTabHost(at.host, at.tab) !== null
    useLayoutEffect(() => {
      if (hosted) ensureNavHideStyle()
    }, [hosted])
    if (hosted) return <span data-koda-nav-hosted={`${at.host}:${at.tab}`} hidden />
    return <Icon {...props} />
  }
  NavIcon.displayName = `HostedNavIcon(${at.host}:${at.tab})`
  return NavIcon
}

/* ------------------------------------------------------------------ */
/* The card frame                                                      */
/* ------------------------------------------------------------------ */

/**
 * The frame of a plugin card. On its own it is Medusa's card with the
 * header; inside a host tab (`embedded`) it is only the content, because the
 * host already draws the card, the brand and the tabs.
 */
export function WidgetFrame({ embedded, header, children, className }: { embedded?: boolean; header?: ReactNode; children: ReactNode; className?: string }) {
  if (embedded) return <div className={clx("divide-y divide-ui-border-base", className)}>{children}</div>
  return (
    <Container className={clx("divide-y p-0", className)}>
      {header}
      {children}
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

/*
 * What a page shows while it reads, the same in every plugin: never an empty
 * table that says "nothing here" before the data came. The labels come from
 * the plugin (its own language); the kit only draws.
 */

/** A section that is still reading: a spinner and what it reads, in the space the content will take. */
export function KitLoading({ label, className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={clx("flex min-h-[8rem] flex-col items-center justify-center gap-y-2 px-6 py-8", className)}>
      <span className="size-5 animate-spin rounded-full border-2 border-ui-border-base border-t-ui-fg-interactive" />
      {label ? <span className="txt-compact-small text-ui-fg-subtle">{label}</span> : null}
    </div>
  )
}

/** Placeholder rows of a table body while its first page reads (the header stays). */
export function KitSkeletonRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden className="border-b border-ui-border-base last:border-b-0">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-6 py-3.5">
              <span className="block h-3 animate-pulse rounded bg-ui-bg-component" style={{ width: `${45 + ((r * 7 + c * 13) % 45)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

/** A thin bar on top of a section that is reading again with its old data still shown. */
export function KitFetchingBar({ active }: { active: boolean }) {
  return (
    <div aria-hidden className={clx("relative h-0.5 overflow-hidden", active ? "opacity-100" : "opacity-0")}>
      <span className="absolute inset-y-0 left-0 w-1/3 animate-[kit-fetching_1.1s_ease-in-out_infinite] bg-ui-fg-interactive" />
      <style>{`@keyframes kit-fetching{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
    </div>
  )
}
