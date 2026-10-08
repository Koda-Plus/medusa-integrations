import { Module } from "@medusajs/framework/utils"
import PackagingModuleService from "./service"
import { PACKAGING_MODULE } from "./lib/constants"

/**
 * Packaging module: the wholesale packaging ladder of the catalog (piece,
 * box, pallet), the MOQ and order step, the EAN codes and the SSCC labels.
 */
export { PACKAGING_MODULE }
export type { PackagingPluginOptions } from "./lib/options"
export type { ProductDto, UnitDto, StatusResponse } from "./lib/contract"

export default Module(PACKAGING_MODULE, {
  service: PackagingModuleService,
})
