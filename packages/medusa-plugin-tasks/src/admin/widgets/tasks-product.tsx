import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { TasksIcon } from "../lib/tasks-icon"
import { hostable } from "../lib/tasks-kit"
import { EntityTasksWidget } from "../lib/tasks-widget"

/** Product page, side column: tasks linked to this product, and "New task" with the product linked. A host embeds it as the tab `tasks.product`. */
const TasksProductCard = ({ data, embedded }: DetailWidgetProps<AdminProduct> & { embedded?: boolean }) => (
  <EntityTasksWidget type="product" id={data.id} label={data.title ?? data.id} embedded={embedded} />
)

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default hostable({ id: "tasks.product", ns: "tasks", zone: "product.details", name: "Tasks", order: 95, Icon: TasksIcon }, TasksProductCard)
