import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowPath, DocumentText, HandTruck, ListBullet, MapPin, ShieldCheck, Trash, TruckFast } from "@medusajs/icons"
import { Container, InlineTip, toast, usePrompt } from "@medusajs/ui"
import type { DispatchFilter, ShipmentFilter, ShipmentGroup, StatusResponse } from "../../../modules/dpd/lib/contract"
import { dpdKeys, errorMessage, useDpdDemoReset, useDpdDemoSeed, useDpdStatus } from "../../lib/dpd-api"
import { StatTile, StatTiles, type Tone } from "../../lib/dpd-blocks"
import { HelpButtons, IntegrationHeader, ModeBadge, SettingsView, communityLabels, usePageNav, type HeaderAction, type PageNav } from "../../lib/dpd-guide"
import { GuideView, usePromptSpec } from "../../lib/dpd-guide-view"
import { DpdIcon, DpdMark } from "../../lib/dpd-icon"
import { DispatchDrawer, DispatchesSection } from "../../lib/dpd-dispatch"
import { KitLoading } from "../../lib/dpd-kit"
import { dispatchFilterOf, writerFailedOf, writerFailedParams, writingWriters } from "../../lib/dpd-logic"
import { DemoDetails, FILTERS, ShipmentsSection } from "../../lib/dpd-panel"
import { AccountSection, SETTINGS_TABS, SenderSection, WritersSection, type SettingsTabId } from "../../lib/dpd-settings"
import { GROUP_ICON, fmtDateTime, fmtNumber, modeOf, useSenderProblemText } from "../../lib/dpd-ui"

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
 * Deep links from hosts and boards: `/dpd?filter=problems`, `/dpd?q=1042`,
 * `/dpd?writer=failed` (the status writes Medusa did not take); the handovers: `/dpd?view=dispatches&filter=attention` (the panel, at the
 * handover list), `/dpd?dispatch=<id>` (one handover in its drawer).
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
  /* Deep links from hosts and boards: /dpd?filter=to_create, /dpd?q=1042, /dpd?view=dispatches&filter=attention. */
  const [params, setParams] = useSearchParams()
  /* The kit knows panel, guide and settings; "dispatches" is the panel at the handover list, its filter is the list's. */
  const atDispatches = params.get("view") === "dispatches"
  const [filter, setFilter] = useState<ShipmentFilter>(() => {
    const asked = params.get("filter")
    return !atDispatches && asked && (FILTERS as readonly string[]).includes(asked) ? (asked as ShipmentFilter) : "all"
  })
  /* ?writer=failed: only the rows whose status Medusa did not take (the integration tile links here). Kept in the URL. */
  const [writerFailed, setWriterFailedState] = useState(() => writerFailedOf(params.get("writer")))
  const askedWriter = writerFailedOf(params.get("writer"))
  useEffect(() => setWriterFailedState(askedWriter), [askedWriter])
  /* One write of the URL per change, with the shipment filter the page shows (a reload never brings back a stale ?filter or ?q). */
  const writeWriterFailed = (on: boolean, f: ShipmentFilter, clearSearch: boolean) => {
    setWriterFailedState(on)
    setParams(writerFailedParams(params, on, { atDispatches, filter: f, clearSearch }), { replace: true })
  }
  const setWriterFailed = (on: boolean) => writeWriterFailed(on, filter, false)
  /*
   * The header note counts every row whose status Medusa did not take, so its button shows all of them:
   * the group filter and the search go, the writer filter comes on, in the page and in the URL.
   * The filter bar button joins them instead (10.6).
   */
  const [searchReset, setSearchReset] = useState(0)
  const showWriterFailed = () => {
    setFilter("all")
    setSearchReset((n) => n + 1)
    writeWriterFailed(true, "all", true)
  }
  const [dispatchFilter, setDispatchFilter] = useState<DispatchFilter>(() => (atDispatches ? dispatchFilterOf(params.get("filter")) : "open"))
  /* Each request to show the handover list scrolls to it once it is on the page, and only once: a new status (after any action, the poll) is no request. */
  const [scrollTo, setScrollTo] = useState(atDispatches ? 1 : 0)
  const scrolled = useRef(0)
  useEffect(() => {
    if (scrollTo <= scrolled.current || !status.data) return
    const section = document.getElementById("dpd-dispatches")
    if (!section) return
    scrolled.current = scrollTo
    section.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [scrollTo, status.data])
  const showDispatches = (f: DispatchFilter) => {
    setDispatchFilter(f)
    const p = new URLSearchParams(params)
    p.set("view", "dispatches")
    p.set("filter", f)
    p.delete("tab")
    setParams(p, { replace: true })
    setScrollTo((n) => n + 1)
  }
  /*
   * One handover in its drawer, from ?dispatch=<id> (the order card links here); closing drops the parameter.
   * Opened from this page it is a history entry of its own, so closing goes back to the entry it came from
   * (Back leaves the page at once, never lands on the same page); from a link, closing replaces the entry.
   */
  const navigate = useNavigate()
  const openDispatch = params.get("dispatch")
  const pushed = useRef(false)
  useEffect(() => {
    if (!openDispatch) pushed.current = false
  }, [openDispatch])
  const setOpenDispatch = (id: string | null) => {
    if (!id && pushed.current) {
      pushed.current = false
      navigate(-1)
      return
    }
    const p = new URLSearchParams(params)
    if (id) p.set("dispatch", id)
    else p.delete("dispatch")
    pushed.current = Boolean(id)
    setParams(p, { replace: !id })
  }
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
        {s && nav.view === "panel" ? <Warnings status={s} lang={lang} onSettings={(tab) => nav.go("settings", tab)} onWriterFailed={showWriterFailed} /> : null}
        {s && nav.view === "panel" ? (
          <StatTiles columns={7}>
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
            {/* The handovers that need a person (DS18): a filter of the handover list, not of the shipments. */}
            <StatTile
              icon={<HandTruck />}
              label={t("dispatch.tileAttention")}
              value={fmtNumber(s.counts.dispatchesAttention, lang)}
              tone={s.counts.dispatchesAttention > 0 ? "red" : "grey"}
              active={atDispatches && dispatchFilter === "attention"}
              onClick={() => showDispatches("attention")}
            />
          </StatTiles>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} /> : null}

      {s && nav.view === "panel" ? (
        <ShipmentsSection
          status={s}
          lang={lang}
          filter={filter}
          onFilter={setFilter}
          writerFailed={writerFailed}
          onWriterFailed={setWriterFailed}
          initialQuery={initialQuery}
          searchReset={searchReset}
          seeding={seeding}
          seedFailed={seed.isError}
          onSettings={() => nav.go("settings", "writers")}
          onOpenDispatch={(id) => setOpenDispatch(id)}
        />
      ) : null}

      {s && nav.view === "panel" ? <DispatchesSection filter={dispatchFilter} onFilter={(f) => (atDispatches ? showDispatches(f) : setDispatchFilter(f))} onOpen={(id) => setOpenDispatch(id)} /> : null}

      {s && openDispatch ? <DispatchDrawer dispatchId={openDispatch} lang={lang} onClose={() => setOpenDispatch(null)} onSettings={() => nav.go("settings", "writers")} /> : null}

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
  /* Only the writers that write in this version (LATER_WRITERS): every armed writer writes since stage 5. */
  const armedWriters = writingWriters(status?.writers)
  const armed = armedWriters.length
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
                <span>{armedWriters.map((w) => t(`writers.names.${w.key}`)).join(", ")}</span>
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
      help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
      view={nav.view}
      onView={(v) => nav.go(v)}
      labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("settings.title"), more: t("actions.moreActions") }}
      actions={nav.view !== "guide" ? actions : []}
    />
  )
}

