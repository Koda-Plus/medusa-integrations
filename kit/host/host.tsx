import { createElement, useMemo, type ReactNode } from "react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  TONE_OF,
  TONE_RANK,
  safeLink,
  stateOf,
  type AttentionCounter,
  type AttentionResponse,
  type AttentionScope,
  type EntityKind,
  type EntitySummary,
  type Fact,
  type FactSlot,
  type HostZone,
  type IntegrationManifest,
  type Link,
  type Message,
  type Tone,
} from "./koda-contract"
import { KitRequestError, kitFetch, registry, useRegistryRevision, type IconComponent, type IntegrationEntry, type IntegrationWidget } from "./koda-registry"

/**
 * The host side of koda.integration/1, for an app that shows every Koda Plus
 * plugin in one place (medusa.koda.plus, a client's admin): the plugin cards
 * as tabs of one card, their one-line state, the facts of an overview card
 * and the counters of a board. The app knows nothing about any plugin: the
 * cards come from the registry, everything else from the contract routes.
 *
 * GENERATED into the app by scripts/vendor-into-app.mjs from kit/host/host.tsx.
 */

export type { IntegrationWidget, IntegrationEntry }

/** Takes these zones over: plugin cards there render only inside the host. Call at module load. */
export function claimZones(zones: HostZone[], host = "koda"): void {
  registry().claim(zones, host)
}

/** The plugin cards registered for a zone, re-read when a plugin bundle registers late. */
export function useZoneWidgets(zone: HostZone): IntegrationWidget[] {
  const rev = useRegistryRevision()
  return useMemo(() => registry().widgets(zone), [zone, rev])
}

/** Every plugin present on the page, with or without cards. */
export function useIntegrationEntries(): IntegrationEntry[] {
  const rev = useRegistryRevision()
  return useMemo(() => registry().integrations(), [rev])
}

/* ------------------------------------------------------------------ */
/* Reading the contract                                                */
/* ------------------------------------------------------------------ */

/* Keys start with the plugin namespace, so a plugin that invalidates its own ["<ns>"] refreshes the host too. */
export const hostKeys = {
  manifest: (ns: string) => [ns, "koda-integration", "manifest"] as const,
  summary: (ns: string, entity: EntityKind, id: string) => [ns, "koda-integration", "summary", entity, id] as const,
  attention: (ns: string, scope: string) => [ns, "koda-integration", "attention", scope] as const,
}

const notFound = (err: unknown) => err instanceof KitRequestError && (err.status === 404 || err.status === 400)

