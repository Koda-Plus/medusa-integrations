import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowPath, DocumentText, ListBullet, MapPin, ShieldCheck, Trash, TruckFast } from "@medusajs/icons"
import { Container, InlineTip, toast, usePrompt } from "@medusajs/ui"
import type { ShipmentFilter, ShipmentGroup, StatusResponse } from "../../../modules/dpd/lib/contract"
import { dpdKeys, errorMessage, useDpdDemoReset, useDpdDemoSeed, useDpdStatus } from "../../lib/dpd-api"
import { StatTile, StatTiles, type Tone } from "../../lib/dpd-blocks"
import { AddStoreButton, HelpButtons, IntegrationHeader, ModeBadge, SettingsView, communityLabels, usePageNav, type HeaderAction, type PageNav } from "../../lib/dpd-guide"
import { GuideView, usePromptSpec } from "../../lib/dpd-guide-view"
import { DpdIcon, DpdMark } from "../../lib/dpd-icon"
import { KitLoading } from "../../lib/dpd-kit"
import { DemoDetails, FILTERS, ShipmentsSection } from "../../lib/dpd-panel"
import { AccountSection, SETTINGS_TABS, SenderSection, WritersSection, type SettingsTabId } from "../../lib/dpd-settings"
import { GROUP_ICON, fmtNumber, modeOf, useSenderProblemText } from "../../lib/dpd-ui"

/**
 * DPD by Koda Plus. Three views, switched in the header and kept in the URL:
 *
 * - Panel: the DPD shipments and returns next to their orders, in the
 *   lists of the contract (to create, labeled, handed over, in transit,
 *   delivered, problems, canceled, returns). The counters under the header
 *   filter the list.
 * - Setup guide (`?view=guide`): the steps with their live state.
 * - Settings (`?view=settings&tab=`): the DPD account as the options set it,
 *   the sender, the writers.
 *
 * Deep links from hosts and boards: `/dpd?filter=problems`, `/dpd?q=1042`.
 *
 * DPD has its own sidebar entry; it is not a tab of another carrier's page.
 */

/* The counters under the header; each one is a filter of the list. Orange and red only while there is something to do. */
const TILES: Array<{ key: ShipmentGroup; tone: Tone }> = [
  { key: "to_create", tone: "orange" },
  { key: "labeled", tone: "blue" },
  { key: "handed_over", tone: "blue" },
  { key: "in_transit", tone: "blue" },
  { key: "delivered", tone: "green" },
  { key: "problems", tone: "red" },
]

