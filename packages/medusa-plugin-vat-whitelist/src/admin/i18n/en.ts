import { communityEn } from "../lib/whitelist-kit-community"
import { integrationEn } from "../../modules/whitelist/lib/integration-texts"

const en = {
  nav: "Whitelist",
  title: "VAT Whitelist",
  by: "by Koda Plus",
  subtitle: "Verify a Polish NIP against the Ministry of Finance whitelist and EU VAT numbers against VIES: the VAT status, the bank accounts for split payment, and the check history.",
  mode: {
    demo: "Demo",
  },
  error: "Could not load the page: {{message}}",
  stats: {
    entities: "Counterparties",
    active: "Active VAT",
    exempt: "VAT exempt",
    notFound: "Not found",
  },
  check: {
    title: "Check a counterparty",
    subtitle: "A Polish NIP (10 digits) goes to the whitelist, an EU VAT number to VIES. An answer stays valid for {{hours}} hours.",
    placeholder: "NIP or EU VAT number",
    run: "Check",
  },
  entities: {
    title: "Counterparties",
    subtitle: "The latest registry answer per number, refreshed by a re-check. The NIP links to the customer when the check was about one.",
    empty: "Nothing checked yet. Enter a NIP above.",
    nip: "NIP",
    name: "Name",
    state: "Status",
    accounts: "Accounts",
    checked: "Checked",
    stale: "stale",
    recheck: "Check again",
    accountsCount: "{{count}}",
  },
  checks: {
    title: "Check history",
    subtitle: "Every run of a check, newest first.",
    empty: "No checks yet.",
    when: "When",
    nip: "Number",
    source: "Registry",
    state: "Answer",
  },
  source: {
    whitelist: "Whitelist (MF)",
    vies: "VIES",
    gus: "GUS (REGON)",
  },
  state: {
    active: "Active",
    exempt: "Exempt",
    not_found: "Not found",
    invalid: "Invalid",
    unavailable: "Unavailable",
  },
  result: {
    active: "{{name}}: active VAT payer",
    exempt: "{{name}}: VAT exempt",
    not_found: "{{name}}: not in the registry",
    invalid: "The number does not validate",
    unavailable: "The registry could not answer, try again later",
    title: "Check result",
    accounts: "Registry accounts",
    krs: "KRS",
    regon: "REGON",
  },
  toast: {
    error: "Something went wrong: {{error}}",
  },
  community: communityEn,
  integration: integrationEn,
}

export default en
