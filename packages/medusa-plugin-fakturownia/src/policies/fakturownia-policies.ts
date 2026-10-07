import { definePolicies } from "@medusajs/framework/utils"
import { POLICY_DEFINITIONS } from "../modules/fakturownia/lib/policies"

/**
 * The RBAC policies of the plugin, for the roles of the admin (Medusa 2.15
 * and newer loads this folder; with the `rbac` feature flag on, the routes
 * check them). Granting a role `fakturownia:read` lets it see the pages;
 * the writes need the operations listed in `lib/policies.ts`.
 */
export const fakturowniaPolicies = definePolicies(POLICY_DEFINITIONS.map((p) => ({ ...p })))
