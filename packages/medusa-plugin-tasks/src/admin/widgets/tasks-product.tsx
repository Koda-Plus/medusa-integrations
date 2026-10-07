import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { EntityTasksWidget } from "../lib/tasks-widget"

/** Product page, side column: tasks linked to this product, and "New task" with the product linked. */
const TasksProductWidget = ({ data }: DetailWidgetProps<AdminProduct>) => <EntityTasksWidget type="product" id={data.id} label={data.title ?? data.id} />

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default TasksProductWidget
