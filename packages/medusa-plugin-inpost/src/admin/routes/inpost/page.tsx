import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, MagnifyingGlass, TruckFast } from "@medusajs/icons"
import { Badge, Container, InlineTip, toast, usePrompt } from "@medusajs/ui"
import type { ParcelFilter, PanelGroup, StatusResponse } from "../../../modules/inpost/lib/contract"
import { errorMessage, inpostKeys, useInpostDemoReset, useInpostDemoSeed, useInpostPickup, useInpostStatus, useInpostSync } from "../../lib/inpost-api"
import { AddStoreButton, HelpButtons, IntegrationHeader, ModeBadge, ReferencesBadge, SettingsView, communityLabels, usePageNav, type HeaderAction, type PageNav } from "../../lib/inpost-guide"
import { GuideView, usePromptSpec } from "../../lib/inpost-guide-view"
import { InpostIcon } from "../../lib/inpost-icon"
import { DemoDetails, ParcelsSection } from "../../lib/inpost-panel"
import { LockerDrawer } from "../../lib/inpost-plan"
import { AccountSection, HistorySection, ShippingSection, WritersSection } from "../../lib/inpost-settings"
import { StatTile, fmtNumber, fmtRating, kitReferences, modeOf } from "../../lib/inpost-ui"

/**
 * InPost by Koda Plus. Three views, switched in the header and kept in the URL:
 *
 * - Panel: the shipments next to the orders they belong to, in the lists a
 *   warehouse works with (to create, waiting for pickup, in transit, in the
 *   locker, delivered, problems and returns), with the plan, the label and
 *   the tracking of each.
 * - Setup guide (`?view=guide`).
 * - Settings (`?view=settings&tab=`): the InPost account and the webhook, the
 *   sender, the default parcel and the label, the writers, the history.
 *
 * The demo note and the stores running the integration sit in header badges.
 */
const SETTINGS_TABS = ["account", "shipping", "writers", "history"] as const
const FILTERS = ["all", "to_create", "waiting", "in_transit", "in_locker", "delivered", "problems", "canceled", "skipped"] as const
type SettingsTabId = (typeof SETTINGS_TABS)[number]

const GROUPS: Array<{ key: PanelGroup; tone: "default" | "green" | "orange" | "red" | "blue" | "purple" }> = [
  { key: "to_create", tone: "orange" },
  { key: "waiting", tone: "blue" },
  { key: "in_transit", tone: "blue" },
  { key: "in_locker", tone: "purple" },
  { key: "delivered", tone: "green" },
  { key: "problems", tone: "red" },
]

