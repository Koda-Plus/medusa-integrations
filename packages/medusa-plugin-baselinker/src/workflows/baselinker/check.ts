/**
 * "CHECK CONNECTION": `getInventories` (simulated in demo mode) proves the
 * token and tells whether the configured catalog exists and the configured
 * warehouse belongs to it, the two settings people get wrong most often.
 *
 * Since 0.2 the same click also reads what the setup needs to pick ids from:
 * price groups, warehouses (with whether stock may be written), order
 * sources, order statuses, custom order fields, and one probe of the order
 * journal. Each of these reads is optional: a failure leaves its list empty
 * and never fails the check. The result is kept per process for the admin.
 */

import { JOURNAL_LOG_TYPES } from "../../modules/baselinker/lib/constants"
import { parseExtraFields, parseInventories, parseOrderSources, parsePriceGroups, parseWarehouses, type InventoryInfo } from "../../modules/baselinker/lib/catalog"
import type { CheckResult } from "../../modules/baselinker/lib/contract"
import {
  DEMO_INVENTORY_ID,
  DEMO_STATUSES,
  DEMO_WAREHOUSE_ID,
  demoExtraFields,
  demoInventories,
  demoOrderSources,
  demoPriceGroups,
  demoWarehouses,
} from "../../modules/baselinker/lib/demo"
import { describeError } from "../../modules/baselinker/lib/errors"
import { baselinkerService, clientFor, exclusive, rememberCheck, type Scope } from "./runtime"

export function describeInventories(
  inventories: InventoryInfo[],
  inventoryId: number | null,
  warehouseId: string,
): Pick<CheckResult, "inventoryFound" | "inventoryName" | "warehouseFound" | "warehouses"> {
  const inventory = inventoryId !== null ? inventories.find((i) => i.id === inventoryId) ?? null : null
  return {
    inventoryFound: inventoryId === null ? null : Boolean(inventory),
    inventoryName: inventory?.name ?? null,
    warehouseFound: inventory && warehouseId ? inventory.warehouses.includes(warehouseId) : null,
    warehouses: inventory?.warehouses ?? [],
  }
}

async function optional<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read()
  } catch {
    return fallback
  }
}

export async function checkConnection(scope: Scope): Promise<CheckResult | null> {
  return exclusive(scope, "check", async () => {
    const svc = baselinkerService(scope)
    const o = svc.getOptions()
    const mode = o.demo ? "demo" : "live"
    const checkedAt = new Date().toISOString()
    let result: CheckResult
    try {
      if (o.demo) {
        const inventories = parseInventories(demoInventories())
        result = {
          ok: true,
          mode,
          error: null,
          checkedAt,
          inventories,
          ...describeInventories(inventories, DEMO_INVENTORY_ID, DEMO_WAREHOUSE_ID),
          priceGroups: parsePriceGroups(demoPriceGroups()),
          warehouseDetails: parseWarehouses(demoWarehouses()).map((w) => ({ key: w.key, name: w.name, type: w.type, editable: w.editable })),
          orderSources: parseOrderSources(demoOrderSources()),
          statuses: DEMO_STATUSES.map((s) => ({ id: s.id, name: s.name })),
          extraFields: parseExtraFields(demoExtraFields()),
          journal: "events",
        }
      } else {
        const client = clientFor(svc)
        const inventories = await client.getInventories()
        const statuses = await optional(async () => [...(await client.getOrderStatusList()).entries()].map(([id, name]) => ({ id, name })), [] as Array<{ id: number; name: string }>)
        const journal = await optional<CheckResult["journal"]>(async () => ((await client.getJournalList({ logs_types: JOURNAL_LOG_TYPES })).length > 0 ? "events" : "empty"), "error")
        result = {
          ok: true,
          mode,
          error: null,
          checkedAt,
          inventories,
          ...describeInventories(inventories, o.inventoryId, o.warehouseId),
          priceGroups: await optional(() => client.getInventoryPriceGroups(), []),
          warehouseDetails: await optional(async () => (await client.getInventoryWarehouses()).map((w) => ({ key: w.key, name: w.name, type: w.type, editable: w.editable })), []),
          orderSources: await optional(() => client.getOrderSources(), []),
          statuses,
          extraFields: await optional(() => client.getOrderExtraFields(), []),
          journal,
        }
      }
    } catch (err) {
      result = {
        ok: false,
        mode,
        error: svc.mask(describeError(err).message),
        checkedAt,
        inventories: [],
        inventoryFound: null,
        inventoryName: null,
        warehouseFound: null,
        warehouses: [],
      }
    }
    await rememberCheck(svc, result)
    return result
  })
}
