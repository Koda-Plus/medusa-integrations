import type { MedusaContainer } from "@medusajs/framework/types"
import { checkRegistries, parseNumber, type CheckAnswer } from "../../modules/whitelist/lib/check"
import { toCheck, toEntity, whitelistSvc, type Row } from "../../modules/whitelist/lib/store"
import type { CheckDto, EntityDto } from "../../modules/whitelist/lib/contract"

/**
 * One check: the number goes to every registry its kind and the options
 * call for (a Polish NIP to GUS and the whitelist by default, an EU VAT
 * number to VIES), the counterparty row is created or refreshed with the
 * merged card and every registry answer is appended to the audit trail.
 * Used by the admin and the store routes.
 *
 * In demo mode a counterparty that is itself demo data (the seeded sample
 * customers) answers from the simulation even when registries are `live`,
 * so a re-check never turns a sample company into "not found".
 */
export async function runCheck(
  container: MedusaContainer,
  input: { value: string; requestedBy: string; customerId?: string | null; force?: boolean },
): Promise<{ entity: EntityDto; check: CheckDto; gus: CheckDto | null; checks: CheckDto[] }> {
  const svc = whitelistSvc(container)
  const options = svc.getOptions()
  const value = input.value.trim()
  const parsed = parseNumber(value)
  const normalized = parsed.kind === "nip" ? parsed.nip : parsed.kind === "vat" ? parsed.vat : value.replace(/[\s.-]/g, "").toUpperCase()

  const existing = await svc.listWhitelistEntities({ nip: normalized }, { take: 1 })
  const simulate = options.demo && existing[0]?.demo === true
  const { card, answers } = await checkRegistries(value, options, { simulate })

  const now = new Date()
  const meta = (prev: unknown) => ({
    ...(prev && typeof prev === "object" && !Array.isArray(prev) ? (prev as Record<string, unknown>) : {}),
    activity: card.activity,
    started_at: card.details?.started_at ?? null,
    registries: answers.map((a) => ({ source: a.source, state: a.state, reason: a.details?.reason ?? null })),
  })
  let entity: Row
  if (existing.length > 0) {
    const prev = existing[0]
    const updated = await svc.updateWhitelistEntities([
      {
        id: prev.id,
        source: card.source,
        state: card.state,
        status_vat: card.status_vat,
        /* A registry that did not answer never wipes what an earlier check knew. */
        name: card.name || prev.name || null,
        address: card.address || prev.address || null,
        bank_accounts: card.state === "unavailable" ? (prev.bank_accounts ?? []) : card.bank_accounts,
        regon: card.regon ?? prev.regon ?? null,
        krs: card.krs ?? prev.krs ?? null,
        legal_form: card.legal_form ?? prev.legal_form ?? null,
        customer_id: input.customerId ?? prev.customer_id ?? null,
        checked_at: now,
        demo: card.demo,
        metadata: meta(prev.metadata),
      },
    ])
    entity = updated[0]
  } else {
    const created = await svc.createWhitelistEntities([
      {
        nip: normalized,
        country_code: card.country_code,
        source: card.source,
        state: card.state,
        status_vat: card.status_vat,
        name: card.name || null,
        address: card.address || null,
        bank_accounts: card.bank_accounts,
        regon: card.regon,
        krs: card.krs,
        legal_form: card.legal_form,
        customer_id: input.customerId ?? null,
        checked_at: now,
        demo: card.demo,
        metadata: meta(null),
      },
    ])
    entity = created[0]
  }

  const checkRow = (a: CheckAnswer) => ({
    entity_id: entity.id,
    nip: normalized,
    country_code: a.country_code,
    source: a.source,
    state: a.state,
    status_vat: a.status_vat,
    name: a.name || null,
    address: a.address || null,
    bank_accounts: a.bank_accounts,
    regon: a.regon,
    krs: a.krs,
    legal_form: a.legal_form,
    requested_by: input.requestedBy,
    customer_id: input.customerId ?? null,
    demo: a.demo,
    metadata: { activity: a.activity, ...(a.details ?? {}) },
  })

  const checks = (await svc.createWhitelistChecks(answers.map(checkRow))).map(toCheck)
  const check = checks.find((c) => c.source !== "gus") ?? checks[0]
  const gus = checks.find((c) => c.source === "gus") ?? null
  return { entity: toEntity(entity, options.staleHours), check, gus, checks }
}