const InpostPage = () => {
  const { t, i18n } = useTranslation("inpost")
  const lang = i18n.language || "en"
  const client = useQueryClient()
  const nav = usePageNav(SETTINGS_TABS)
  const [pollUntil, setPollUntil] = useState(0)
  const status = useInpostStatus(pollUntil)
  const s = status.data
  /* Deep links from hosts and boards: /inpost?filter=to_create, /inpost?q=1042. */
  const [params] = useSearchParams()
  const [filter, setFilter] = useState<ParcelFilter>(() => {
    const asked = params.get("filter")
    return asked && (FILTERS as readonly string[]).includes(asked) ? (asked as ParcelFilter) : "all"
  })
  const initialQuery = (params.get("q") ?? "").slice(0, 100)
  const polling = Boolean(s?.running) || Date.now() < pollUntil

  /* Demo mode: the sample shipments are built once, on the first visit (reads never write). */
  const seed = useInpostDemoSeed()
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current || !s || s.mode !== "demo" || s.counts.all > 0) return
    asked.current = true
    seed.mutate()
  }, [s]) // eslint-disable-line react-hooks/exhaustive-deps

  /* A finished status pass refreshes the lists. */
  const runKey = s?.lastRun?.id ?? ""
  const seen = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (seen.current !== undefined && seen.current !== runKey) void client.invalidateQueries({ queryKey: inpostKeys.all, predicate: (q) => q.queryKey[1] !== "status" })
    seen.current = runKey
  }, [runKey, client])

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} lang={lang} nav={nav} onAction={() => setPollUntil(Date.now() + 30_000)} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s ? <Warnings status={s} /> : null}
        {s && nav.view === "panel" ? (
          <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-3 xl:grid-cols-6">
            {GROUPS.map((g) => (
              <StatTile
                key={g.key}
                label={t(`stats.${g.key}`)}
                value={fmtNumber(s.counts[g.key], lang)}
                tone={s.counts[g.key] > 0 ? g.tone : "default"}
                active={filter === g.key}
                onClick={() => setFilter(filter === g.key ? "all" : g.key)}
              />
            ))}
          </div>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} lang={lang} /> : null}

      {s && nav.view === "panel" ? <ParcelsSection status={s} lang={lang} filter={filter} onFilter={setFilter} poll={polling} initialQuery={initialQuery} onSettings={() => nav.go("settings", "writers")} /> : null}

      {s && nav.view === "settings" ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "account", label: t("settings.tab.account") },
            { id: "shipping", label: t("settings.tab.shipping") },
            { id: "writers", label: t("settings.tab.writers"), badge: Object.values(s.writers).filter((w) => w.armed).length, tone: "orange" },
            { id: "history", label: t("settings.tab.history") },
          ]}
        >
          {nav.tab === "account" ? <AccountSection status={s} lang={lang} /> : null}
          {nav.tab === "shipping" ? <ShippingSection status={s} /> : null}
          {nav.tab === "writers" ? <WritersSection status={s} lang={lang} /> : null}
          {nav.tab === "history" ? <HistorySection lang={lang} /> : null}
        </SettingsView>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Header({ status, lang, nav, onAction }: { status: StatusResponse | undefined; lang: string; nav: PageNav<SettingsTabId>; onAction: () => void }) {
  const { t } = useTranslation("inpost")
  const prompt = usePrompt()
  const sync = useInpostSync()
  const reset = useInpostDemoReset()
  const pickup = useInpostPickup()
  const [lockers, setLockers] = useState(false)
  const mode = modeOf(status)
  const armed = status ? Object.values(status.writers).filter((w) => w.armed).length : 0
  const references = status ? kitReferences(status.references, lang) : []
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)
  const pickupUsed = Boolean(status && (status.options.sendingMethod.courier === "dispatch_order" || status.options.sendingMethod.locker === "dispatch_order"))

  const onSync = async () => {
    try {
      const r = await sync.mutateAsync()
      toast.info(r.alreadyRunning ? t("toast.syncRunning") : t("toast.syncStarted"))
      onAction()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onReset = async () => {
    const yes = await prompt({ title: t("demo.resetTitle"), description: t("demo.resetText"), confirmText: t("demo.resetConfirm"), cancelText: t("cancel.back") })
    if (!yes) return
    try {
      await reset.mutateAsync()
      toast.success(t("toast.reset"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onPickup = async () => {
    try {
      const r = await pickup.mutateAsync({})
      if (r.parcels > 0) toast.success(t("toast.pickupOrdered", { count: r.parcels, id: r.dispatchOrderId ?? "" }))
      else toast.info(t("toast.pickupNone"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const actions: HeaderAction[] = [{ key: "lockers", label: t("actions.findLocker"), icon: <MagnifyingGlass />, onClick: () => setLockers(true) }]
  if (pickupUsed) actions.push({ key: "pickup", label: t("actions.pickup"), icon: <TruckFast />, loading: pickup.isPending, disabled: !status?.writers.shipment.armed, onClick: () => void onPickup() })
  if (status?.mode === "demo") actions.push({ key: "reset", label: t("actions.resetDemo"), loading: reset.isPending, onClick: () => void onReset() })

  return (
    <>
      <IntegrationHeader
        icon={<InpostIcon width={28} height={28} />}
        title={t("title")}
        by={t("by")}
        badges={
          status ? (
            <>
              <ModeBadge color={mode.tone} label={t(`mode.${mode.key}`)} title={t("demo.label")}>
                {status.mode === "demo" ? <DemoDetails status={status} /> : null}
              </ModeBadge>
              {armed > 0 ? (
                <Badge size="2xsmall" color="orange">
                  {t("mode.writing", { count: armed })}
                </Badge>
              ) : (
                <Badge size="2xsmall" color="grey">
                  {t("mode.readOnly")}
                </Badge>
              )}
            </>
          ) : null
        }
        description={t("subtitle")}
        social={
          <>
            <ReferencesBadge
              items={references}
              labels={{
                count: (live, soon) =>
                  live > 0
                    ? live === 1
                      ? t("references.badgeOne")
                      : t("references.badgeMany", { count: live })
                    : soon === 1
                      ? t("references.badgeSoonOne")
                      : t("references.badgeSoonMany", { count: soon }),
                soonMore: (soon) => t("references.soonMore", { count: soon }),
                soon: t("references.soon"),
                title: t("references.title"),
                subtitle: t("references.subtitle"),
                open: t("references.open"),
                review: t("references.review"),
                rating: (value) => fmtRating(value, lang),
              }}
            />
            <AddStoreButton labels={community.addStore} />
          </>
        }
        help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
        view={nav.view}
        onView={(v) => nav.go(v)}
        labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("settings.title"), more: t("actions.moreActions") }}
        primary={
          nav.view !== "guide"
            ? {
                key: "sync",
                label: status?.running ? t("actions.syncing") : t("actions.sync"),
                icon: <ArrowPath />,
                loading: sync.isPending || Boolean(status?.running),
                disabled: !status?.configured,
                onClick: () => void onSync(),
              }
            : null
        }
        actions={nav.view !== "guide" ? actions : []}
      />
      {lockers ? <LockerDrawer onClose={() => setLockers(false)} /> : null}
    </>
  )
}

/** Only what needs a person now; the demo note lives in the mode badge. */
function Warnings({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("inpost")
  const notes: Array<{ key: string; variant: "warning" | "error"; label: string; text: string }> = []
  if (status.mode === "live" && status.missing.length > 0) notes.push({ key: "missing", variant: "warning", label: t("missing.label"), text: t("missing.text", { missing: status.missing.join(", ") }) })
  if (status.problems.length > 0) notes.push({ key: "problems", variant: "warning", label: t("missing.problemsLabel"), text: t("missing.problems", { list: status.problems.join("; ") }) })
  if (status.counts.attention > 0) notes.push({ key: "attention", variant: "error", label: t("missing.attentionLabel"), text: t("missing.attention", { count: status.counts.attention }) })
  if (notes.length === 0) return null
  return (
    <div className="flex flex-col gap-y-2 px-6 py-4">
      {notes.map((n) => (
        <InlineTip key={n.key} variant={n.variant} label={n.label}>
          {n.text}
        </InlineTip>
      ))}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "InPost",
  icon: InpostIcon,
})

export default InpostPage
