import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, PaperPlane } from "@medusajs/icons"
import { Container, InlineTip } from "@medusajs/ui"
import type { MessageFilter, StatusResponse } from "../../../modules/emails/lib/contract"
import { errorMessage, useEmailsSeed, useEmailsStatus } from "../../lib/emails-api"
import { AddStoreButton, HelpButtons, IntegrationHeader, ModeBadge, ReferencesBadge, SettingsView, communityLabels, usePageNav, type PageNav } from "../../lib/emails-guide"
import { GuideView, usePromptSpec } from "../../lib/emails-guide-view"
import { EmailsIcon } from "../../lib/emails-icon"
import { ByTemplateSection, DemoDetails, GallerySection, MessageDrawer, MessagesSection, TestDrawer, type TestInitial } from "../../lib/emails-panels"
import { BrandingSection, ProviderSection, TemplatesSection } from "../../lib/emails-settings"
import { StatTile, fmtNumber, fmtRating, modeState, referencesFor } from "../../lib/emails-ui"

/**
 * E-mails by Koda Plus. Three views, switched in the header and kept in the URL:
 *
 * - Panel: what was sent (counters, the log with masked addresses, counts per
 *   template), the template gallery with the live preview, and the test send.
 *   In demo mode the log is the simulated outbox.
 * - Setup guide (`?view=guide`): from a Resend account to production.
 * - Settings (`?view=settings&tab=`): the branding, the template switches, the
 *   provider and the options in use.
 */
const SETTINGS_TABS = ["branding", "templates", "provider"] as const
type SettingsTabId = (typeof SETTINGS_TABS)[number]