export function useManifest(ns: string) {
  return useQuery<IntegrationManifest | null>({
    queryKey: hostKeys.manifest(ns),
    queryFn: () => kitFetch<IntegrationManifest>(`/admin/${encodeURIComponent(ns)}/integration`).catch((err) => (notFound(err) ? null : Promise.reject(err))),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

export type SummaryRead = { ns: string; loading: boolean; failed: boolean; summary: EntitySummary | null }

/** The summaries of one record from the given plugins, each cached on its own. */
export function useSummaries(entity: EntityKind, id: string | null | undefined, namespaces: string[]): SummaryRead[] {
  const results = useQueries({
    queries: namespaces.map((ns) => ({
      queryKey: hostKeys.summary(ns, entity, id ?? ""),
      queryFn: () =>
        kitFetch<EntitySummary>(`/admin/${encodeURIComponent(ns)}/integration/summary?entity=${entity}&id=${encodeURIComponent(id ?? "")}`).catch((err) =>
          notFound(err) ? null : Promise.reject(err),
        ),
      enabled: Boolean(id),
      staleTime: 30_000,
      retry: 1,
    })),
  })
  return namespaces.map((ns, i) => ({
    ns,
    loading: results[i]?.isLoading ?? true,
    failed: Boolean(results[i]?.isError),
    summary: (results[i]?.data as EntitySummary | null | undefined) ?? null,
  }))
}

/** A message in the reader's language: the plugin dictionary when the app has it, the server's sentence otherwise. */
export function useMessageText(): (ns: string, message: Message | null | undefined) => string {
  const { t } = useTranslation()
  return (ns, message) => {
    if (!message) return ""
    return String(t(`${ns}:${message.key}`, { ...(message.params ?? {}), defaultValue: message.fallback }))
  }
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export interface HostedTab {
  key: string
  ns: string
  name: string
  Icon: IconComponent
  /** null while the summary loads. */
  tone: Tone | null
  text: string | null
  detail: string | null
  summary: EntitySummary | null
  render: () => ReactNode
}

/**
 * The plugin cards of a zone as tabs, each with its one-line state from the
 * plugin's own summary. A card that hides when there is nothing
 * (`hideWhenNone`) shows up only once its summary says otherwise.
 */
export function useHostedTabs(zone: HostZone, entity: EntityKind, record: { id: string } | null | undefined): HostedTab[] {
  const widgets = useZoneWidgets(zone)
  const namespaces = useMemo(() => [...new Set(widgets.map((w) => w.ns))], [widgets])
  const reads = useSummaries(entity, record?.id, namespaces)
  const text = useMessageText()
  const { t } = useTranslation()
  if (!record) return []
  const tabs: HostedTab[] = []
  for (const w of widgets) {
    const r = reads.find((x) => x.ns === w.ns)
    const s = r?.summary ?? null
    const state = s ? stateOf(s.state) : null
    if (w.hideWhenNone && (!r || r.loading || state === "none" || (!s && !r.failed))) continue
    const tone: Tone | null = r?.loading ? null : r?.failed || !s ? "grey" : TONE_OF[state ?? "unavailable"]
    tabs.push({
      key: w.id,
      ns: w.ns,
      name: w.name,
      Icon: w.Icon,
      tone,
      text: r?.loading ? null : s ? text(w.ns, s.title) : String(t("koda:int.unavailable", { defaultValue: "Could not check" })),
      detail: s?.detail ? text(w.ns, s.detail) : null,
      summary: s,
      render: () => createElement(w.Component, { data: record, embedded: true }),
    })
  }
  return tabs
}

/** The tab that needs a person first: red, then orange, then blue; the first tab when all is calm. */
export function urgentTab(tabs: HostedTab[]): HostedTab | null {
  return [...tabs].sort((a, b) => TONE_RANK[a.tone ?? "grey"] - TONE_RANK[b.tone ?? "grey"])[0] ?? null
}

/* ------------------------------------------------------------------ */
/* Facts                                                               */
/* ------------------------------------------------------------------ */

export interface HostedFact {
  ns: string
  name: string
  fact: Fact
  value: string
  sub: string | null
  link: Link | null
}

/**
 * Per slot, the fact with the highest priority among the plugins that know
 * the record (ties go to the plugin listed first). Links are checked again
 * here: admin paths only, or https on the hosts the app allows.
 */
export function useFacts(entity: EntityKind, record: { id: string } | null | undefined, zone: HostZone, externalHosts: readonly string[] = []): Partial<Record<FactSlot, HostedFact>> {
  const widgets = useZoneWidgets(zone)
  const namespaces = useMemo(() => [...new Set(widgets.map((w) => w.ns))], [widgets])
  const reads = useSummaries(entity, record?.id, namespaces)
  const text = useMessageText()
  const out: Partial<Record<FactSlot, HostedFact>> = {}
  for (const r of reads) {
    const s = r.summary
    if (!s) continue
    const name = widgets.find((w) => w.ns === r.ns)?.name ?? r.ns
    for (const f of s.facts ?? []) {
      const current = out[f.slot]
      if (current && current.fact.priority >= f.priority) continue
      out[f.slot] = { ns: r.ns, name, fact: f, value: text(r.ns, f.value), sub: f.sub ? text(r.ns, f.sub) : null, link: safeLink(f.link, externalHosts) }
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Board counters                                                      */
/* ------------------------------------------------------------------ */

export interface HostedCounter {
  ns: string
  name: string
  Icon: IconComponent
  counter: AttentionCounter
  label: string
  link: Link | null
}

/** What waits for a person, from every plugin on the page that counts this scope; zeros left out. */
export function useAttention(scope: AttentionScope): { loading: boolean; items: HostedCounter[] } {
  const entries = useIntegrationEntries()
  const text = useMessageText()
  const results = useQueries({
    queries: entries.map((e) => ({
      queryKey: hostKeys.attention(e.ns, scope),
      queryFn: () =>
        kitFetch<AttentionResponse>(`/admin/${encodeURIComponent(e.ns)}/integration/attention?scope=${scope}`).catch((err) => (notFound(err) ? null : Promise.reject(err))),
      staleTime: 60_000,
      retry: 1,
    })),
  })
  const items: HostedCounter[] = []
  entries.forEach((e, i) => {
    const data = results[i]?.data as AttentionResponse | null | undefined
    for (const c of data?.items ?? []) {
      if (c.scope !== scope || c.count <= 0) continue
      items.push({ ns: e.ns, name: e.name, Icon: e.Icon, counter: c, label: text(e.ns, c.label), link: safeLink(c.link) })
    }
  })
  items.sort((a, b) => TONE_RANK[a.counter.tone] - TONE_RANK[b.counter.tone] || a.name.localeCompare(b.name))
  return { loading: results.some((r) => r.isLoading), items }
}
