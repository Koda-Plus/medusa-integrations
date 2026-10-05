import { model } from "@medusajs/framework/utils"

/**
 * Small named values the plugin keeps between runs, one row per key:
 *
 *   writer:<writer>:<demo|live>   the runtime toggle: armed, who, when
 *   plan:<demo|live>              the last plan: read completeness, counts, guard
 *   stats:<demo|live>             the last statistics run
 *   threads:<demo|live>           the last thread read
 *   demo:generator                the demo generator version of the snapshot
 */
const OlxState = model.define("olx_state", {
  id: model.id().primaryKey(),
  value: model.json().nullable(),
})

export default OlxState