/**
 * Only what needs a person now, each with the Settings tab that explains it
 * (the status writes Medusa did not take: the list filtered to them); the
 * demo note lives in the mode badge, the queue mode note in Settings only.
 */
function Warnings({ status, lang, onSettings, onWriterFailed }: { status: StatusResponse; lang: string; onSettings: (tab: SettingsTabId) => void; onWriterFailed: () => void }) {
  const { t } = useTranslation("dpd")
  const senderText = useSenderProblemText()
  const notes: Array<{ key: string; variant: "warning" | "error"; label: string; text: string; tab: SettingsTabId | null; open?: { label: string; run: () => void } }> = []
  if (status.mode !== "demo" && status.missing.length > 0) notes.push({ key: "missing", variant: "warning", label: t("missing.label"), text: t("missing.text", { missing: status.missing.join(", ") }), tab: "account" })
  if (status.optionProblems.length > 0) notes.push({ key: "options", variant: "warning", label: t("missing.optionsLabel"), text: t("missing.options", { list: status.optionProblems.join("; ") }), tab: "account" })
  if (status.senderProblems.length > 0) {
    const first = senderText(status.senderProblems[0])
    const more = status.senderProblems.length - 1
    notes.push({ key: "sender", variant: "warning", label: t("missing.senderLabel"), text: more > 0 ? t("missing.senderMore", { first, count: more }) : first, tab: "sender" })
  }
  for (const code of status.statuses.problems) {
    if (code === "tracking_mode_queue_unsupported") continue
    notes.push({ key: `statuses-${code}`, variant: "warning", label: t("account.statusSource"), text: t(`statusProblem.${code}`, { time: fmtDateTime(status.statuses.problemAt, lang) }), tab: "account" })
  }
  if (status.counts.attention > 0) notes.push({ key: "attention", variant: "error", label: t("missing.attentionLabel"), text: t("missing.attention", { count: status.counts.attention }), tab: null })
  if (status.counts.statusesAttention > 0) {
    notes.push({
      key: "statuses",
      variant: "error",
      label: t("missing.statusesLabel"),
      text: t("missing.statuses", { count: status.counts.statusesAttention }),
      tab: null,
      open: { label: t("missing.statusesOpen"), run: onWriterFailed },
    })
  }
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
          {n.open ? (
            <>
              {" "}
              <button type="button" className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover" onClick={n.open.run}>
                {n.open.label}
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
  rank: 100,
  icon: DpdIcon,
})

export default DpdPage
