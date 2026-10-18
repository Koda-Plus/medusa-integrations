import type { EntitySummary, IntegrationManifest, Message } from "./kit-contract"
import { KODA_CONTRACT } from "./kit-contract"
import { KIT_META } from "./kit-meta"
import { integrationEn, integrationPl } from "./integration-texts"
import { isActive, type ResolvedKitOptions } from "./options"
import type { KitSettings } from "./store"

/**
 * The koda.integration/1 answers of the Kit plugin: the manifest every host
 * reads once, the summary of a customer (the subscriber's state, looked up
 * by the customer's email), and the counters that wait for a person.
 */

function msg(key: string, params: Record<string, string | number> = {}): Message {
  return { key: `integration.${key}`, params, fallback: (integrationEn as any)[key] ?? key }
}

export function kitManifest(o: ResolvedKitOptions, settings: KitSettings): IntegrationManifest {
  const configured = isActive(o)
  return {
    contract: KODA_CONTRACT,
    contracts: [KODA_CONTRACT],
    ns: KIT_META.ns,
    package: KIT_META.pkg,
    version: KIT_META.version,
    kit: KIT_META.kit,
    name: KIT_META.name,
    kind: "integration",
    mode: o.demo ? "demo" : configured ? "live" : "off",
    configured,
    adminPath: `/${KIT_META.ns}`,
    entities: ["customer"],
    attention: ["customers"],
    widgets: [],
    lastSyncAt: null,
    problems: configured
      ? []
      : [msg("problems.apiKey")],
  }
}

export function kitSummary(args: {
  configured: boolean
  subscriber: { state: string; created_at: string } | null
  failed: boolean
}): EntitySummary {
  const state = args.subscriber?.state ?? null
  const stateText = state ?? "unknown"
  return {
    contract: KODA_CONTRACT,
    ns: KIT_META.ns,
    entity: "customer",
    id: "",
    state: !args.configured ? "off" : args.failed ? "unavailable" : args.subscriber ? (state === "active" ? "ok" : state === "inactive" ? "attention" : state === "cancelled" || state === "bounced" || state === "complained" ? "failed" : "none") : "none",
    tone: !args.configured || args.failed ? "grey" : args.subscriber ? (state === "active" ? "green" : state === "inactive" ? "orange" : "grey") : "grey",
    title: !args.configured
      ? msg("title.off")
      : args.failed
        ? msg("title.attention", { count: 0 })
        : args.subscriber
          ? state === "active"
            ? { key: "integration.subscriber.active", params: {}, fallback: "On the list (active)" }
            : state === "inactive"
              ? { key: "integration.subscriber.inactive", params: {}, fallback: "Waiting for the confirmation email" }
              : { key: "integration.subscriber.other", params: { state: stateText }, fallback: `Subscriber state: ${stateText}` }
          : msg("title.none"),
    detail: !args.configured ? msg("detail.ok") : undefined,
    facts: [],
    counts: {},
    links: [],
    widget: null,
    updatedAt: args.subscriber?.created_at ?? null,
    stale: false,
  }
}

/** The messages in the reader's language (used by tests and the routes). */
export function kitTexts(locale: string | null) {
  return locale === "pl" ? integrationPl : integrationEn
}
