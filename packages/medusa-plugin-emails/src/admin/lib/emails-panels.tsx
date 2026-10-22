import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowPath,
  ArrowUpRightMini,
  BarsArrowDown,
  Beaker,
  ChartBar,
  CircleStack,
  Clock,
  ComputerDesktop,
  CursorArrowRays,
  Envelope,
  ExclamationCircle,
  Eye,
  EyeSlash,
  Language,
  ListBullet,
  MinusCircle,
  Moon,
  PaperPlane,
  Phone,
  ShoppingCart,
  Sun,
  Swatch,
  Tag,
  XCircle,
} from "@medusajs/icons"
import { Link } from "react-router-dom"
import { Button, Drawer, InlineTip, Input, Label, Select, Table, Text, clx, toast, usePrompt } from "@medusajs/ui"
import type { MessageDto, MessageFilter, MessageWindow, PreviewSource, StatusResponse, TemplateDto } from "../../modules/emails/lib/contract"
import { OrderLink, ResendLink } from "./emails-links"
import { CampaignBadge, DeliveryBadge } from "./emails-delivery"
import { KitFetchingBar, KitLoading, KitSkeletonRows } from "./emails-kit"
import { KeyPoints } from "./emails-guide"
import { EmptyState, EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, ToneBadge } from "./emails-blocks"
import { errorMessage, useEmailsMessage, useEmailsMessages, useEmailsPreview, useEmailsRetry, useEmailsTest } from "./emails-api"
import {
  EmailFrame,
  Fact,
  KindBadge,
  MessageStatusBadge,
  OnOff,
  fmtDateTime,
  fmtKb,
  fmtNumber,
  templateDescription,
  templateLabel,
  useDebounced,
  useErrorText,
} from "./emails-ui"

const PAGE_SIZE = 15
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Width = "desktop" | "mobile"
type Theme = "light" | "dark"
type Lang = "pl" | "en"

