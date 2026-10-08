// GENERATED from kit/admin/kit.tsx (kit 1.0.1) by scripts/kit.mjs. Do not edit here: change the kit and run `npm run kit:sync`.
import { useSyncExternalStore, type ComponentType, type ReactNode } from "react"
import { Container, clx } from "@medusajs/ui"
import type { HostZone } from "../../modules/packaging/lib/kit-contract"

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

/** A plugin page without cards says it is installed, so a host can list it. */
export function announce(entry: IntegrationEntry): void {
  registry().announce(entry)
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
