import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import type { StatusResponse } from "../../modules/tasks/lib/contract"
import { GuideChecklist, GuideDiagram, GuideFaq, GuideIntro, GuideSteps, References, type GuideStep, type SetupPromptSpec, type StepState } from "./tasks-guide"
import { fmtRating, kitReferences } from "./tasks-ui"

/*
 * The "Setup guide" view: what the setup takes, how the parts talk, the
 * steps with their live state, a checklist, troubleshooting and the stores
 * running the plugin. Every sentence comes from the i18n files; the code
 * blocks are English, like the code they go into.
 */

const INSTALL = `npm install @koda-plus/medusa-plugin-tasks
npx medusa db:migrate`

const CONFIG = `// medusa-config.ts
plugins: [
  {
    resolve: "@koda-plus/medusa-plugin-tasks",
    options: {
      // agencyAccounts: ["@your-agency.com"], // their comments read as the agency's
      // sandboxAccounts: ["demo@your-store.com"], // a public demo account: the sandbox board only
      // sandboxGuard: true, // the demo account: no invites, users or API keys, no writes outside Tasks
      // sandboxResetHours: 24, // sample tasks come back after this long (0: only on reset)
      // agentKeyPrefix: "tasks:", // secret API keys titled "tasks: ..." reach only Tasks (the default)
      // references: [], // stores running the plugin, shown on this page
    },
  },
],`

const ENV = `TASKS_SANDBOX_ACCOUNTS=demo@your-store.com   # optional, comma separated`

const PROMPT_CONFIG = `// medusa-config.ts
plugins: [
  {
    resolve: "@koda-plus/medusa-plugin-tasks",
    options: {
      sandboxAccounts: (process.env.TASKS_SANDBOX_ACCOUNTS ?? "").split(",").filter(Boolean),
      sandboxGuard: true, // sandbox accounts stay inside Tasks
      // agencyAccounts: ["@your-agency.com"],
    },
  },
],`

const TEAM = `agencyAccounts: ["@your-agency.com", "freelancer@example.com"],`

const PEOPLE = `people: [
  // Free text names on the board, matched without case. Photos: a data:image URI or an https URL.
  { name: "Anna", avatar: "https://cdn.your-store.com/team/anna.webp", role: { en: "Store manager", pl: "Kierowniczka sklepu" } },
  { name: "Frontend", role: "The agency's frontend team" },
  { name: "Claude Code", kind: "agent", role: "AI agent in our repository" },
],`

const AUTOMATION = `# A secret API key from Settings, Secret API Keys, titled "tasks: Support agent":
# the "tasks:" prefix keeps it inside Tasks (403 on every other admin route).
# One key per agent, in the server's environment, never in a prompt.
KEY=sk_...
URL=https://api.your-store.com

# A task linked to an order, signed with the agent's name
curl -u "$KEY:" -X POST "$URL/admin/tasks/tasks" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Refund the damaged item","priority":"high","links":[{"type":"order","id":"order_01..."}],"author":"Support agent"}'

# Move it to In review (at the end of the column)
curl -u "$KEY:" -X POST "$URL/admin/tasks/tasks/task_01.../move" \\
  -H "Content-Type: application/json" -d '{"status":"review","author":"Support agent"}'

# A comment: stored with the role claude, shown as AI agent
curl -u "$KEY:" -X POST "$URL/admin/tasks/tasks/task_01.../comments" \\
  -H "Content-Type: application/json" -d '{"body":"Refund issued, the customer got an e-mail.","author":"Support agent"}'`

const EVENTS = `// src/subscribers/tasks-notify.ts
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

type TaskEvent = { id: string; board: string; title: string; status: string; previous_status: string | null; demo: boolean }

export default async function tasksNotify({ event }: SubscriberArgs<TaskEvent>) {
  if (event.data.demo) return // the sandbox board: never notify anyone
  if (event.data.status === "review") {
    // post to Slack or Discord: \`\${event.data.title} is ready for review\`
  }
}

export const config: SubscriberConfig = { event: ["tasks.task.status_changed"] }`

const SANDBOX = `sandboxAccounts: ["demo@your-store.com"], // sees and changes only the sandbox board
sandboxGuard: true, // and stays away from invites, users, API keys and writes outside Tasks
sandboxResetHours: 24, // the sample tasks come back after this long`

/** What the store owner prepares, in the order of the guide. */
const NEEDS = ["medusa", "accounts", "apiKey", "demo"] as const

const FAQ = ["board", "apiKey", "author", "notFound", "drag", "sandbox", "adopted"] as const

/** The same setup as this guide (steps "install" and "sandbox"), for "Copy prompt" in the page header. */
export function usePromptSpec(): SetupPromptSpec {
  const { t } = useTranslation("tasks")
  return useMemo(
    () => ({
      service: "Tasks",
      pkg: "@koda-plus/medusa-plugin-tasks",
      route: "/app/tasks",
      summary: t("subtitle"),
      needs: NEEDS.map((k) => t(`guide.intro.needs.${k}`)),
      config: `# .env\n${ENV}\n\n${PROMPT_CONFIG}`,
      demo: 'sandboxAccounts: (process.env.TASKS_SANDBOX_ACCOUNTS ?? "").split(",").filter(Boolean),',
    }),
    [t],
  )
}

