/**
 * THE WORDS OF THE BUILT-IN TEMPLATES, in English and Polish. Zero imports
 * beyond the plural rule.
 *
 * Polish copy addresses the customer as "Ty" with a capital letter, the way
 * Polish letters do, and avoids forms that would need to decline a product
 * or store name. Neither language uses a dash as punctuation: commas, colons
 * and full stops only.
 */

import type { EmailLocale } from "../constants"
import type { KitCopy } from "../kit"
import { plural } from "../locale"

export interface TemplateCopy {
  kit: KitCopy
  testPrefix: string
  /** The logo text when no store name is set. */
  logoFallback: string
  common: {
    /** "nr 1042" / "#1042" (a custom number stays as it is). */
    orderNo: (nr: string) => string
    orderChip: (nr: string | null) => string
    orderNumber: string
    date: string
    delivery: string
    payment: string
    products: string
    total: string
    address: string
    taxNote: (amount: string) => string
    discountNote: (amount: string) => string
    viewOrder: string
    backToStore: string
    goToStore: string
    myAccount: string
    positions: (n: number) => string
  }
  orderPlaced: {
    label: string
    description: string
    subject: (nr: string | null) => string
    preheader: (count: number, total: string | null) => string
    eyebrow: string
    title: (name: string | null) => { before: string; accent: string; after: string }
    intro: (nr: string | null) => { before: string; nr: string | null; after: string }
    steps: [string, string, string, string]
    inProgress: string
    ordered: string
  }
  orderShipped: {
    label: string
    description: string
    subject: (nr: string | null, partial: boolean) => string
    preheader: (number: string | null) => string
    eyebrow: (partial: boolean) => string
    title: (partial: boolean) => { before: string; accent: string; after: string }
    intro: (partial: boolean, tracked: boolean) => string
    tracking: string
    inParcel: string
    shipped: string
    onTheWay: string
  }
  orderCanceled: {
    label: string
    description: string
    subject: (nr: string | null) => string
    preheader: string
    eyebrow: string
    title: (nr: string | null) => { before: string; nr: string | null; after: string }
    intro: string
    slipLabel: string
    status: string
    placed: string
    canceled: string
    amount: string
    canceledItems: string
  }
  customerWelcome: {
    label: string
    description: string
    subject: (name: string | null, store: string | null) => string
    preheader: string
    chip: string
    eyebrow: (store: string | null) => string
    title: (name: string | null) => { before: string; accent: string; after: string }
    intro: (store: string | null) => string
    status: string
    since: string
    holderFallback: string
    startLabel: string
    steps: Array<{ title: string; body: string }>
  }
  passwordReset: {
    label: string
    description: string
    subject: (store: string | null, admin: boolean) => string
    preheader: (minutes: string) => string
    chip: string
    eyebrow: string
    title: { before: string; accent: string; after: string }
    intro: (minutes: string) => { before: string; after: string }
    button: string
    notYou: string
    minutes: (n: number) => string
  }
  cartAbandoned: {
    label: string
    description: string
    subject: (name: string | null) => string
    preheader: (what: string) => string
    chip: string
    eyebrow: string
    title: (name: string | null) => { before: string; accent: string; after: string }
    intro: (what: string) => string
    value: string
    inCart: string
    note: string
    button: string
  }
  negotiation: {
    labels: { countered: string; accepted: string; rejected: string }
    descriptions: { countered: string; accepted: string; rejected: string }
    chip: (ref: string | null) => string
    slipLabel: string
    quantity: string
    price: string
    pricePerUnit: string
    priceCart: string
    validUntil: string
    product: string
    variant: string
    countered: {
      subject: (ref: string | null) => string
      preheader: string
      eyebrow: string
      title: { before: string; accent: string; after: string }
      intro: string
      status: string
      button: string
    }
    accepted: {
      subject: (ref: string | null) => string
      preheader: string
      eyebrow: string
      title: { before: string; accent: string; after: string }
      intro: string
      status: string
      button: string
    }
    rejected: {
      subject: (ref: string | null) => string
      preheader: string
      eyebrow: string
      title: { before: string; accent: string; after: string }
      intro: string
      status: string
      button: string
    }
  }
}

const isNumeric = (nr: string) => /^\d+$/.test(nr)

