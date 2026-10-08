import type { MedusaContainer } from "@medusajs/framework/types"
import { checkNumber } from "../../modules/whitelist/lib/check"
import { toCheck, toEntity, whitelistSvc, type Row } from "../../modules/whitelist/lib/store"
import { cleanNip, kindOf } from "../../modules/whitelist/lib/whitelist"
import type { CheckDto, EntityDto } from "../../modules/whitelist/lib/contract"

/**
 * One check: the format decides the source, the registry answers, the
 * counterparty row is created or refreshed and the check is appended to the
 * audit trail. Used by the admin and the store routes.
 */
export async function runCheck(
  container: MedusaContainer,
  input: { value: string; requestedBy: string; customerId?: string | null; force?: boolean },
): Promise<{ entity: EntityDto; check: CheckDto }> {
  const svc = whitelistSvc(container)
  const options = svc.getOptions()
  const value = input.value.trim()
  const kind = kindOf(value)

  const answer = await checkNumber(value, options)

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
        customer_id: input.customerId ?? null,
        checked_at: now,
        demo: options.demo,
      },
    ])
    entity = created[0]
  }

  const createdChecks = await svc.createWhitelistChecks([
    {
      entity_id: entity.id,
      nip: normalized,
      country_code: answer.country_code,
      source: answer.source,
      state: answer.state,
      status_vat: answer.status_vat,
      name: answer.name || null,
      address: answer.address || null,
      bank_accounts: answer.bank_accounts,
      requested_by: input.requestedBy,
      customer_id: input.customerId ?? null,
      demo: options.demo,
    },
  ])

  return { entity: toEntity(entity, options.staleHours), check: toCheck(createdChecks[0]) }
}