export function GuideView({ status }: { status: StatusResponse }) {
  const { t, i18n } = useTranslation("tasks")
  const lang = i18n.language || "en"
  const c = status.counts
  const o = status.options
  const state = (done: boolean, otherwise: StepState = "optional"): StepState => (done ? "done" : otherwise)
  const p = (key: string, values?: Record<string, unknown>) => <p key={key}>{t(key, values)}</p>

  const steps: GuideStep[] = [
    {
      id: "install",
      title: t("guide.steps.install.title"),
      state: "done",
      body: [p("guide.steps.install.p1"), p("guide.steps.install.p2")],
      code: `${INSTALL}\n\n${CONFIG}`,
      check: t("guide.steps.install.check"),
    },
    {
      id: "team",
      title: t("guide.steps.team.title"),
      state: state(o.agency_account_count > 0),
      body: [p("guide.steps.team.p1"), p("guide.steps.team.p2")],
      code: TEAM,
      check: t("guide.steps.team.check"),
    },
    {
      id: "people",
      title: t("guide.steps.people.title"),
      state: state(status.named_people.length > 0),
      body: [p("guide.steps.people.p1"), p("guide.steps.people.p2")],
      code: PEOPLE,
      check: t("guide.steps.people.check"),
    },
    {
      id: "links",
      title: t("guide.steps.links.title"),
      state: "optional",
      body: [p("guide.steps.links.p1"), p("guide.steps.links.p2")],
      check: t("guide.steps.links.check"),
    },
    {
      id: "automation",
      title: t("guide.steps.automation.title"),
      state: state(status.automation.api_key_activity > 0),
      body: [p("guide.steps.automation.p1"), p("guide.steps.automation.p2"), p("guide.steps.automation.p3")],
      code: AUTOMATION,
      check: t("guide.steps.automation.check"),
    },
    {
      id: "events",
      title: t("guide.steps.events.title"),
      state: "optional",
      body: [p("guide.steps.events.p1"), p("guide.steps.events.p2")],
      code: EVENTS,
      check: t("guide.steps.events.check"),
    },
    {
      id: "sandbox",
      title: t("guide.steps.sandbox.title"),
      state: state(status.sandbox_board.enabled),
      body: [p("guide.steps.sandbox.p1"), p("guide.steps.sandbox.p2"), p("guide.steps.sandbox.p3")],
      code: `${SANDBOX}\n\n# .env\n${ENV}`,
      check: t("guide.steps.sandbox.check"),
    },
  ]
  if (status.adoption) {
    steps.push({
      id: "adopt",
      title: t("guide.steps.adopt.title"),
      state: status.adoption.state === "adopted" ? "done" : "todo",
      body: [p("guide.steps.adopt.p1"), p("guide.steps.adopt.p2")],
      check: t("guide.steps.adopt.check"),
    })
  }

  const checklist = [
    { label: t("guide.checklist.board"), done: c.all > 0 },
    { label: t("guide.checklist.assigned"), done: c.open > 0 && c.unassigned === 0 },
    { label: t("guide.checklist.overdue"), done: c.overdue === 0, hint: c.overdue > 0 ? t("guide.checklist.overdueHint", { count: c.overdue }) : undefined },
    { label: t("guide.checklist.agency"), done: o.agency_account_count > 0 },
    { label: t("guide.checklist.automation"), done: status.automation.api_key_activity > 0 },
    { label: t("guide.checklist.sandbox"), done: status.sandbox_board.enabled },
  ]

  const faq = FAQ.map((k) => ({
    q: t(`guide.faq.${k}.q`),
    a: [<p key="a1">{t(`guide.faq.${k}.a1`)}</p>, <p key="a2">{t(`guide.faq.${k}.a2`)}</p>],
  }))

  return (
    <div className="flex flex-col gap-y-3">
      <GuideIntro
        title={t("guide.intro.title")}
        text={t("guide.intro.text")}
        time={t("guide.intro.time")}
        timeLabel={t("guide.intro.timeLabel")}
        needsLabel={t("guide.intro.needsLabel")}
        needs={NEEDS.map((k) => t(`guide.intro.needs.${k}`))}
      />
      <GuideDiagram
        title={t("guide.diagram.title")}
        subtitle={t("guide.diagram.subtitle")}
        nodes={[
          { title: t("guide.diagram.teamTitle"), caption: t("guide.diagram.team") },
          { title: `${t("title")} ${t("by")}`, caption: t("guide.diagram.plugin"), accent: true },
          { title: t("guide.diagram.agentsTitle"), caption: t("guide.diagram.agents") },
          { title: t("guide.diagram.eventsTitle"), caption: t("guide.diagram.events") },
        ]}
        links={[t("guide.diagram.link1"), t("guide.diagram.link2"), t("guide.diagram.link3")]}
      />
      <GuideSteps
        title={t("guide.stepsTitle")}
        subtitle={t("guide.stepsSubtitle")}
        steps={steps}
        stateLabels={{ done: t("guide.state.done"), todo: t("guide.state.todo"), optional: t("guide.state.optional"), later: t("guide.state.later") }}
        checkLabel={t("guide.checkLabel")}
        copyLabel={t("guide.copy")}
        copiedLabel={t("guide.copied")}
      />
      <GuideChecklist title={t("guide.checklist.title")} subtitle={t("guide.checklist.subtitle")} items={checklist} />
      <GuideFaq title={t("guide.faq.title")} items={faq} />
      <References
        items={kitReferences(status.references, lang)}
        title={t("references.title")}
        subtitle={t("references.subtitle")}
        openLabel={t("references.open")}
        soonLabel={t("references.soon")}
        reviewLabel={t("references.review")}
        ratingLabel={(value) => fmtRating(value, lang)}
      />
    </div>
  )
}
