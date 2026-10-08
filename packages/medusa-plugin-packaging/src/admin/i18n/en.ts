import { communityEn } from "../lib/packaging-kit-community"
import { integrationEn } from "../../modules/packaging/lib/integration-texts"

const en = {
  nav: "Packaging",
  title: "Packaging",
  by: "by Koda Plus",
  subtitle: "The wholesale packaging ladder of the catalog: piece, box and pallet, the minimum order and the order step, the EAN codes and the SSCC labels.",
  mode: {
    demo: "Demo",
  },
  error: "Could not load the page: {{message}}",
  stats: {
    products: "Products",
    moq: "With a minimum order",
    sscc: "With SSCC",
    units: "Ladder units",
  },
  products: {
    title: "Packaging ladders",
    subtitle: "Every catalog product with its ladder, the minimum order and the order step. A click opens the editor.",
    empty: "No products in the catalog.",
    sku: "SKU",
    product: "Product",
    ladder: "Ladder",
    moq: "Minimum",
    step: "Step",
    unset: "Not set",
    edit: "Edit",
  },
  sscc: {
    title: "SSCC labels",
    subtitle: "The label number of a pallet: the GS1 prefix {{prefix}} and a serial make the 18-digit SSCC with its check digit.",
    placeholder: "Serial, e.g. 000001",
    payload: "GS1-128 payload",
  },
  editor: {
    moq: "Minimum order (pieces)",
    step: "Order step (pieces)",
    box: "Box: pieces",
    boxEan: "Box EAN",
    pallet: "Pallet: pieces",
    ssccPrefix: "Pallet SSCC prefix",
    save: "Save",
    cancel: "Cancel",
  },
  toast: {
    saved: "Saved",
    error: "Something went wrong: {{error}}",
  },
  community: communityEn,
  integration: integrationEn,
}

export default en
