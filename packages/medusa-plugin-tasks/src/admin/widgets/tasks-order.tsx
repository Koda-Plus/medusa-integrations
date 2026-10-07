import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { EntityTasksWidget } from "../lib/tasks-widget"

/** Order page, side column: tasks linked to this order, and "New task" with the order linked. */
const TasksOrderWidget = ({ data }: DetailWidgetProps<AdminOrder>) => <EntityTasksWidget type="order" id={data.id} label={`#${data.display_id}`} />

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default TasksOrderWidget
