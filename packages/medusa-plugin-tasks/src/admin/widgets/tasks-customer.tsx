import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminCustomer, DetailWidgetProps } from "@medusajs/framework/types"
import { TasksIcon } from "../lib/tasks-icon"
import { hostable } from "../lib/tasks-kit"
import { EntityTasksWidget } from "../lib/tasks-widget"

/** The customer's company, name or e-mail, as the task shows the link. */
function customerLabel(c: AdminCustomer): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim()
  return c.company_name || name || c.email || c.id
}

/** Customer page: tasks linked to this customer, and "New task" with the customer linked. A host embeds it as the tab `tasks.customer`. */
const TasksCustomerCard = ({ data, embedded }: DetailWidgetProps<AdminCustomer> & { embedded?: boolean }) => (
  <EntityTasksWidget type="customer" id={data.id} label={customerLabel(data)} embedded={embedded} />
)

export const config = defineWidgetConfig({
  zone: "customer.details.after",
})

export default hostable({ id: "tasks.customer", ns: "tasks", zone: "customer.details", name: "Tasks", order: 95, Icon: TasksIcon }, TasksCustomerCard)
