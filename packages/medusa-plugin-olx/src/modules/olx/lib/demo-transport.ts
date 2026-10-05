/**
 * THE SIMULATED OLX ACCOUNT THE DEMO WRITERS TALK TO. Same interfaces as the
 * live transport, no network: the apply loops cannot tell the difference, so
 * the demo exercises the very code a real account runs. Pure.
 *
 * It answers like the Partner API does: `deactivate` on an advert that is not
 * active is a 400 "Ad has to be active", an update returns the advert, a new
 * advert starts in moderation (`new`). The writes themselves are remembered by
 * the plan rows (state `done`) and replayed onto the simulated account by the
 * next demo read (`applyDemoWrites`).
 */

import { DEMO_CATEGORY_ID, DEMO_CITY_ID, demoSearchUrl, hash } from "./demo"
import { OlxApiError } from "./errors"
import type { AdvertSnapshot, FoundAdvert, LifecycleTransport, PriceTransport, PublishTransport } from "./apply"
import type { LifecycleCommand } from "./lifecycle"
import type { Money } from "./pricing"

export interface DemoAdvertState {
  olxId: string
  status: string
  price: Money | null
  externalId: string | null
  title: string
  url: string
}

function snapshot(a: DemoAdvertState): AdvertSnapshot {
  return {
    status: a.status,
    price: a.price,
    raw: {
      data: {
        id: Number(a.olxId),
        status: a.status,
        url: a.url,
        title: a.title,
        description: `Simulated advert of the OLX by Koda Plus demo.${a.externalId ? ` SKU: ${a.externalId}` : ""}`,
        category_id: DEMO_CATEGORY_ID,
        advertiser_type: "business",
        external_id: a.externalId,
        contact: { name: "Koda Supply (demo)" },
        location: { city_id: DEMO_CITY_ID },
        images: [],
        price: a.price ? { value: a.price.value, currency: a.price.currency, negotiable: false } : null,
        attributes: [{ code: "state", value: "new" }],
      },
    },
  }
}

function invalid(field: string, title: string): OlxApiError {
  return new OlxApiError(400, `OLX 400: Data validation error occurred: ${field}: ${title}`, false, { validation: [{ field, title }] })
}

export interface DemoTransport extends LifecycleTransport, PriceTransport, PublishTransport {
  /** Adverts as they are now in the simulation (for tests and the admin). */
  state(): DemoAdvertState[]
}

export function createDemoTransport(seed: readonly DemoAdvertState[], ctx: { market: string; host: string; now: () => Date }): DemoTransport {
  const adverts = new Map(seed.map((a) => [a.olxId, { ...a }]))

  return {
    async read(olxId) {
      const a = adverts.get(olxId)
      return a ? snapshot(a) : null
    },

    async command(olxId: string, command: LifecycleCommand) {
      const a = adverts.get(olxId)
      if (!a) throw new OlxApiError(404, "OLX 404: Advert not found", false)
      if (command === "deactivate") {
        if (a.status !== "active") throw invalid("ad", "Ad has to be active")
        a.status = "removed_by_user"
      } else if (command === "activate") {
        if (a.status === "active") throw invalid("ad", "Ad is already active")
        a.status = "active"
      } else {
        if (a.status !== "limited") throw invalid("ad", "Invalid status")
        a.status = "outdated"
      }
    },

    async put(olxId, body) {
      const a = adverts.get(olxId)
      if (!a) throw new OlxApiError(404, "OLX 404: Advert not found", false)
      const price = body.price as Record<string, unknown> | undefined
      const value = Number(price?.value)
      if (!price || !Number.isFinite(value)) throw invalid("price", "Invalid value")
      a.price = { value, currency: String(price.currency ?? a.price?.currency ?? "PLN").toUpperCase() }
      return snapshot(a)
    },

    async findByExternalId(externalId) {
      const key = externalId.trim().toUpperCase()
      const out: FoundAdvert[] = []
      for (const a of adverts.values()) {
        if (a.externalId && a.externalId.trim().toUpperCase() === key) {
          out.push({ olxId: a.olxId, url: a.url, status: a.status, externalId: a.externalId })
        }
      }
      return out
    },

    async create(payload) {
      const title = String(payload.title ?? "").trim()
      const externalId = String(payload.external_id ?? "").trim()
      if (title.length < 16) throw invalid("title", "Title is too short")
      let n = 1_900_000_000 + (hash(`${externalId}#published`) % 99_999_999)
      while (adverts.has(String(n))) n += 1
      const price = payload.price as Record<string, unknown> | undefined
      const advert: DemoAdvertState = {
        olxId: String(n),
        status: "new",
        price: price && Number.isFinite(Number(price.value)) ? { value: Number(price.value), currency: String(price.currency ?? "PLN") } : null,
        externalId: externalId || null,
        title,
        url: demoSearchUrl(ctx.market, ctx.host, title),
      }
      adverts.set(advert.olxId, advert)
      return { olxId: advert.olxId, url: advert.url, status: advert.status, externalId: advert.externalId }
    },

    state() {
      return [...adverts.values()].map((a) => ({ ...a }))
    },
  }
}