const en: TemplateCopy = {
  kit: {
    helpTitle: "Questions?",
    helpReply: "Reply to this e-mail. It goes straight to our team, not to a bot.",
    helpReplyOr: (email) => `Reply to this e-mail or write to ${email}.`,
    helpWrite: (email) => `Write to ${email} and we will answer as soon as we can.`,
    footerNotice: (store) => `This message is about your account or an order at ${store ?? "our store"}.`,
    linkStore: "Store",
    linkAccount: "My account",
    more: (n) => `and ${n} more ${n === 1 ? "product" : "products"}`,
    quantity: (q) => `Qty ${q}`,
    each: (price) => `at ${price} each`,
    track: "Track the parcel",
    trackingNumber: "Tracking number",
    carrier: "Carrier",
    linkFallback: "The button does not work? Copy this address into your browser:",
  },
  testPrefix: "[Test] ",
  logoFallback: "Store",
  common: {
    orderNo: (nr) => (isNumeric(nr) ? `#${nr}` : nr),
    orderChip: (nr) => (nr ? `Order ${isNumeric(nr) ? `#${nr}` : nr}` : "Order"),
    orderNumber: "Order number",
    date: "Date",
    delivery: "Delivery",
    payment: "Payment",
    products: "Products",
    total: "Total",
    address: "Delivery address",
    taxNote: (amount) => `including tax ${amount}`,
    discountNote: (amount) => `discount applied: ${amount}`,
    viewOrder: "View your order",
    backToStore: "Back to the store",
    goToStore: "Go to the store",
    myAccount: "My account",
    positions: (n) => `${n} ${n === 1 ? "item" : "items"}`,
  },
  orderPlaced: {
    label: "Order confirmation",
    description: "A customer places an order",
    subject: (nr) => (nr ? `We have your order ${isNumeric(nr) ? `#${nr}` : nr}` : "We have your order"),
    preheader: (count, total) => `We are packing ${count} ${count === 1 ? "item" : "items"}${total ? ` worth ${total}` : ""}. We will write when the parcel leaves.`,
    eyebrow: "Order placed",
    title: (name) => ({ before: name ? `Thank you, ${name}. ` : "Thank you. ", accent: "We are packing", after: " your order." }),
    intro: (nr) =>
      nr
        ? { before: "Order ", nr: isNumeric(nr) ? `#${nr}` : nr, after: " is in. We will write when the parcel leaves." }
        : { before: "Your order is in. We will write when the parcel leaves.", nr: null, after: "" },
    steps: ["Placed", "Packing", "Shipped", "Delivered"],
    inProgress: "in progress",
    ordered: "Your order",
  },
  orderShipped: {
    label: "Order shipped",
    description: "A shipment of an order is marked as shipped",
    subject: (nr, partial) => {
      const no = nr ? (isNumeric(nr) ? ` #${nr}` : ` ${nr}`) : ""
      return partial ? `Part of order${no} is on its way` : nr ? `Order${no} is on its way` : "Your order is on its way"
    },
    preheader: (number) => (number ? `Tracking number: ${number}. Follow the parcel in one click.` : "Your parcel is with the carrier."),
    eyebrow: (partial) => (partial ? "Part of your order shipped" : "Order shipped"),
    title: (partial) => (partial ? { before: "Part of your order ", accent: "is on its way", after: "." } : { before: "Your parcel ", accent: "is on its way", after: "." }),
    intro: (partial, tracked) =>
      partial
        ? "We have sent some of your products. The rest follows in another parcel, and we will let you know."
        : tracked
          ? "Your parcel is with the carrier. The tracking number is below."
          : "Your parcel is with the carrier.",
    tracking: "Tracking",
    inParcel: "In this parcel",
    shipped: "Shipped products",
    onTheWay: "on its way",
  },
  orderCanceled: {
    label: "Order cancelled",
    description: "An order is cancelled",
    subject: (nr) => (nr ? `Order ${isNumeric(nr) ? `#${nr}` : nr} has been cancelled` : "Your order has been cancelled"),
    preheader: "We will not fulfil this order. If a payment was taken, it goes back the same way.",
    eyebrow: "Order cancelled",
    title: (nr) => (nr ? { before: "Order ", nr: isNumeric(nr) ? `#${nr}` : nr, after: " has been cancelled." } : { before: "Your order has been cancelled.", nr: null, after: "" }),
    intro: "We will not fulfil it. If a payment was taken, it goes back to the same payment method; how long that takes depends on your bank.",
    slipLabel: "Order",
    status: "Cancelled",
    placed: "Placed",
    canceled: "Cancelled",
    amount: "Amount",
    canceledItems: "Cancelled products",
  },
  customerWelcome: {
    label: "Welcome",
    description: "A customer creates an account",
    subject: (name, store) => `${name ? `${name}, your` : "Your"}${store ? ` ${store}` : ""} account is ready`,
    preheader: "Orders, addresses and your purchase history in one place. Here is where to start.",
    chip: "New account",
    eyebrow: (store) => (store ? `Welcome to ${store}` : "Welcome"),
    title: (name) => ({ before: name ? `${name}, your account ` : "Your account ", accent: "is ready", after: "." }),
    intro: (store) => `Your${store ? ` ${store}` : ""} account works. Below is your customer card and three things worth doing first.`,
    status: "Account active",
    since: "Customer since",
    holderFallback: "Your account",
    startLabel: "To start",
    steps: [
      { title: "Save your delivery address", body: "It fills itself in at the next checkout." },
      { title: "Follow your orders", body: "The status of every order is in your account." },
      { title: "Order again", body: "Your purchase history makes a repeat order quick." },
    ],
  },
  passwordReset: {
    label: "Password reset",
    description: "A customer or an admin user asks for a new password",
    subject: (store, admin) => `Reset your${store ? ` ${store}` : ""}${admin ? " admin" : ""} password`,
    preheader: (minutes) => `The link works for ${minutes}. If it was not you, ignore this e-mail.`,
    chip: "Security",
    eyebrow: "Password reset",
    title: { before: "Set a ", accent: "new password", after: "." },
    intro: (minutes) => ({ before: "Someone, most likely you, asked to change the password of ", after: `. The link works for ${minutes}.` }),
    button: "Set a new password",
    notYou: "If it was not you, ignore this e-mail. Your password stays the same.",
    minutes: (n) => `${n} ${n === 1 ? "minute" : "minutes"}`,
  },
  cartAbandoned: {
    label: "Abandoned cart",
    description: "A cart waits without an order, once per cart",
    subject: (name) => (name ? `${name}, your cart is still waiting` : "Your cart is still waiting"),
    preheader: (what) => `We saved ${what}. One click takes you back to your order.`,
    chip: "Cart",
    eyebrow: "Saved cart",
    title: (name) => ({ before: name ? `${name}, your cart ` : "Your cart ", accent: "is still waiting", after: "." }),
    intro: (what) => `We saved ${what}. One click and you are back where you left off.`,
    value: "Cart value",
    inCart: "In your cart",
    note: "We do not reserve products, so their availability may change.",
    button: "Back to your cart",
  },
  negotiation: {
    labels: { countered: "Negotiation: new offer", accepted: "Negotiation: price agreed", rejected: "Negotiation: closed" },
    descriptions: {
      countered: "The store answers a price request with an offer",
      accepted: "A negotiation ends with an agreed price",
      rejected: "A negotiation ends without a deal",
    },
    chip: (ref) => (ref ? `Negotiation ${ref}` : "Negotiation"),
    slipLabel: "Negotiation",
    quantity: "Quantity",
    price: "Price",
    pricePerUnit: "Price per unit",
    priceCart: "Price for the cart",
    validUntil: "Offer valid until",
    product: "Product",
    variant: "Variant",
    countered: {
      subject: (ref) => (ref ? `Negotiation ${ref}: a new offer for you` : "A new offer for you"),
      preheader: "We answered your price request. See the offer and decide in your account.",
      eyebrow: "Price negotiation",
      title: { before: "We have ", accent: "a new offer", after: " for you." },
      intro: "We answered your price request. See the offer below and decide in your account.",
      status: "Offer",
      button: "See the offer",
    },
    accepted: {
      subject: (ref) => (ref ? `Negotiation ${ref}: price agreed` : "Price agreed"),
      preheader: "The price is agreed. You can place the order.",
      eyebrow: "Negotiation closed",
      title: { before: "We have ", accent: "a deal", after: "." },
      intro: "The price is agreed. The details are below; you can place the order in your account.",
      status: "Agreed",
      button: "Open the negotiation",
    },
    rejected: {
      subject: (ref) => (ref ? `Negotiation ${ref} closed without a deal` : "Negotiation closed without a deal"),
      preheader: "We could not agree on a price this time.",
      eyebrow: "Negotiation closed",
      title: { before: "No deal ", accent: "this time", after: "." },
      intro: "We could not agree on a price. You can propose another price or quantity; we are happy to talk again.",
      status: "Closed",
      button: "See the negotiation",
    },
  },
}

const minutesPl = (n: number) => `${n} ${plural("pl", n, { one: "minutę", few: "minuty", many: "minut" })}`

const pl: TemplateCopy = {
  kit: {
    helpTitle: "Masz pytanie?",
    helpReply: "Odpowiedz na tę wiadomość. Trafi prosto do naszego zespołu, nie do automatu.",
    helpReplyOr: (email) => `Odpowiedz na tę wiadomość albo napisz na ${email}.`,
    helpWrite: (email) => `Napisz na ${email}, odpowiemy najszybciej, jak się da.`,
    footerNotice: (store) => `Ta wiadomość dotyczy Twojego konta lub zamówienia w ${store ?? "naszym sklepie"}.`,
    linkStore: "Sklep",
    linkAccount: "Moje konto",
    more: (n) => `i jeszcze ${n} ${plural("pl", n, { one: "produkt", few: "produkty", many: "produktów" })}`,
    quantity: (q) => `${q} szt.`,
    each: (price) => `po ${price}`,
    track: "Śledź przesyłkę",
    trackingNumber: "Numer przesyłki",
    carrier: "Przewoźnik",
    linkFallback: "Przycisk nie działa? Skopiuj ten adres do przeglądarki:",
  },
  testPrefix: "[Test] ",
  logoFallback: "Sklep",
  common: {
    orderNo: (nr) => (isNumeric(nr) ? `nr ${nr}` : nr),
    orderChip: (nr) => (nr ? `Zamówienie ${isNumeric(nr) ? `nr ${nr}` : nr}` : "Zamówienie"),
    orderNumber: "Numer zamówienia",
    date: "Data",
    delivery: "Dostawa",
    payment: "Płatność",
    products: "Produkty",
    total: "Razem",
    address: "Adres dostawy",
    taxNote: (amount) => `w tym VAT ${amount}`,
    discountNote: (amount) => `uwzględniony rabat: ${amount}`,
    viewOrder: "Zobacz zamówienie",
    backToStore: "Wróć do sklepu",
    goToStore: "Przejdź do sklepu",
    myAccount: "Moje konto",
    positions: (n) => `${n} ${plural("pl", n, { one: "pozycję", few: "pozycje", many: "pozycji" })}`,
  },
  orderPlaced: {
    label: "Potwierdzenie zamówienia",
    description: "Klient składa zamówienie",
    subject: (nr) => (nr ? `Mamy Twoje zamówienie ${isNumeric(nr) ? `nr ${nr}` : nr}` : "Mamy Twoje zamówienie"),
    preheader: (count, total) =>
      `Kompletujemy ${count} ${plural("pl", count, { one: "pozycję", few: "pozycje", many: "pozycji" })}${total ? ` na kwotę ${total}` : ""}. Napiszemy, gdy paczka wyruszy.`,
    eyebrow: "Zamówienie przyjęte",
    title: (name) => ({ before: name ? `${name}, dziękujemy. ` : "Dziękujemy. ", accent: "Kompletujemy", after: " Twoje zamówienie." }),
    intro: (nr) =>
      nr
        ? { before: "Zamówienie ", nr: isNumeric(nr) ? `nr ${nr}` : nr, after: " jest w systemie. Napiszemy, gdy paczka wyruszy." }
        : { before: "Zamówienie jest w systemie. Napiszemy, gdy paczka wyruszy.", nr: null, after: "" },
    steps: ["Przyjęte", "Kompletowanie", "Wysyłka", "Doręczenie"],
    inProgress: "w toku",
    ordered: "Zamówione produkty",
  },
  orderShipped: {
    label: "Zamówienie wysłane",
    description: "Przesyłka z zamówienia zostaje oznaczona jako wysłana",
    subject: (nr, partial) => {
      const no = nr ? (isNumeric(nr) ? ` nr ${nr}` : ` ${nr}`) : ""
      return partial ? `Część zamówienia${no} jest w drodze` : nr ? `Zamówienie${no} jest w drodze` : "Twoje zamówienie jest w drodze"
    },
    preheader: (number) => (number ? `Numer przesyłki: ${number}. Śledź paczkę jednym kliknięciem.` : "Przekazaliśmy paczkę przewoźnikowi."),
    eyebrow: (partial) => (partial ? "Wysłana część zamówienia" : "Zamówienie wysłane"),
    title: (partial) => (partial ? { before: "Część zamówienia ", accent: "jest w drodze", after: "." } : { before: "Twoja paczka ", accent: "jest w drodze", after: "." }),
    intro: (partial, tracked) =>
      partial
        ? "Wysłaliśmy część produktów. Resztę wyślemy osobno i też damy znać."
        : tracked
          ? "Przekazaliśmy paczkę przewoźnikowi. Numer przesyłki znajdziesz poniżej."
          : "Przekazaliśmy paczkę przewoźnikowi.",
    tracking: "Śledzenie przesyłki",
    inParcel: "W tej paczce",
    shipped: "Wysłane produkty",
    onTheWay: "w drodze",
  },
  orderCanceled: {
    label: "Zamówienie anulowane",
    description: "Zamówienie zostaje anulowane",
    subject: (nr) => (nr ? `Zamówienie ${isNumeric(nr) ? `nr ${nr}` : nr} zostało anulowane` : "Twoje zamówienie zostało anulowane"),
    preheader: "Nie zrealizujemy tego zamówienia. Jeśli płatność była już pobrana, wróci tą samą drogą.",
    eyebrow: "Zamówienie anulowane",
    title: (nr) =>
      nr ? { before: "Zamówienie ", nr: isNumeric(nr) ? `nr ${nr}` : nr, after: " zostało anulowane." } : { before: "Twoje zamówienie zostało anulowane.", nr: null, after: "" },
    intro: "Nie zrealizujemy go. Jeśli płatność była już pobrana, wróci tą samą metodą płatności, a czas zwrotu zależy od banku.",
    slipLabel: "Zamówienie",
    status: "Anulowane",
    placed: "Złożone",
    canceled: "Anulowane",
    amount: "Kwota",
    canceledItems: "Anulowane produkty",
  },
  customerWelcome: {
    label: "Powitanie",
    description: "Klient zakłada konto",
    subject: (name, store) => `${name ? `${name}, Twoje` : "Twoje"} konto${store ? ` w ${store}` : ""} jest gotowe`,
    preheader: "Zamówienia, adresy i historia zakupów w jednym miejscu. Zobacz, od czego zacząć.",
    chip: "Nowe konto",
    eyebrow: (store) => (store ? `Witamy w ${store}` : "Witamy"),
    title: (name) => ({ before: name ? `${name}, Twoje konto ` : "Twoje konto ", accent: "jest gotowe", after: "." }),
    intro: (store) => `${store ? `Konto w ${store}` : "Twoje konto"} już działa. Poniżej Twoja karta klienta i trzy rzeczy, od których warto zacząć.`,
    status: "Konto aktywne",
    since: "Klient od",
    holderFallback: "Twoje konto",
    startLabel: "Na start",
    steps: [
      { title: "Zapisz adres dostawy", body: "Przy kolejnym zamówieniu wypełni się sam." },
      { title: "Śledź zamówienia", body: "Status każdego zamówienia sprawdzisz na swoim koncie." },
      { title: "Zamawiaj ponownie", body: "Historia zakupów pozwala szybko zamówić to samo jeszcze raz." },
    ],
  },
  passwordReset: {
    label: "Reset hasła",
    description: "Klient albo użytkownik panelu prosi o nowe hasło",
    subject: (store, admin) =>
      admin ? (store ? `Ustaw nowe hasło do panelu ${store}` : "Ustaw nowe hasło do panelu sklepu") : store ? `Ustaw nowe hasło do konta w ${store}` : "Ustaw nowe hasło do swojego konta",
    preheader: (minutes) => `Link działa przez ${minutes}. Jeśli to nie Ty, zignoruj tę wiadomość.`,
    chip: "Bezpieczeństwo",
    eyebrow: "Zmiana hasła",
    title: { before: "Ustaw ", accent: "nowe hasło", after: "." },
    intro: (minutes) => ({ before: "Ktoś, najpewniej Ty, poprosił o zmianę hasła do konta ", after: `. Link działa przez ${minutes}.` }),
    button: "Ustaw nowe hasło",
    notYou: "Jeśli to nie Ty, zignoruj tę wiadomość. Hasło się nie zmieni.",
    minutes: minutesPl,
  },
  cartAbandoned: {
    label: "Porzucony koszyk",
    description: "Koszyk czeka bez zamówienia, raz na koszyk",
    subject: (name) => (name ? `${name}, Twój koszyk wciąż czeka` : "Twój koszyk wciąż czeka"),
    preheader: (what) => `Zapisaliśmy ${what}. Wrócisz do zamówienia jednym kliknięciem.`,
    chip: "Koszyk",
    eyebrow: "Zapisany koszyk",
    title: (name) => ({ before: name ? `${name}, Twój koszyk ` : "Twój koszyk ", accent: "wciąż czeka", after: "." }),
    intro: (what) => `Zapisaliśmy ${what}. Jedno kliknięcie i wracasz do zamówienia w tym samym miejscu.`,
    value: "Wartość koszyka",
    inCart: "W koszyku",
    note: "Produktów nie rezerwujemy, więc ich dostępność może się zmienić.",
    button: "Wróć do koszyka",
  },
  negotiation: {
    labels: { countered: "Negocjacja: nowa propozycja", accepted: "Negocjacja: cena uzgodniona", rejected: "Negocjacja: zamknięta" },
    descriptions: {
      countered: "Sklep odpowiada na zapytanie o cenę propozycją",
      accepted: "Negocjacja kończy się uzgodnioną ceną",
      rejected: "Negocjacja kończy się bez porozumienia",
    },
    chip: (ref) => (ref ? `Negocjacja ${ref}` : "Negocjacja"),
    slipLabel: "Negocjacja",
    quantity: "Ilość",
    price: "Cena",
    pricePerUnit: "Cena za sztukę",
    priceCart: "Cena za koszyk",
    validUntil: "Propozycja ważna do",
    product: "Produkt",
    variant: "Wariant",
    countered: {
      subject: (ref) => (ref ? `Negocjacja ${ref}: nowa propozycja ceny` : "Nowa propozycja ceny"),
      preheader: "Odpowiedzieliśmy na Twoje zapytanie o cenę. Sprawdź propozycję i zdecyduj na swoim koncie.",
      eyebrow: "Negocjacja ceny",
      title: { before: "Mamy dla Ciebie ", accent: "nową propozycję", after: "." },
      intro: "Odpowiedzieliśmy na Twoje zapytanie o cenę. Sprawdź propozycję poniżej i zdecyduj na swoim koncie.",
      status: "Propozycja",
      button: "Zobacz propozycję",
    },
    accepted: {
      subject: (ref) => (ref ? `Negocjacja ${ref}: cena uzgodniona` : "Cena uzgodniona"),
      preheader: "Cena jest uzgodniona. Możesz złożyć zamówienie.",
      eyebrow: "Negocjacja zakończona",
      title: { before: "Mamy ", accent: "porozumienie", after: "." },
      intro: "Cena jest uzgodniona. Szczegóły są poniżej, a zamówienie złożysz na swoim koncie.",
      status: "Uzgodniona",
      button: "Przejdź do negocjacji",
    },
    rejected: {
      subject: (ref) => (ref ? `Negocjacja ${ref} zakończona bez porozumienia` : "Negocjacja zakończona bez porozumienia"),
      preheader: "Tym razem nie udało się uzgodnić ceny.",
      eyebrow: "Negocjacja zakończona",
      title: { before: "Tym razem ", accent: "bez porozumienia", after: "." },
      intro: "Nie udało się uzgodnić ceny. Możesz zaproponować inną cenę albo ilość, chętnie wrócimy do rozmowy.",
      status: "Zamknięta",
      button: "Zobacz negocjację",
    },
  },
}

export const COPY: Record<EmailLocale, TemplateCopy> = { en, pl }
