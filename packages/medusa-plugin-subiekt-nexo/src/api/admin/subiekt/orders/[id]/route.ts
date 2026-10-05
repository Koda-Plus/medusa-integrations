import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OrderSubiektResponse } from "../../../../../modules/subiekt/lib/contract"
import { toDocumentDto, toTaskDto, type DocumentRow, type TaskRow } from "../../../../../modules/subiekt/lib/dto"
import { writerSupported } from "../../../../../modules/subiekt/lib/writers"
import { storedCapabilities } from "../../../../../workflows/subiekt/runtime"
import { writerActive } from "../../../../../workflows/subiekt/writers"
import { subiektService } from "../../helpers"

/** GET /admin/subiekt/orders/:id : documents and tasks of one order, for the order page widget. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  const orderId = req.params.id
  const option = svc.getOptions().salesDocument
  const [tasks, documents, active, capabilities] = await Promise.all([
    svc.listSubiektTasks({ order_id: orderId, demo: svc.isDemo() } as never, { take: 20, order: { created_at: "ASC" } } as never),
    svc.listSubiektDocuments({ order_id: orderId, demo: svc.isDemo() } as never, { take: 20, order: { created_at: "ASC" } } as never),
    writerActive(req.scope, "documents"),
    storedCapabilities(svc),
  ])
  const body: OrderSubiektResponse = {
    mode: svc.isDemo() ? "demo" : "live",
    orderId,
    tasks: (tasks as unknown as TaskRow[]).map(toTaskDto),
    documents: (documents as unknown as DocumentRow[]).map(toDocumentDto),
    salesDocument: { option, after: svc.getOptions().salesDocumentAfter, writerActive: active, supported: option !== "none" && writerSupported("documents", option, capabilities) },
  }
  res.json(body)
}