/** The demo note, in the popover of the mode badge. */
export function DemoDetails({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("emails")
  if (status.mode === "demo") {
    return (
      <>
        <span>{t("demo.text")}</span>
        <span>{t("demo.outbox")}</span>
      </>
    )
  }
  if (status.mode === "dev") return <span>{t("devNote.text")}</span>
  return null
}

/* ------------------------------------------------------------------ */
/* The template gallery with the live preview                          */
/* ------------------------------------------------------------------ */

export interface TestInitial {
  template: string
  locale: Lang
  source: PreviewSource
}

export function GallerySection({ status, lang, onSendTest }: { status: StatusResponse; lang: string; onSendTest: (initial: TestInitial) => void }) {
  const { t } = useTranslation("emails")
  const templates = status.templates
  const [active, setActive] = useState<string | null>(templates[0]?.key ?? null)
  const [width, setWidth] = useState<Width>("desktop")
  const [theme, setTheme] = useState<Theme>("light")
  const [locale, setLocale] = useState<Lang>(/^pl/i.test(lang) ? "pl" : status.defaultLocale)
  const [source, setSource] = useState<PreviewSource>("sample")
  const current = templates.find((x) => x.key === active) ?? null
  const effectiveSource: PreviewSource = current?.latest ? source : "sample"
  const preview = useEmailsPreview(active, locale, theme, effectiveSource)

  useEffect(() => {
    if (!active && templates.length > 0) setActive(templates[0].key)
  }, [active, templates])

  const sourceText = preview.data
    ? preview.data.source === "latest"
      ? preview.data.sourceRef
        ? t("gallery.sourceLatest", { ref: preview.data.sourceRef })
        : t("gallery.sourceLatestNoRef")
      : t("gallery.sourceSample")
    : ""

  return (
    <Section
      icon={<Swatch />}
      title={t("gallery.title")}
      pointsLabel={t("gallery.subtitle")}
      points={[
        { icon: <ComputerDesktop />, text: t("gallery.points.devices") },
        { icon: <Moon />, text: t("gallery.points.modes") },
        { icon: <Language />, text: t("gallery.points.languages") },
        { icon: <ShoppingCart />, text: t("gallery.points.data") },
      ]}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-y-2 border-b border-ui-border-base p-4 lg:border-b-0 lg:border-r">
          {templates.map((x) => (
            <TemplateCard key={x.key} template={x} lang={lang} active={x.key === active} showSource={status.mode !== "app"} onClick={() => setActive(x.key)} />
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-y-4 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-col gap-y-0.5">
              <Text size="xsmall" className="text-ui-fg-muted">
                {t("gallery.subject")}
              </Text>
              <Text size="base" weight="plus" className="break-words">
                {preview.data?.subject ?? ""}
              </Text>
              {preview.data?.preheader ? (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {preview.data.preheader}
                </Text>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterButton icon={<Language />} label="PL" title={t("languages.pl")} active={locale === "pl"} onClick={() => setLocale("pl")} />
              <FilterButton icon={<Language />} label="EN" title={t("languages.en")} active={locale === "en"} onClick={() => setLocale("en")} />
              <FilterDivider />
              <FilterButton icon={<Sun />} label={t("gallery.light")} active={theme === "light"} onClick={() => setTheme("light")} />
              <FilterButton icon={<Moon />} label={t("gallery.dark")} active={theme === "dark"} onClick={() => setTheme("dark")} />
              <FilterDivider />
              <FilterButton icon={<ComputerDesktop />} label={t("gallery.desktop")} active={width === "desktop"} onClick={() => setWidth("desktop")} />
              <FilterButton icon={<Phone />} label={t("gallery.phone")} active={width === "mobile"} onClick={() => setWidth("mobile")} />
              <FilterDivider />
              <FilterButton icon={<Beaker />} label={t("gallery.sample")} active={effectiveSource === "sample"} onClick={() => setSource("sample")} />
              <FilterButton icon={<ShoppingCart />} label={t("gallery.latest")} active={effectiveSource === "latest"} disabled={!current?.latest} onClick={() => setSource("latest")} />
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-subtle">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ui-border-base px-4 py-2">
              <div className="flex items-center gap-x-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-ui-tag-red-icon opacity-60" />
                <span className="h-2.5 w-2.5 rounded-full bg-ui-tag-orange-icon opacity-60" />
                <span className="h-2.5 w-2.5 rounded-full bg-ui-tag-green-icon opacity-60" />
              </div>
              <div className="flex flex-wrap items-center gap-x-2">
                {preview.data ? (
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {t("gallery.size", { size: fmtKb(preview.data.bytes, lang) })}
                  </Text>
                ) : null}
                {sourceText ? <ToneBadge tone={preview.data?.source === "latest" ? "blue" : "grey"}>{sourceText}</ToneBadge> : null}
              </div>
            </div>
            <div className="flex justify-center p-4">
              {preview.isLoading ? (
                <div className="flex h-[420px] items-center justify-center">
                  <EmptyState icon={<ArrowPath className="animate-spin" />} title={t("gallery.rendering")} />
                </div>
              ) : preview.isError ? (
                <div className="w-full">
                  <InlineTip variant="error" label={templateLabel(current ?? undefined, lang)}>
                    {t("gallery.failed", { error: errorMessage(preview.error) })}
                  </InlineTip>
                </div>
              ) : preview.data ? (
                <EmailFrame html={preview.data.html} title={templateLabel(current ?? undefined, lang)} width={width} />
              ) : null}
            </div>
          </div>

          {current ? (
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <KeyPoints
                label={current.latest ? t("gallery.latestNote") : t("gallery.sampleNote")}
                items={
                  current.latest
                    ? [
                        { icon: <ShoppingCart />, text: t("gallery.points.latestOrder") },
                        { icon: <EyeSlash />, text: t("gallery.points.personReplaced") },
                      ]
                    : [
                        { icon: <Beaker />, text: t("gallery.points.sampleData") },
                        { icon: <Tag />, text: t("gallery.points.testSubject") },
                      ]
                }
              />
              <Button size="small" variant="secondary" onClick={() => onSendTest({ template: current.key, locale, source: effectiveSource })}>
                <PaperPlane />
                {t("gallery.sendThis")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Section>
  )
}

/* showSource: "Your template" next to the built-in ones; in app mode every template is the store's, so it says nothing. */
function TemplateCard({ template, lang, active, showSource, onClick }: { template: TemplateDto; lang: string; active: boolean; showSource: boolean; onClick: () => void }) {
  const { t } = useTranslation("emails")
  return (
    <button
      type="button"
      onClick={onClick}
      className={clx(
        "flex flex-col gap-y-1 rounded-lg border px-3 py-2.5 text-left transition-fg",
        active ? "border-ui-border-interactive bg-ui-bg-base shadow-borders-interactive-with-active" : "border-ui-border-base bg-ui-bg-component hover:bg-ui-bg-component-hover",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Text size="small" weight="plus" leading="compact">
          {templateLabel(template, lang)}
        </Text>
        <span className={clx("h-1.5 w-1.5 shrink-0 rounded-full", template.enabled ? "bg-ui-tag-green-icon" : "bg-ui-fg-disabled")} title={template.enabled ? t("templates.on") : t("templates.off")} />
      </div>
      <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
        {templateDescription(template, lang)}
      </Text>
      <span className="flex flex-wrap items-center gap-1.5">
        <Text size="xsmall" leading="compact" className="font-mono text-ui-fg-muted">
          {template.key}
        </Text>
        {showSource && template.source === "app" ? <ToneBadge>{t("templates.app")}</ToneBadge> : null}
        {!template.enabled ? <ToneBadge>{template.allowed ? t("templates.off") : t("templates.blocked")}</ToneBadge> : null}
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* What was sent                                                       */
/* ------------------------------------------------------------------ */

const FILTERS: MessageFilter[] = ["all", "sent", "attention", "skipped", "test", "bounced"]

const FILTER_ICON: Record<MessageFilter, ReactNode> = {
  all: <ListBullet />,
  sent: <PaperPlane />,
  attention: <ExclamationCircle />,
  skipped: <MinusCircle />,
  test: <Beaker />,
  bounced: <XCircle />,
}

function filterCount(status: StatusResponse, f: MessageFilter): number | undefined {
  const c = status.counts
  if (f === "sent") return c.sent30d
  if (f === "attention") return c.attention30d
  if (f === "skipped") return c.skipped30d
  if (f === "test") return c.tests30d
  if (f === "bounced") return c.refused30d
  return undefined
}

/** The log narrowed by a deep link: one order, one customer, a window of time. */
/** The admin page that acts on a message of a template group (option templateGroups link), with its order or customer filled in. */
function GroupLink({ group, message }: { group: { link: { label: string; path: string } | null } | null; message: MessageDto }) {
  if (!group?.link) return null
  let path = group.link.path
  if (path.includes(":order_id")) {
    if (!message.orderId) return null
    path = path.split(":order_id").join(encodeURIComponent(message.orderId))
  }
  if (path.includes(":customer_id")) {
    if (!message.customerId) return null
    path = path.split(":customer_id").join(encodeURIComponent(message.customerId))
  }
  return (
    <Link to={path} className="txt-compact-xsmall-plus inline-flex items-center gap-x-0.5 text-ui-fg-interactive hover:underline">
      {group.link.label}
      <ArrowUpRightMini />
    </Link>
  )
}

export interface MessagesScope {
  orderId: string
  customerId: string
  since: MessageWindow | ""
  /** A template group of the log (option templateGroups), "" for all templates. */
  group?: string
}

/** The message in Resend's dashboard, when Resend sent it (the plugin's provider, or the store's own Resend provider in app mode). */
export function resendLink(status: StatusResponse | undefined, m: Pick<MessageDto, "externalId" | "demo">): string | null {
  if (!status || !m.externalId || m.demo) return null
  const viaResend = status.mode === "live" || (status.mode === "app" && /resend/i.test(status.provider.app?.id ?? ""))
  return viaResend && /^[0-9a-f-]{20,}$/i.test(m.externalId) ? `https://resend.com/emails/${encodeURIComponent(m.externalId)}` : null
}

export function MessagesSection({
  status,
  lang,
  filter,
  onFilter,
  onOpen,
  scope,
  initialQuery = "",
  onClearScope,
  onGroup,
}: {
  status: StatusResponse
  lang: string
  filter: MessageFilter
  onFilter: (f: MessageFilter) => void
  onOpen: (id: string) => void
  scope?: MessagesScope
  initialQuery?: string
  onClearScope?: () => void
  onGroup?: (key: string) => void
}) {
  const { t } = useTranslation("emails")
  const demo = status.mode === "demo"
  const groups = status.templateGroups ?? []
  const group = groups.find((g) => g.key === scope?.group) ?? null
  const groupOf = (template: string) => groups.find((g) => g.templates.includes(template)) ?? null
  const [search, setSearch] = useState(initialQuery)
  useEffect(() => setSearch(initialQuery), [initialQuery])
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q, scope?.orderId, scope?.customerId, scope?.since, scope?.group])
  const messages = useEmailsMessages({ filter, q, template: group ? group.templates.join(",") : "", orderId: scope?.orderId, customerId: scope?.customerId, since: scope?.since, offset: page * PAGE_SIZE, limit: PAGE_SIZE })
  const scoped = Boolean(scope && (scope.orderId || scope.customerId || scope.since || group))
  const rows = messages.data?.messages ?? []
  const count = messages.data?.count ?? 0
  const byKey = useMemo(() => new Map(status.templates.map((x) => [x.key, x])), [status.templates])
  const errorText = useErrorText()

  return (
    <Section
      id="emails-log"
      icon={<Envelope />}
      title={demo ? t("log.demoTitle") : t("log.title")}
      badges={demo ? <ToneBadge tone="blue">{t("log.simulated")}</ToneBadge> : null}
      pointsLabel={demo ? t("log.demoSubtitle") : t("log.subtitle", { days: status.retentionDays })}
      actions={<SearchInput className="sm:w-72" value={search} onChange={setSearch} placeholder={t(status?.showAddresses ? "log.searchAddresses" : "log.search")} />}
      points={
            demo
              ? [
                  { icon: <PaperPlane />, text: t("log.points.nothingSent"), tone: "orange" },
                  { icon: <Eye />, text: t("log.points.open") },
                ]
              : [
                  { icon: <BarsArrowDown />, text: t("log.points.newest") },
                  { icon: <EyeSlash />, text: t("log.points.masked") },
                  { icon: <Clock />, text: t("log.points.kept", { days: status.retentionDays }) },
                  ...(status.mode === "app" && status.history?.firstAt
                    ? [{ icon: <CircleStack />, text: t("log.points.history", { date: fmtDateTime(status.history.firstAt, lang) }), tone: "blue" as const }]
                    : []),
                ]
      }
    >
      {scoped && scope ? (
        <div className="flex flex-wrap items-center gap-2 px-6 py-3">
          {scope.orderId ? <ToneBadge tone="blue">{t("log.scope.order", { id: scope.orderId })}</ToneBadge> : null}
          {scope.customerId ? <ToneBadge tone="blue">{t("log.scope.customer", { id: scope.customerId })}</ToneBadge> : null}
          {scope.since ? <ToneBadge icon={<Clock />}>{t(`log.scope.since.${scope.since}`)}</ToneBadge> : null}
          {group ? <ToneBadge tone="blue">{group.label}</ToneBadge> : null}
          {group?.link && !group.link.path.includes(":") ? (
            <Link to={group.link.path} className="txt-compact-small-plus inline-flex items-center gap-x-1 text-ui-fg-interactive hover:underline">
              {group.link.label}
              <ArrowUpRightMini />
            </Link>
          ) : null}
          {onClearScope ? (
            <Button size="small" variant="transparent" onClick={onClearScope}>
              <XCircle />
              {t("log.scope.clear")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <FilterBar>
        {FILTERS.map((f) => (
          <FilterButton
            key={f}
            icon={FILTER_ICON[f]}
            label={t(`log.filter.${f}`)}
            count={scoped ? undefined : filterCount(status, f)}
            attention={f === "attention" || f === "bounced"}
            active={filter === f}
            onClick={() => onFilter(filter === f && f !== "all" ? "all" : f)}
          />
        ))}
        {groups.length && onGroup ? (
          <>
            <FilterDivider />
            {groups.map((g) => (
              <FilterButton key={g.key} icon={<Envelope />} label={g.label} title={t("log.group.title")} active={group?.key === g.key} onClick={() => onGroup(group?.key === g.key ? "" : g.key)} />
            ))}
          </>
        ) : null}
      </FilterBar>
      {messages.isError ? (
        <div className="px-6 py-4">
          <InlineTip variant="error" label={t("log.title")}>
            {errorMessage(messages.error)}
          </InlineTip>
        </div>
      ) : null}
      <KitFetchingBar active={messages.isFetching && !messages.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("log.col.when")}</Table.HeaderCell>
              <Table.HeaderCell>{t("log.col.template")}</Table.HeaderCell>
              <Table.HeaderCell>{t("log.col.recipient")}</Table.HeaderCell>
              <Table.HeaderCell>{t("log.col.order")}</Table.HeaderCell>
              <Table.HeaderCell>{t("log.col.subject")}</Table.HeaderCell>
              <Table.HeaderCell>{t("log.col.status")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 && messages.isLoading ? (
              <KitSkeletonRows cols={7} />
            ) : rows.length === 0 ? (
              <EmptyTableRow
                cols={7}
                icon={<Envelope />}
                title={demo ? t("log.demoEmpty") : t("log.empty")}
                points={[
                  { icon: <ShoppingCart />, text: t("log.emptyPoints.order") },
                  { icon: <PaperPlane />, text: t("log.emptyPoints.test") },
                ]}
              />
            ) : (
              rows.map((m) => (
                <Table.Row key={m.id} className="[&_td]:py-2.5 align-top">
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(m.sentAt ?? m.createdAt, lang)}</Table.Cell>
                  <Table.Cell className="max-w-[240px]">
                    <div className="flex flex-col gap-y-0.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Text size="small" weight="plus" leading="compact">
                          {templateLabel(byKey.get(m.template), lang, m.template)}
                        </Text>
                        <KindBadge kind={m.kind} />
                        {m.variant && groupOf(m.template)?.variantLabels?.[m.variant] ? (
                          <ToneBadge tone={m.variant === "overdue" ? "red" : "blue"}>{groupOf(m.template)!.variantLabels![m.variant]}</ToneBadge>
                        ) : null}
                      </span>
                      <Text size="xsmall" className="font-mono text-ui-fg-muted">
                        {m.template}
                        {m.locale ? ` ${m.locale.toUpperCase()}` : ""}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap font-mono txt-compact-small">{m.recipient ?? ""}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      {m.orderId ? <OrderLink id={m.orderId} open={t("log.openOrder")} /> : null}
                      {m.orderState ? (
                        <ToneBadge tone={m.orderState.color} title={m.orderState.hint ?? undefined}>
                          {m.orderState.label}
                        </ToneBadge>
                      ) : null}
                      <GroupLink group={groupOf(m.template)} message={m} />
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-md">
                    <Text size="small" className="line-clamp-2 break-words">
                      {m.subject ?? ""}
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="max-w-xs">
                    <div className="flex flex-col items-start gap-y-1">
                      <MessageStatusBadge message={m} demo={demo} />
                      <DeliveryBadge event={m.delivery} />
                      <CampaignBadge message={m} campaigns={status?.campaigns} />
                      {resendLink(status, m) ? (
                        <ResendLink href={resendLink(status, m)!} className="txt-compact-xsmall">
                          {t("log.openResend")}
                        </ResendLink>
                      ) : null}
                      {m.errorCode ? (
                        <Text size="xsmall" className={m.status === "skipped" ? "text-ui-fg-muted" : "text-ui-tag-red-text"} title={m.error ?? undefined}>
                          {errorText(m.errorCode) || m.errorCode}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <RowActions actions={[{ key: "open", label: t("log.details"), icon: <Eye />, onClick: () => onOpen(m.id) }]} />
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Table.Pagination
        count={count}
        pageSize={PAGE_SIZE}
        pageIndex={page}
        pageCount={Math.max(1, Math.ceil(count / PAGE_SIZE))}
        canPreviousPage={page > 0}
        canNextPage={(page + 1) * PAGE_SIZE < count}
        previousPage={() => setPage(Math.max(0, page - 1))}
        nextPage={() => setPage(page + 1)}
        translations={{ of: t("pagination.of"), results: t("pagination.results"), pages: t("pagination.pages"), prev: t("pagination.prev"), next: t("pagination.next") }}
      />
    </Section>
  )
}

/** Counts per template over 30 days. */
export function ByTemplateSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("emails")
  return (
    <Section
      icon={<ChartBar />}
      title={t("byTemplate.title")}
      pointsLabel={t("byTemplate.subtitle")}
      points={[
        { icon: <Clock />, text: t("byTemplate.points.days") },
        { icon: <CursorArrowRays />, text: t("byTemplate.points.each") },
      ]}
    >
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("byTemplate.col.template")}</Table.HeaderCell>
              <Table.HeaderCell>{t("byTemplate.col.state")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{status.mode === "demo" ? t("byTemplate.col.simulated") : t("byTemplate.col.sent")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("byTemplate.col.failed")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("byTemplate.col.skipped")}</Table.HeaderCell>
              <Table.HeaderCell>{t("byTemplate.col.last")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {status.templates.map((x) => (
              <Table.Row key={x.key} className="[&_td]:py-2.5">
                <Table.Cell>
                  <div className="flex flex-col">
                    <Text size="small" weight="plus" leading="compact">
                      {templateLabel(x, lang)}
                    </Text>
                    <Text size="xsmall" className="font-mono text-ui-fg-muted">
                      {x.key}
                    </Text>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <OnOff on={x.enabled} labels={[t("templates.on"), x.allowed ? t("templates.off") : t("templates.blocked")]} />
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums">{fmtNumber(x.stats.sent, lang)}</Table.Cell>
                <Table.Cell className={clx("text-right tabular-nums", x.stats.failed > 0 && "text-ui-tag-red-text")}>{fmtNumber(x.stats.failed, lang)}</Table.Cell>
                <Table.Cell className="text-right tabular-nums text-ui-fg-subtle">{fmtNumber(x.stats.skipped, lang)}</Table.Cell>
                <Table.Cell className="whitespace-nowrap text-ui-fg-subtle">{x.stats.lastAt ? fmtDateTime(x.stats.lastAt, lang) : t("byTemplate.never")}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* One message                                                         */
/* ------------------------------------------------------------------ */

/** One message. The page passes its status; the order card does not need one: the message names its template and mode itself. */
export function MessageDrawer({ id, status, lang, onClose }: { id: string; status?: StatusResponse; lang: string; onClose: () => void }) {
  const { t } = useTranslation("emails")
  const q = useEmailsMessage(id)
  const retry = useEmailsRetry()
  const prompt = usePrompt()
  const errorText = useErrorText()
  const m: MessageDto | undefined = q.data?.message
  const template = status?.templates.find((x) => x.key === m?.template) ?? (m ? { key: m.template, label: m.label } : undefined)
  const demo = status ? status.mode === "demo" : Boolean(m?.demo)

  const onRetry = async () => {
    if (!m) return
    const confirmed = await prompt({
      title: t("drawer.retryTitle"),
      description: m.status === "unknown" ? t("drawer.retryUnknown") : t("drawer.retryText"),
      confirmText: t("drawer.retry"),
      cancelText: t("actions.cancel"),
      variant: m.status === "unknown" ? "danger" : "confirmation",
    })
    if (!confirmed) return
    try {
      await retry.mutateAsync(m.id)
      toast.success(t("drawer.retried"))
      void q.refetch()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
      void q.refetch()
    }
  }

  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content className="max-w-3xl">
        <Drawer.Header>
          <Drawer.Title>{m ? templateLabel(template, lang, m.template) : t("drawer.title")}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          {q.isError ? (
            <InlineTip variant="error" label={t("drawer.title")}>
              {errorMessage(q.error)}
            </InlineTip>
          ) : null}
          {!m && q.isLoading ? <KitLoading label={t("loading.message")} /> : null}
          {m ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <MessageStatusBadge message={m} demo={demo} />
                <DeliveryBadge event={m.delivery} />
                <CampaignBadge message={m} campaigns={status?.campaigns} />
                <KindBadge kind={m.kind} />
                {m.rotation > 0 ? <ToneBadge icon={<ArrowPath />}>{t("drawer.retriedTimes", { count: m.rotation })}</ToneBadge> : null}
              </div>
              {m.error ? (
                <InlineTip variant={m.status === "skipped" ? "info" : "error"} label={errorText(m.errorCode) || m.errorCode || t("drawer.error")}>
                  {m.error}
                </InlineTip>
              ) : null}
              {m.source === "medusa" ? (
                <InlineTip variant="info" label={t("log.kinds.medusa")}>
                  {m.status === "failed" ? t("drawer.medusaFailed") : t("drawer.medusaHistory")}
                </InlineTip>
              ) : null}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Fact label={t("drawer.subject")}>{m.subject ?? ""}</Fact>
                <Fact label={t("drawer.recipient")} mono>
                  {m.recipient ?? ""}
                </Fact>
                <Fact label={t("drawer.template")} mono>
                  {m.template}
                  {m.locale ? ` (${m.locale.toUpperCase()})` : ""}
                </Fact>
                <Fact label={t("drawer.trigger")} mono>
                  {m.trigger ?? ""}
                </Fact>
                <Fact label={t("drawer.createdAt")}>{fmtDateTime(m.createdAt, lang)}</Fact>
                <Fact label={t("drawer.sentAt")}>{m.sentAt ? fmtDateTime(m.sentAt, lang) : "-"}</Fact>
                {m.orderId ? (
                  <Fact label={t("drawer.order")}>
                    <OrderLink id={m.orderId} label={m.orderId} open={t("log.openOrder")} />
                  </Fact>
                ) : null}
                {m.externalId ? (
                  <Fact label={demo ? t("drawer.simulatedId") : t("drawer.externalId")} mono>
                    {resendLink(status, m) ? (
                      <ResendLink href={resendLink(status, m)!}>{m.externalId}</ResendLink>
                    ) : (
                      m.externalId
                    )}
                  </Fact>
                ) : null}
                <Fact label={t("drawer.attempts")}>{fmtNumber(m.attempts, lang)}</Fact>
                {m.requestedBy ? <Fact label={t("drawer.requestedBy")}>{m.requestedBy}</Fact> : null}
              </div>
              {q.data?.html ? (
                <div className="flex flex-col gap-y-2">
                  <Text size="small" weight="plus">
                    {t("drawer.body")}
                  </Text>
                  <div className="flex justify-center rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3">
                    <EmailFrame html={q.data.html} title={m.subject ?? m.template} width="desktop" />
                  </div>
                </div>
              ) : (
                <EmptyState compact icon={<EyeSlash />} title={demo ? t("drawer.noBodyDemo") : t("drawer.noBody")} />
              )}
            </>
          ) : null}
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.close")}
            </Button>
          </Drawer.Close>
          {m?.canRetry ? (
            <Button size="small" variant="primary" isLoading={retry.isPending} onClick={() => void onRetry()}>
              {t("drawer.retry")}
            </Button>
          ) : null}
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/* ------------------------------------------------------------------ */
/* A test send                                                         */
/* ------------------------------------------------------------------ */

export function TestDrawer({ status, lang, initial, onClose }: { status: StatusResponse; lang: string; initial: TestInitial | null; onClose: () => void }) {
  const { t } = useTranslation("emails")
  const send = useEmailsTest()
  const [template, setTemplate] = useState(initial?.template ?? status.templates[0]?.key ?? "")
  const [locale, setLocale] = useState<Lang>(initial?.locale ?? (/^pl/i.test(lang) ? "pl" : status.defaultLocale))
  const [source, setSource] = useState<PreviewSource>(initial?.source ?? "sample")
  const [to, setTo] = useState("")
  const current = status.templates.find((x) => x.key === template)

  const submit = async () => {
    const address = to.trim()
    if (!EMAIL_RE.test(address)) {
      toast.error(t("test.invalid"))
      return
    }
    try {
      const r = await send.mutateAsync({ template, to: address, locale, source: current?.latest ? source : "sample" })
      toast.success(t(`test.done.${r.outcome}`, { to: r.to }))
      onClose()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{t("test.title")}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          <KeyPoints
            label={t("test.subtitle")}
            items={[
              { icon: <Envelope />, text: t("test.points.one") },
              { icon: <PaperPlane />, text: t("test.points.path") },
              { icon: <Tag />, text: t("test.points.subject") },
            ]}
          />
          <InlineTip variant={status.mode === "live" ? "warning" : "info"} label={t(`test.mode.${status.mode}.label`)}>
            {t(`test.mode.${status.mode}.text`)}
          </InlineTip>
          <div className="flex flex-col gap-y-1.5">
            <Label size="small" weight="plus">
              {t("test.template")}
            </Label>
            <Select value={template} onValueChange={setTemplate}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {status.templates.map((x) => (
                  <Select.Item key={x.key} value={x.key}>
                    {templateLabel(x, lang)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            {current && !current.enabled ? (
              <Text size="xsmall" className="text-ui-fg-muted">
                {t("test.offNote")}
              </Text>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-y-1.5">
              <Label size="small" weight="plus">
                {t("test.locale")}
              </Label>
              <Select value={locale} onValueChange={(v) => setLocale(v as Lang)}>
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="pl">{t("languages.pl")}</Select.Item>
                  <Select.Item value="en">{t("languages.en")}</Select.Item>
                </Select.Content>
              </Select>
            </div>
            <div className="flex flex-col gap-y-1.5">
              <Label size="small" weight="plus">
                {t("test.source")}
              </Label>
              <Select value={current?.latest ? source : "sample"} onValueChange={(v) => setSource(v as PreviewSource)} disabled={!current?.latest}>
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="sample">{t("gallery.sample")}</Select.Item>
                  <Select.Item value="latest">{t("gallery.latest")}</Select.Item>
                </Select.Content>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-y-1.5">
            <Label size="small" weight="plus" htmlFor="emails-test-to">
              {t("test.to")}
            </Label>
            <Input id="emails-test-to" type="email" placeholder={t("test.placeholder")} value={to} onChange={(e) => setTo(e.target.value)} autoFocus />
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("test.limits", { perUser: status.limits.testsPerUser, minutes: status.limits.testWindowMinutes, perHour: status.limits.testsPerHour })}
            </Text>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("actions.cancel")}
            </Button>
          </Drawer.Close>
          <Button size="small" variant="primary" isLoading={send.isPending} disabled={!template || !to.trim()} onClick={() => void submit()}>
            <PaperPlane />
            {t("test.send")}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