const EmailsPage = () => {
  const { t, i18n } = useTranslation("emails")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const status = useEmailsStatus()
  const s = status.data
  const [filter, setFilter] = useState<MessageFilter>("all")
  const [openMessage, setOpenMessage] = useState<string | null>(null)
  const [test, setTest] = useState<TestInitial | null | "open">(null)
  /* Demo mode: the status only says the outbox is stale (a GET never writes); the page asks for the seed once. */
  const seed = useEmailsSeed()
  const seedAsked = useRef(false)
  const seedDue = Boolean(s && s.mode === "demo" && s.demo?.stale && (s.provider.mode === null || s.provider.mode === "demo"))
  useEffect(() => {
    if (!seedDue || seedAsked.current) return
    seedAsked.current = true
    seed.mutate()
  }, [seedDue])

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} lang={lang} nav={nav} onTest={() => setTest("open")} onRefresh={() => void status.refetch()} refreshing={status.isFetching} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {s ? <Warnings status={s} /> : null}
        {seed.isPending ? (
          <div className="px-6 py-4">
            <InlineTip variant="info" label={t("demo.label")}>
              {t("demo.preparing")}
            </InlineTip>
          </div>
        ) : null}
        {s && nav.view === "panel" ? (
          <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-4">
            <StatTile label={s.mode === "demo" ? t("stats.simulated24h") : t("stats.sent24h")} value={fmtNumber(s.counts.sent24h, lang)} tone="green" />
            <StatTile label={s.mode === "demo" ? t("stats.simulated30d") : t("stats.sent30d")} value={fmtNumber(s.counts.sent30d, lang)} tone="green" active={filter === "sent"} onClick={() => setFilter("sent")} />
            <StatTile
              label={t("stats.attention")}
              value={fmtNumber(s.counts.attention30d, lang)}
              tone={s.counts.attention30d > 0 ? "red" : "default"}
              active={filter === "attention"}
              onClick={() => setFilter("attention")}
            />
            <StatTile
              label={t("stats.templatesOn")}
              value={`${fmtNumber(s.templates.filter((x) => x.enabled).length, lang)}/${fmtNumber(s.templates.length, lang)}`}
              tone="blue"
              onClick={() => nav.go("settings", "templates")}
            />
          </div>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} /> : null}

      {s && nav.view === "panel" ? (
        <>
          <GallerySection status={s} lang={lang} onSendTest={(initial) => setTest(initial)} />
          <MessagesSection status={s} lang={lang} filter={filter} onFilter={setFilter} onOpen={setOpenMessage} />
          <ByTemplateSection status={s} lang={lang} />
        </>
      ) : null}

      {s && nav.view === "settings" ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "branding", label: t("settings.tab.branding"), badge: s.brandOverridden.length || null, tone: "blue" },
            { id: "templates", label: t("settings.tab.templates"), badge: s.templates.filter((x) => x.enabled).length, tone: "green" },
            { id: "provider", label: t("settings.tab.provider"), badge: s.provider.loaded ? null : "!", tone: "red" },
          ]}
        >
          {nav.tab === "branding" ? <BrandingSection status={s} lang={lang} /> : null}
          {nav.tab === "templates" ? <TemplatesSection status={s} lang={lang} /> : null}
          {nav.tab === "provider" ? <ProviderSection status={s} lang={lang} /> : null}
        </SettingsView>
      ) : null}

      {openMessage && s ? <MessageDrawer id={openMessage} status={s} lang={lang} onClose={() => setOpenMessage(null)} /> : null}
      {test && s ? <TestDrawer status={s} lang={lang} initial={test === "open" ? null : test} onClose={() => setTest(null)} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Header({
  status,
  lang,
  nav,
  onTest,
  onRefresh,
  refreshing,
}: {
  status: StatusResponse | undefined
  lang: string
  nav: PageNav<SettingsTabId>
  onTest: () => void
  onRefresh: () => void
  refreshing: boolean
}) {
  const { t } = useTranslation("emails")
  const mode = modeState(status)
  const references = status ? referencesFor(status.references, lang) : []
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)
  const panel = nav.view === "panel"
  const note = status && (status.mode === "demo" || status.mode === "dev") ? <DemoDetails status={status} /> : null

  return (
    <IntegrationHeader
      icon={<EmailsIcon width={28} height={28} />}
      title={t("title")}
      by={t("by")}
      badges={
        status ? (
          <ModeBadge color={mode.tone} label={t(`mode.${mode.key}`)} title={status.mode === "dev" ? t("devNote.label") : t("demo.label")}>
            {note}
          </ModeBadge>
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
      primary={panel && status ? { key: "test", label: t("actions.sendTest"), icon: <PaperPlane />, onClick: onTest } : null}
      actions={panel ? [{ key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, loading: refreshing, onClick: onRefresh }] : []}
    />
  )
}

/** Only what needs a person now: missing options, a provider that is not wired, a log that is not there. */
function Warnings({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("emails")
  const tips: Array<{ key: string; variant: "warning" | "error"; label: string; text: string }> = []
  if (status.mode === "live" && status.missing.length > 0) tips.push({ key: "missing", variant: "warning", label: t("missing.label"), text: t("missing.text", { missing: status.missing.join(", ") }) })
  if (!status.provider.loaded) tips.push({ key: "provider", variant: "error", label: t("provider.notLoaded.label"), text: t("provider.notLoaded.text") })
  else if (status.provider.mode && status.provider.mode !== status.mode) {
    tips.push({
      key: "modes",
      variant: "error",
      label: t("provider.modeDiffersLabel"),
      text: t("provider.modeDiffersText", { plugin: t(`mode.${status.mode}`), provider: t(`mode.${status.provider.mode}`) }),
    })
  } else if (status.provider.sameOptions === false) tips.push({ key: "differs", variant: "warning", label: t("provider.differsLabel"), text: t("provider.differsText", { list: status.provider.differences.join(", ") }) })
  if (status.provider.feedProviders && status.provider.feedProviders.length === 0) tips.push({ key: "feed", variant: "error", label: t("provider.noFeedLabel"), text: t("provider.noFeedText") })
  if (status.provider.emailProviders && status.provider.emailProviders.length > 1) {
    tips.push({ key: "several", variant: "warning", label: t("provider.severalLabel"), text: t("provider.severalText", { list: status.provider.emailProviders.join(", ") }) })
  }
  if (!status.logReady) tips.push({ key: "log", variant: "error", label: t("log.notReadyLabel"), text: t("log.notReady") })
  if (tips.length === 0) return null
  return (
    <div className="flex flex-col gap-y-2 px-6 py-4">
      {tips.map((tip) => (
        <InlineTip key={tip.key} variant={tip.variant} label={tip.label}>
          {tip.text}
        </InlineTip>
      ))}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "E-mails",
  translationNs: "emails",
  icon: EmailsIcon,
})

export default EmailsPage
