import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminCustomer, DetailWidgetProps } from "@medusajs/framework/types"
import { EntityTasksWidget } from "../lib/tasks-widget"

/** The customer's company, name or e-mail, as the task shows the link. */
function customerLabel(c: AdminCustomer): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim()
  return c.company_name || name || c.email || c.id
}

/** Customer page: tasks linked to this customer, and "New task" with the customer linked. */
const TasksCustomerWidget = ({ data }: DetailWidgetProps<AdminCustomer>) => <EntityTasksWidget type="customer" id={data.id} label={customerLabel(data)} />

export const config = defineWidgetConfig({
  zone: "customer.details.after",
})

export default TasksCustomerWidget
