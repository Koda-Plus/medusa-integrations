import type { MedusaContainer } from "@medusajs/framework/types"
import { checkGus, checkNumber, type CheckAnswer } from "../../modules/whitelist/lib/check"
import { toCheck, toEntity, whitelistSvc, type Row } from "../../modules/whitelist/lib/store"
import { cleanNip, kindOf } from "../../modules/whitelist/lib/whitelist"
import type { CheckDto, EntityDto } from "../../modules/whitelist/lib/contract"

/**
 * One check: the format decides the source, the registries answer, the
 * counterparty row is created or refreshed and every answer is appended to
 * the audit trail. A Polish NIP asks the whitelist AND the GUS Business
 * Registry (the REGON and the legal form); the entity keeps the merged
 * answer. Used by the admin and the store routes.
 */
export async function runCheck(
  container: MedusaContainer,
  input: { value: string; requestedBy: string; customerId?: string | null; force?: boolean },
): Promise<{ entity: EntityDto; check: CheckDto; gus: CheckDto | null }> {
  const svc = whitelistSvc(container)
  const options = svc.getOptions()
  const value = input.value.trim()
  const kind = kindOf(value)

  const answer = await checkNumber(value, options)
  const gusAnswer = kind === "nip" ? await checkGus(value, options) : null

  /* A fresh entity, or the existing one for the same number. */
  const normalized = kind === "nip" ? (cleanNip(value) ?? value.replace(/\D/g, "")) : value.replace(/[\s-]/g, "").toUpperCase()
  const existing = await svc.listWhitelistEntities({ nip: normalized }, { take: 1 })
  const now = new Date()
  let entity: Row
  if (existing.length > 0) {
    const updated = await svc.updateWhitelistEntities([
      {
        id: existing[0].id,
        source: answer.source,
        state: answer.state,
        status_vat: answer.status_vat,
        name: answer.name || null,
        address: answer.address || null,
        bank_accounts: answer.bank_accounts,
        regon: answer.regon ?? gusAnswer?.regon ?? existing[0].regon ?? null,
        krs: answer.krs ?? existing[0].krs ?? null,
        legal_form: gusAnswer?.legal_form ?? existing[0].legal_form ?? null,
        customer_id: input.customerId ?? existing[0].customer_id ?? null,
        checked_at: now,
      },
    ])
    entity = updated[0]
  } else {
    const created = await svc.createWhitelistEntities([
      {
        nip: normalized,
        country_code: answer.country_code,
        source: answer.source,
        state: answer.state,
        status_vat: answer.status_vat,
        name: answer.name || null,
        address: answer.address || null,
        bank_accounts: answer.bank_accounts,
        regon: answer.regon ?? gusAnswer?.regon ?? null,
        krs: answer.krs ?? null,
        legal_form: gusAnswer?.legal_form ?? null,
        customer_id: input.customerId ?? null,
        checked_at: now,
        demo: options.demo,
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
    demo: options.demo,
  })

  const createdChecks = await svc.createWhitelistChecks([checkRow(answer), ...(gusAnswer ? [checkRow(gusAnswer)] : [])])

  const checks = createdChecks.map(toCheck)
  const check = checks.find((c) => c.source !== "gus") ?? checks[0]
  const gus = checks.find((c) => c.source === "gus") ?? null
  return { entity: toEntity(entity, options.staleHours), check, gus }
}
