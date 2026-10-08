import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { dueAt, normalizeNetDays } from "../../modules/credit/lib/credit"
import { creditSvc, str, type Row } from "../../modules/credit/lib/store"

/**
 * The flows around a limit: setting it (with the customer's name and e-mail
 * denormalized for the panel) and recomputing the used amount from the
 * customer's open credit orders.
 */

/** Creates or updates the limit of a customer. */
export async function setLimit(
  container: MedusaContainer,
  input: { customerId: string; limitAmount: number; netDays: number; currencyCode?: string | null },
): Promise<Row> {
  const svc = creditSvc(container)
  const existing = await svc.listCreditLimits({ customer_id: input.customerId }, { take: 1 })
  const amount = Math.max(0, Math.floor(input.limitAmount))
  const netDays = normalizeNetDays(input.netDays)

  let email: string | null = null
  let name: string | null = null
  try {
    const customer = await container.resolve(Modules.CUSTOMER).retrieveCustomer(input.customerId, { select: ["id", "email", "company_name", "first_name", "last_name"] })
    email = str(customer?.email)
    name = (str(customer?.company_name) ?? [str(customer?.first_name), str(customer?.last_name)].filter(Boolean).join(" ")) || null
  } catch {
    /* an unknown customer keeps the denormalized fields empty */
  }

  if (existing.length > 0) {
    const updated = await svc.updateCreditLimits([
      {
        id: existing[0].id,
        limit_amount: amount,
        net_days: netDays,
        currency_code: input.currencyCode ?? existing[0].currency_code ?? "pln",
        customer_email: email ?? existing[0].customer_email,
        customer_name: name ?? existing[0].customer_name,
      },
    ])
    return updated[0]
  }
  const created = await svc.createCreditLimits([
    {
      customer_id: input.customerId,
      customer_email: email,
      customer_name: name,
      currency_code: input.currencyCode ?? "pln",
      limit_amount: amount,
      used_amount: 0,
      net_days: netDays,
      status: "active",
      blocked: false,
      demo: svc.isDemo(),
    },
  ])
  return created[0]
}

/** The customer's used amount: the sum of their open and overdue credit orders. */
export async function usedOf(container: MedusaContainer, customerId: string): Promise<number> {
  const svc = creditSvc(container)
  const rows = await svc.listCreditOrders({ customer_id: customerId, state: ["open", "overdue"] }, { take: 1000 })
  return rows.reduce((sum, r) => sum + (typeof r.total_amount === "number" ? r.total_amount : 0), 0)
}

/** Writes the used amount of a limit from its open credit orders. */
export async function refreshUsed(container: MedusaContainer, customerId: string): Promise<void> {
  const svc = creditSvc(container)
  const limits = await svc.listCreditLimits({ customer_id: customerId }, { take: 1 })
  if (limits.length === 0) return
  const used = await usedOf(container, customerId)
  await svc.updateCreditLimits([{ id: limits[0].id, used_amount: used }])
}

/** The due date of an order placed now under `netDays` terms. */
export function dueFor(netDays: number, now: Date = new Date()): Date {
  return dueAt(now, netDays)
}
