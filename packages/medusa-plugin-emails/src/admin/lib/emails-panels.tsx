import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowUpRightMini, PaperPlane } from "@medusajs/icons"
import { Badge, Button, Container, Drawer, Heading, InlineTip, Input, Label, Select, Table, Text, clx, toast, usePrompt } from "@medusajs/ui"
import type { MessageDto, MessageFilter, PreviewSource, StatusResponse, TemplateDto } from "../../modules/emails/lib/contract"
import { errorMessage, useEmailsMessage, useEmailsMessages, useEmailsPreview, useEmailsRetry, useEmailsTest } from "./emails-api"
import {
  EmailFrame,
  EmptyRow,
  Fact,
  FilterPills,
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
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("gallery.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("gallery.subtitle")}
        </Text>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-y-2 border-b border-ui-border-base p-4 lg:border-b-0 lg:border-r">
          {templates.map((x) => (
            <TemplateCard key={x.key} template={x} lang={lang} active={x.key === active} onClick={() => setActive(x.key)} />
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
              <FilterPills<Lang>
                value={locale}
                onChange={setLocale}
                options={[
                  { value: "pl", label: "PL" },
                  { value: "en", label: "EN" },
                ]}
              />
              <FilterPills<Theme>
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "light", label: t("gallery.light") },
                  { value: "dark", label: t("gallery.dark") },
                ]}
              />
              <FilterPills<Width>
                value={width}
                onChange={setWidth}
                options={[
                  { value: "desktop", label: t("gallery.desktop") },
                  { value: "mobile", label: t("gallery.phone") },
                ]}
              />
              <FilterPills<PreviewSource>
                value={effectiveSource}
                onChange={setSource}
                options={[
                  { value: "sample", label: t("gallery.sample") },
                  { value: "latest", label: t("gallery.latest"), disabled: !current?.latest },
                ]}
              />
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
                {sourceText ? (
                  <Badge size="2xsmall" color={preview.data?.source === "latest" ? "blue" : "grey"}>
                    {sourceText}
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="flex justify-center p-4">
              {preview.isLoading ? (
                <div className="flex h-[420px] items-center justify-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {t("gallery.rendering")}
                  </Text>
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
              <Text size="xsmall" className="max-w-2xl text-ui-fg-muted">
                {current.latest ? t("gallery.latestNote") : t("gallery.sampleNote")}
              </Text>
              <Button size="small" variant="secondary" onClick={() => onSendTest({ template: current.key, locale, source: effectiveSource })}>
                <PaperPlane />
                {t("gallery.sendThis")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Container>
  )
}

function TemplateCard({ template, lang, active, onClick }: { template: TemplateDto; lang: string; active: boolean; onClick: () => void }) {
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
        {template.source === "app" ? (
          <Badge size="2xsmall" color="orange">
            {t("templates.app")}
          </Badge>
        ) : null}
        {!template.enabled ? (
          <Badge size="2xsmall" color="grey">
            {template.allowed ? t("templates.off") : t("templates.blocked")}
          </Badge>
        ) : null}
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* What was sent                                                       */
/* ------------------------------------------------------------------ */

const FILTERS: MessageFilter[] = ["all", "sent", "attention", "skipped", "test"]

function filterCount(status: StatusResponse, f: MessageFilter): number | undefined {
  const c = status.counts
  if (f === "sent") return c.sent30d
  if (f === "attention") return c.attention30d
  if (f === "skipped") return c.skipped30d
  if (f === "test") return c.tests30d
  return undefined
}

export function MessagesSection({ status, lang, filter, onFilter, onOpen }: { status: StatusResponse; lang: string; filter: MessageFilter; onFilter: (f: MessageFilter) => void; onOpen: (id: string) => void }) {
  const { t } = useTranslation("emails")
  const demo = status.mode === "demo"
  const [search, setSearch] = useState("")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, q])
  const messages = useEmailsMessages({ filter, q, offset: page * PAGE_SIZE, limit: PAGE_SIZE })
  const rows = messages.data?.messages ?? []
  const count = messages.data?.count ?? 0
  const byKey = useMemo(() => new Map(status.templates.map((x) => [x.key, x])), [status.templates])
  const errorText = useErrorText()

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <span className="flex flex-wrap items-center gap-2">
          <Heading level="h2">{demo ? t("log.demoTitle") : t("log.title")}</Heading>
          {demo ? (
            <Badge size="2xsmall" color="purple">
              {t("log.simulated")}
            </Badge>
          ) : null}
        </span>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {demo ? t("log.demoSubtitle") : t("log.subtitle", { days: status.retentionDays })}
        </Text>
      </div>
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <FilterPills<MessageFilter> value={filter} onChange={onFilter} options={FILTERS.map((f) => ({ value: f, label: t(`log.filter.${f}`), count: filterCount(status, f) }))} />
        <div className="w-full lg:w-72">
          <Input size="small" type="search" placeholder={t("log.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {messages.isError ? (
        <div className="px-6 py-4">
          <InlineTip variant="error" label={t("log.title")}>
            {errorMessage(messages.error)}
          </InlineTip>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("log.col.when")}</Table.HeaderCell>
              <Table.HeaderCell>{t("log.col.template")}</Table.HeaderCell>
              <Table.HeaderCell>{t("log.col.recipient")}</Table.HeaderCell>
              <Table.HeaderCell>{t("log.col.subject")}</Table.HeaderCell>
              <Table.HeaderCell>{t("log.col.status")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow cols={6} text={messages.isLoading ? "" : demo ? t("log.demoEmpty") : t("log.empty")} />
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
                      </span>
                      <Text size="xsmall" className="font-mono text-ui-fg-muted">
                        {m.template}
                        {m.locale ? ` ${m.locale.toUpperCase()}` : ""}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap font-mono txt-compact-small">{m.recipient ?? ""}</Table.Cell>
                  <Table.Cell className="max-w-md">
                    <Text size="small" className="line-clamp-2 break-words">
                      {m.subject ?? ""}
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="max-w-xs">
                    <div className="flex flex-col items-start gap-y-1">
                      <MessageStatusBadge message={m} demo={demo} />
                      {m.errorCode ? (
                        <Text size="xsmall" className={m.status === "skipped" ? "text-ui-fg-muted" : "text-ui-tag-red-text"} title={m.error ?? undefined}>
                          {errorText(m.errorCode) || m.errorCode}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <Button size="small" variant="transparent" onClick={() => onOpen(m.id)}>
                      {t("log.details")}
                    </Button>
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
    </Container>
  )
}

/** Counts per template over 30 days. */
export function ByTemplateSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("emails")
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("byTemplate.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("byTemplate.subtitle")}
        </Text>
      </div>
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
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* One message                                                         */
/* ------------------------------------------------------------------ */

export function MessageDrawer({ id, status, lang, onClose }: { id: string; status: StatusResponse; lang: string; onClose: () => void }) {
  const { t } = useTranslation("emails")
  const q = useEmailsMessage(id)
  const retry = useEmailsRetry()
  const prompt = usePrompt()
  const errorText = useErrorText()
  const m: MessageDto | undefined = q.data?.message
  const template = status.templates.find((x) => x.key === m?.template)
  const demo = status.mode === "demo"

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
          {m ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <MessageStatusBadge message={m} demo={demo} />
                <KindBadge kind={m.kind} />
                {m.rotation > 0 ? (
                  <Badge size="2xsmall" color="grey">
                    {t("drawer.retriedTimes", { count: m.rotation })}
                  </Badge>
                ) : null}
              </div>
              {m.error ? (
                <InlineTip variant={m.status === "skipped" ? "info" : "error"} label={errorText(m.errorCode) || m.errorCode || t("drawer.error")}>
                  {m.error}
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
                    <Link to={`/orders/${m.orderId}`} className="inline-flex items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                      <span className="font-mono">{m.orderId}</span>
                      <ArrowUpRightMini />
                    </Link>
                  </Fact>
                ) : null}
                {m.externalId ? (
                  <Fact label={demo ? t("drawer.simulatedId") : t("drawer.externalId")} mono>
                    {m.externalId}
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
                <Text size="xsmall" className="text-ui-fg-muted">
                  {demo ? t("drawer.noBodyDemo") : t("drawer.noBody")}
                </Text>
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
          <Text size="small" className="text-ui-fg-subtle">
            {t("test.subtitle")}
          </Text>
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
