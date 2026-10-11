import { communityEn } from "../lib/kit-kit-community"
import { integrationEn } from "../../modules/kit/lib/integration-texts"

const en = {
  nav: "Kit",
  title: "Kit",
  by: "by Koda Plus",
  subtitle: "The newsletter of the store on the Kit list: the storefront form subscribes customers with tags and double opt-in, the log shows every sign-up.",
  view: {
    panel: "Panel",
    guide: "Setup guide",
  },
  error: "Could not load the page: {{message}}",
  mode: {
    off: "Not configured",
  },
  stats: {
    subscribed: "Subscribers from the store",
    failed: "Failed sign-ups",
    week: "Sign-ups, last 7 days",
    account: "Kit account",
  },
  account: {
    none: "No account yet - add the API key.",
    plan: "Plan {{plan}}",
  },
  status: {
    configured: "Connected",
    unconfigured: "The Kit API key is missing - the form answers politely and nothing is sent.",
    missing: "Missing: {{what}}",
    problems: "Ignored options: {{what}}",
  },
  settings: {
    title: "List settings",
    subtitle: "What every new subscriber gets. Saved here, per store.",
    tags: "Tags",
    tagsHint: "Applied to every new subscriber (Kit: tags).",
    tagsEmpty: "The account has no tags yet - create them in Kit first.",
    form: "Double opt-in form",
    formHint: "With double opt-in, new subscribers are added to this form and Kit sends the confirmation email.",
    formNone: "No double opt-in form chosen.",
    doubleOptIn: "Double opt-in",
    doubleOptInHint: "The subscriber waits for the confirmation email before receiving anything.",
    save: "Save",
    saved: "Saved",
    saving: "Saving...",
  },
  subscribers: {
    title: "Subscription log",
    subtitle: "Every sign-up the storefront form sent to Kit.",
    empty: "Nobody signed up yet.",
    email: "E-mail",
    state: "State",
    tags: "Tags",
    source: "Source",
    when: "When",
    statusOk: "ok",
    statusFailed: "failed",
    stateActive: "active",
    stateInactive: "waiting for confirmation",
    stateNone: "-",
  },
  check: {
    title: "Connection check",
    run: "Check connection",
    running: "Checking...",
    ok: "The account answers: {{name}}",
    tags: "{{n}} tags",
    forms: "{{n}} forms",
  },
  guide: {
    steps: [
      "In Kit, open Settings, Developer, API keys and create a V4 API key. Put it in KIT_API_KEY on the backend.",
      "Create the tags for the store (for example: sklep, klub-stonerow) in Kit, Subscribers, Tags.",
      "For double opt-in, create an embed form in Kit with double opt-in switched on.",
      "In Settings pick the tags and the form, save, and sign the test form up.",
    ],
  },
  community: communityEn,
  integration: integrationEn,
}

export default en
