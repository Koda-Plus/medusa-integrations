import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { generateEntityId } from "@medusajs/framework/utils"
import { isWriterKey } from "../../../../../../../../modules/olx/lib/constants"
import type { PlanItemRow, PublicationRow } from "../../../../../../../../modules/olx/lib/dto"
import { createPlanItemStore, createPublicationStore } from "../../../../../../../../modules/olx/lib/store"
import { sqlOf } from "../../../../../../../../workflows/olx/runtime"
import { actorOf, buildStatus, olxService } from "../../../../../helpers"

/**
 * POST /admin/olx/writers/:writer/items/:id/release
 *
 * A person's decision on one item:
 *   quarantined (three failures in a row)  back to the plan, attempts reset
 *   held (a price change above the limit)  approved for exactly that price
 *   a publication that failed               back to the plan
 *   a publication whose advert is gone      may be published again (the
 *                                           lookup before the create still runs)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  const writer = req.params.writer
  const id = String(req.params.id ?? "")
  if (!isWriterKey(writer)) {
    res.status(404).json({ message: "Unknown writer." })
    return
  }
  const demo = svc.isDemo()
  const actor = (await actorOf(req)) ?? "unknown"
  const sql = sqlOf(req.scope)

  if (writer === "publish") {
    const rows = (await svc.listOlxPublications({ id, demo } as never, { take: 1 })) as unknown as PublicationRow[]
    const row = rows[0]
    if (!row) {
      res.status(404).json({ message: "No such publication." })
      return
    }
    const store = createPublicationStore(sql, () => generateEntityId(undefined, "olxpub"))
    if (row.state === "published") {
      const advert = row.olx_id
        ? ((await svc.listOlxAdverts({ olx_id: row.olx_id, demo } as never, { take: 1, select: ["id"] })) as unknown as Array<{ id: string }>)
        : []
      if (advert.length > 0) {
        res.status(409).json({ message: "The advert of this publication is still on OLX. End or delete it on OLX first." })
        return
      }
    } else if (row.state !== "quarantined" && row.state !== "failed") {
      res.status(409).json({ message: `Nothing to release: the publication is ${row.state}.` })
      return
    }
    await store.transition(row.id, [row.state], {
      state: "planned",
      attempts: 0,
      last_error: null,
      note: `released by ${actor}`.slice(0, 200),
      planned_at: new Date(),
      olx_id: row.state === "published" ? null : row.olx_id,
      olx_url: row.state === "published" ? null : row.olx_url,
    })
    res.json(await buildStatus(svc))
    return
  }

  const rows = (await svc.listOlxPlanItems({ id, writer, demo } as never, { take: 1 })) as unknown as PlanItemRow[]
  const row = rows[0]
  if (!row) {
    res.status(404).json({ message: "No such plan item." })
    return
  }
  const store = createPlanItemStore(sql)
  if (row.state === "quarantined") {
    await store.transition(row.id, ["quarantined"], { state: "pending", attempts: 0, last_error: null, note: `released by ${actor}`.slice(0, 200) })
  } else if (row.state === "held") {
    await store.transition(row.id, ["held"], { state: "pending", approved_value: row.to_value, note: `approved by ${actor}`.slice(0, 200) })
  } else {
    res.status(409).json({ message: `Nothing to release: the item is ${row.state}.` })
    return
  }
  res.json(await buildStatus(svc))
}
