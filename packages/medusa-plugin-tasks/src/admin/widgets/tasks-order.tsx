import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { TasksIcon } from "../lib/tasks-icon"
import { hostable } from "../lib/tasks-kit"
import { EntityTasksWidget } from "../lib/tasks-widget"

/** Order page, side column: tasks linked to this order, and "New task" with the order linked. A host embeds it as the tab `tasks.order`. */
const TasksOrderCard = ({ data, embedded }: DetailWidgetProps<AdminOrder> & { embedded?: boolean }) => (
  <EntityTasksWidget type="order" id={data.id} label={`#${data.display_id}`} embedded={embedded} />
)

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default hostable({ id: "tasks.order", ns: "tasks", zone: "order.details", name: "Tasks", order: 95, Icon: TasksIcon }, TasksOrderCard)
