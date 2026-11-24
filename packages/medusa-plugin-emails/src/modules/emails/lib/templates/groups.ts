/**
 * The groups of the built-in templates in the admin gallery (definition
 * `category`) and who gets them (`audience`). An app gives its own templates
 * the same fields with its own words.
 */

export const CATEGORY = {
  orders: { en: "Orders", pl: "Zamówienia" },
  account: { en: "Account", pl: "Konto" },
  carts: { en: "Carts", pl: "Koszyki" },
  negotiations: { en: "Negotiations", pl: "Negocjacje" },
} as const

export const AUDIENCE = {
  customer: { en: "To the customer", pl: "Do klienta" },
} as const
