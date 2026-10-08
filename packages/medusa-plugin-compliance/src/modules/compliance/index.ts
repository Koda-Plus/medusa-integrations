import { Module } from "@medusajs/framework/utils"
import ComplianceModuleService from "./service"
import { COMPLIANCE_MODULE } from "./lib/constants"

/**
 * EU Compliance module: GPSR product safety, RODO consent and data subject
 * requests, and Omnibus price transparency.
 */
export { COMPLIANCE_MODULE }
export type { CompliancePluginOptions } from "./lib/options"
export type { ResponsiblePersonDto, ProductComplianceDto, ConsentDto, DsrDto, PriceSnapshotDto, ProductPriceDto, StatusResponse } from "./lib/contract"

export default Module(COMPLIANCE_MODULE, {
  service: ComplianceModuleService,
})
