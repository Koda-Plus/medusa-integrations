import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { creditSvc } from "../modules/credit/lib/store"
import { refreshUsed } from "../workflows/credit/limits"

/**
 * The daily account: open credit orders past their due date become overdue,
 * open orders whose Medusa payment was captured become paid, and the used
 * amount of every touched customer is written again. Runs at 03:40 every day.
 */
export default async function creditOverdueJob(container: MedusaContainer): Promise<void> {
  try {
    const svc = creditSvc(container)
    const rows = await svc.listCreditOrders({ state: ["open", "overdue"] }, { take: 5000 })
    if (rows.length === 0) return

    const orderModule = container.resolve(Modules.ORDER)
    const orderIds = rows.map((r) => String(r.order_id)).filter(Boolean)
    let payments: Array<{ id: string; payment_status?: string | null }> = []
    try {
      payments = (await orderModule.listOrders({ id: orderIds }, { select: ["id", "payment_status"], take: orderIds.length })) as Array<{ id: string; payment_status?: string | null }>
    } catch {
      /* without the order module the payment check is skipped */
    }
    const paid = new Set(payments.filter((o) => o.payment_status === "captured").map((o) => o.id))

    const now = new Date()
    const toPaid: string[] = []
    const toOverdue: string[] = []
    for (const r of rows) {
      if (paid.has(String(r.order_id))) toPaid.push(r.id)
      else if (r.state !== "overdue" && r.due_at instanceof Date && r.due_at.getTime() < now.getTime()) toOverdue.push(r.id)
      else if (r.state !== "overdue" && typeof r.due_at === "string" && new Date(r.due_at).getTime() < now.getTime()) toOverdue.push(r.id)
    }
    if (toPaid.length > 0) await svc.updateCreditOrders(toPaid.map((id) => ({ id, state: "paid", paid_at: now })))
    if (toOverdue.length > 0) await svc.updateCreditOrders(toOverdue.map((id) => ({ id, state: "overdue" })))

    const touched = new Set(rows.map((r) => String(r.customer_id)).filter(Boolean))
    for (const customerId of touched) await refreshUsed(container, customerId)
    if (toPaid.length || toOverdue.length) console.info(`[credit] account: ${toPaid.length} paid, ${toOverdue.length} overdue`)
  } catch (err) {
    console.warn(`[credit] account job failed: ${(err as Error).message}`)
  }
}

export const config = {
  name: "credit-overdue",
  schedule: "40 3 * * *",
}
