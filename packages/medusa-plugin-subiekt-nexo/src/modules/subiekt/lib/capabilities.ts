/**
 * WHAT THE BRIDGE CAN DO. Contract 1.1 bridges list it in `capabilities`;
 * a bridge without the field speaks 1.0 and does orders, fulfillments, stock
 * and events. The plugin uses only what is listed, hides the rest in the
 * admin and says why, so a store can upgrade the plugin before the bridge.
 *
 * Pure, tested.
 */

import { LEGACY_CAPABILITIES } from "./constants"
import type { BridgeHealth } from "./contract"

/** Everything this plugin can use, in the order the admin lists them. */
export const KNOWN_CAPABILITIES: readonly string[] = [
  "orders",
  "fulfillments",
  "stock",
  "events",
  "products",
  "contractors",
  "contractors.create",
  "documents.fs",
  "documents.pa",
  "documents.ksef",
  "webhook",
]

/** Capabilities that appeared in contract 1.1: a 1.0 bridge needs an update for them. */
const SINCE_1_1 = new Set(["products", "contractors", "contractors.create", "documents.fs", "documents.pa", "documents.ksef", "webhook"])

export function isLegacy(health: Pick<BridgeHealth, "capabilities"> | null | undefined): boolean {
  return !health || !Array.isArray(health.capabilities)
}

/** What the bridge does. Without a health answer yet: nothing is known, so nothing is assumed. */
export function capabilitiesOf(health: Pick<BridgeHealth, "capabilities"> | null | undefined): string[] {
  if (!health) return []
  if (!Array.isArray(health.capabilities)) return [...LEGACY_CAPABILITIES]
  return health.capabilities.filter((c): c is string => typeof c === "string" && c.length > 0)
}

export function supports(health: Pick<BridgeHealth, "capabilities"> | null | undefined, capability: string): boolean {
  return capabilitiesOf(health).includes(capability)
}

/**
 * The reason a known capability is missing, as a key the admin translates:
 * `no_health` (never checked), `update_bridge` (a 1.0 bridge), `bridge_config`
 * (a 1.1 bridge configured without it, with the setting to change).
 */
export function missingCapabilities(
  health: Pick<BridgeHealth, "capabilities"> | null | undefined,
): Array<{ capability: string; reason: "no_health" | "update_bridge" | "bridge_config" }> {
  const have = new Set(capabilitiesOf(health))
  const legacy = isLegacy(health)
  return KNOWN_CAPABILITIES.filter((c) => !have.has(c)).map((capability) => ({
    capability,
    reason: !health ? "no_health" : legacy && SINCE_1_1.has(capability) ? "update_bridge" : "bridge_config",
  }))
}