const DpdPage = () => {
  const { t, i18n } = useTranslation("dpd")
  const lang = i18n.language || "en"
  const client = useQueryClient()
  const nav = usePageNav(SETTINGS_TABS)
  const status = useDpdStatus()
  /* Refresh reads every DPD query again, so the counters and the list never disagree. The button spins for
     that refresh only, never for a search, a page or the 60 s poll running in the background. */
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await client.invalidateQueries({ queryKey: dpdKeys.all })
    } finally {
      setRefreshing(false)
    }
  }
  const s = status.data
  /* Deep links from hosts and boards: /dpd?filter=to_create, /dpd?q=1042. */
  const [params] = useSearchParams()
  const [filter, setFilter] = useState<ShipmentFilter>(() => {
    const asked = params.get("filter")
    return asked && (FILTERS as readonly string[]).includes(asked) ? (asked as ShipmentFilter) : "all"
  })
  const [initialQuery] = useState(() => (params.get("q") ?? "").slice(0, 100))

  /* Demo mode: the sample shipments are built once, on the first visit (reads never write).
     A reset clears the marker; once the reset has landed the page asks again (rearm runs the effect
     even when the status it already holds says the samples are missing). */
  const seed = useDpdDemoSeed()
  const asked = useRef(false)
  const [rearm, setRearm] = useState(0)
  useEffect(() => {
    if (asked.current || !s || s.mode !== "demo" || s.demoSeeded) return
    asked.current = true
    seed.mutate()
  }, [s, seed, rearm])
  const seeding = seed.isPending || (s?.mode === "demo" && !s.demoSeeded && !asked.current && !seed.isError)

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header
          status={s}
          lang={lang}
          nav={nav}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          onResetDone={() => {
            asked.current = false
            seed.reset()
            setRearm((n) => n + 1)
          }}
        />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {!s && status.isLoading ? <KitLoading label={t("loading")} /> : null}
        {s && nav.view === "panel" && seed.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("demo.seedFailedLabel")}>
              {t("demo.seedFailed", { message: errorMessage(seed.error) })}{" "}
              <button type="button" className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover" onClick={() => seed.mutate()}>
                {t("demo.retry")}
              </button>
            </InlineTip>
          </div>
        ) : null}
        {/* Panel only: Settings shows the same notes in its own tabs. */}
        {s && nav.view === "panel" ? <Warnings status={s} onSettings={(tab) => nav.go("settings", tab)} /> : null}
        {s && nav.view === "panel" ? (
          <StatTiles columns={6}>
            {TILES.map((g) => (
              <StatTile
                key={g.key}
                icon={GROUP_ICON[g.key]}
                label={t(`shipments.filter.${g.key}`)}
                value={fmtNumber(s.counts[g.key], lang)}
                tone={s.counts[g.key] > 0 ? g.tone : "grey"}
                active={filter === g.key}
                onClick={() => setFilter(filter === g.key ? "all" : g.key)}
              />
            ))}
          </StatTiles>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} /> : null}

      {s && nav.view === "panel" ? <ShipmentsSection status={s} lang={lang} filter={filter} onFilter={setFilter} initialQuery={initialQuery} seeding={seeding} seedFailed={seed.isError} /> : null}

      {s && nav.view === "settings" ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "account", label: t("settings.tab.account"), badge: s.mode === "demo" ? null : s.missing.length + s.optionProblems.length, tone: "orange" },
            { id: "sender", label: t("settings.tab.sender"), badge: s.senderProblems.length, tone: "orange" },
            /* Armed, or still armed while the options turn it off: both orange in the Writers tab. */
            { id: "writers", label: t("settings.tab.writers"), badge: Object.values(s.writers).filter((w) => w.on).length, tone: "orange" },
          ]}
        >
          {nav.tab === "account" ? <AccountSection status={s} /> : null}
          {nav.tab === "sender" ? <SenderSection status={s} /> : null}
          {nav.tab === "writers" ? <WritersSection status={s} lang={lang} /> : null}
        </SettingsView>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Header({
  status,
  lang,
  nav,
  refreshing,
  onRefresh,
  onResetDone,
}: {
  status: StatusResponse | undefined
  lang: string
  nav: PageNav<SettingsTabId>
  /** The person's own refresh is in flight. */
  refreshing: boolean
  onRefresh: () => void
  /** Called once the reset has landed, so the page builds the sample shipments again. */
  onResetDone: () => void
}) {
  const { t } = useTranslation("dpd")
  const prompt = usePrompt()
  const reset = useDpdDemoReset()
  const mode = modeOf(status)
  const armed = status ? Object.values(status.writers).filter((w) => w.armed).length : 0
  /* Still armed while the options turn it off: it does not write, but it waits to be disarmed. */
  const stale = status ? Object.values(status.writers).filter((w) => w.on && !w.allowed).length : 0
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)

  const onReset = async () => {
    const yes = await prompt({ title: t("demo.resetTitle"), description: t("demo.resetText"), confirmText: t("demo.resetConfirm"), cancelText: t("demo.back") })
    if (!yes) return
    try {
      await reset.mutateAsync()
      onResetDone()
      toast.success(t("toast.reset"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  /* Refresh first; nothing here talks to DPD. */
  const actions: HeaderAction[] = [
    {
      key: "refresh",
      label: t("actions.refresh"),
      icon: <ArrowPath />,
      loading: refreshing,
      onClick: onRefresh,
    },
  ]
  if (status?.mode === "demo") actions.push({ key: "reset", label: t("actions.resetDemo"), icon: <Trash />, loading: reset.isPending, onClick: () => void onReset() })

  return (
    <IntegrationHeader
      icon={<DpdMark />}
      title={t("title")}
      badges={
        status ? (
          <>
            <ModeBadge color={mode.tone} label={t(`mode.${mode.key}`)} title={t("demo.label")}>
              {status.mode === "demo" ? <DemoDetails status={status} /> : null}
            </ModeBadge>
            {armed > 0 ? (
              <ModeBadge color="orange" label={t("mode.writing", { count: armed })} title={t("writers.title")}>
                <span>{t("writers.later")}</span>
              </ModeBadge>
            ) : (
              <ModeBadge color="grey" label={t("mode.readOnly")} />
            )}
            {stale > 0 ? (
              <ModeBadge color="orange" label={t("mode.stale", { count: stale })} title={t("writers.title")}>
                <span>{t("mode.staleHint")}</span>
              </ModeBadge>
            ) : null}
          </>
        ) : null
      }
      description={t("subtitle")}
      points={[
        { icon: <TruckFast />, text: t("points.options") },
        { icon: <MapPin />, text: t("points.pickup") },
        { icon: <DocumentText />, text: t("points.recorded") },
        { icon: <ListBullet />, text: t("points.panel") },
        { icon: <ShieldCheck />, text: t("points.armed"), tone: "green" },
      ]}
      social={<AddStoreButton labels={community.addStore} />}
      help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
      view={nav.view}
      onView={(v) => nav.go(v)}
      labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("settings.title"), more: t("actions.moreActions") }}
      actions={nav.view !== "guide" ? actions : []}
    />
  )
}

/** Only what needs a person now, each with the Settings tab that explains it; the demo note lives in the mode badge. */
function Warnings({ status, onSettings }: { status: StatusResponse; onSettings: (tab: SettingsTabId) => void }) {
  const { t } = useTranslation("dpd")
  const senderText = useSenderProblemText()
  const notes: Array<{ key: string; variant: "warning" | "error"; label: string; text: string; tab: SettingsTabId | null }> = []
  if (status.mode !== "demo" && status.missing.length > 0) notes.push({ key: "missing", variant: "warning", label: t("missing.label"), text: t("missing.text", { missing: status.missing.join(", ") }), tab: "account" })
  if (status.optionProblems.length > 0) notes.push({ key: "options", variant: "warning", label: t("missing.optionsLabel"), text: t("missing.options", { list: status.optionProblems.join("; ") }), tab: "account" })
  if (status.senderProblems.length > 0) {
    const first = senderText(status.senderProblems[0])
    const more = status.senderProblems.length - 1
    notes.push({ key: "sender", variant: "warning", label: t("missing.senderLabel"), text: more > 0 ? t("missing.senderMore", { first, count: more }) : first, tab: "sender" })
  }
  if (status.counts.attention > 0) notes.push({ key: "attention", variant: "error", label: t("missing.attentionLabel"), text: t("missing.attention", { count: status.counts.attention }), tab: null })
  if (notes.length === 0) return null
  return (
    <div className="flex flex-col gap-y-2 px-6 py-4">
      {notes.map((n) => (
        <InlineTip key={n.key} variant={n.variant} label={n.label}>
          {n.text}
          {n.tab ? (
            <>
              {" "}
              <button type="button" className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover" onClick={() => onSettings(n.tab ?? "account")}>
                {t("missing.open")}
              </button>
            </>
          ) : null}
        </InlineTip>
      ))}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "DPD",
  rank: 4,
  icon: DpdIcon,
})

export default DpdPage
