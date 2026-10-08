import { communityEn } from "../lib/credit-kit-community"
import { integrationEn } from "../../modules/credit/lib/integration-texts"

const en = {
  nav: "Credit",
  title: "Trade Credit",
  by: "by Koda Plus",
  subtitle: "Credit limits and payment terms for B2B customers: net 14, 30 or 60 days, the used amount from their unpaid orders, the overdue check and a blocking toggle.",
  mode: {
    demo: "Demo",
  },
  error: "Could not load the page: {{message}}",
  stats: {
    limits: "Limits",
    used: "Used in total",
    overdue: "Overdue",
    blocked: "To check",
  },
  set: {
    title: "Set credit terms",
    subtitle: "Pick a customer, set the limit and the payment terms. A customer without terms pays immediately.",
    customer: "Customer",
    customerPlaceholder: "Search by name or e-mail",
    amount: "Limit amount",
    terms: "Payment terms",
    immediate: "Immediate",
    net: "Net {{days}}",
    save: "Set terms",
  },
  limits: {
    title: "Credit limits",
    subtitle: "The limit of every customer with terms: how much they may owe, how much they owe now and what is left. A click opens the editor.",
    empty: "No limits yet. Set the terms of a customer above.",
    customer: "Customer",
    limit: "Limit",
    used: "Used",
    remaining: "Left",
    terms: "Terms",
    state: "State",
    active: "Active",
    paused: "Paused",
    blocked: "Blocked",
    exhausted: "Limit reached",
    block: "Block / unblock",
    pause: "Pause / resume",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
  },
  orders: {
    title: "Open credit orders",
    subtitle: "Orders on customer accounts with their due dates, from the placed order. The daily job marks overdue and paid.",
    empty: "No open credit orders.",
    order: "Order",
    customer: "Customer",
    amount: "Amount",
    due: "Due",
    stateLabel: "State",
    state: {
      open: "Open",
      overdue: "Overdue",
      paid: "Paid",
    },
  },
  toast: {
    saved: "Saved",
    error: "Something went wrong: {{error}}",
  },
  community: communityEn,
  integration: integrationEn,
}

export default en
