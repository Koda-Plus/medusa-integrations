/**
 * "CHECK CONNECTION": one `getInventories` call (simulated in demo mode). It
 * proves the token, and tells whether the configured catalog exists and the
 * configured warehouse belongs to it, which are the two settings people get
 * wrong most often. The result is kept per process for the admin.
 */

import { parseInventories, type InventoryInfo } from "../../modules/baselinker/lib/catalog"
import type { CheckResult } from "../../modules/baselinker/lib/contract"
import { DEMO_INVENTORY_ID, DEMO_WAREHOUSE_ID, demoInventories } from "../../modules/baselinker/lib/demo"
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

export async function checkConnection(scope: Scope): Promise<CheckResult | null> {
  return exclusive("check", async () => {
    const svc = baselinkerService(scope)
    const o = svc.getOptions()
    const mode = o.demo ? "demo" : "live"
    const checkedAt = new Date().toISOString()
    let result: CheckResult
    try {
      const inventories = o.demo ? parseInventories(demoInventories()) : await clientFor(svc).getInventories()
      const inventoryId = o.demo ? DEMO_INVENTORY_ID : o.inventoryId
      const warehouseId = o.demo ? DEMO_WAREHOUSE_ID : o.warehouseId
      result = { ok: true, mode, error: null, checkedAt, inventories, ...describeInventories(inventories, inventoryId, warehouseId) }
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
    rememberCheck(result)
    return result
  })
}
