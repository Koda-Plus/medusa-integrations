import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge, Button, Container, Copy, Heading, InlineTip, Input, Label, Switch, Table, Text, toast } from "@medusajs/ui"
import type { LabelSize, ParcelSize, SenderDto, StatusResponse, WriterDto, WriterKey } from "../../modules/inpost/lib/contract"
import { errorMessage, useInpostCheck, useInpostEvents, useInpostSettings, useInpostWriter } from "./inpost-api"
import { nb } from "./inpost-guide"
import { Chip, Fact, fmtDateTime, fmtDuration, useActorLabel, useEventText, useStatusName } from "./inpost-ui"

/* ------------------------------------------------------------------ */
/* The InPost account                                                  */
/* ------------------------------------------------------------------ */

export function AccountSection({ status: s, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("inpost")
  const check = useInpostCheck()
  const demo = s.mode === "demo"
  const result = check.data?.result ?? s.lastCheck

  const onCheck = async () => {
    try {
      const r = await check.mutateAsync()
      if (r.result.ok) toast.success(t("toast.checkOk"))
      else toast.error(t("toast.checkFailed", { error: r.result.error ?? "?" }))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-3xl flex-col gap-1">
          <Heading level="h2">{t("account.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {demo ? t("account.demoNote") : t("account.subtitle")}
          </Text>
        </div>
        <Button size="small" variant="secondary" isLoading={check.isPending} disabled={!s.configured} onClick={() => void onCheck()}>
          {t("actions.check")}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label={t("account.mode")}>
          <Badge size="2xsmall" color={demo ? "purple" : s.sandbox ? "blue" : "green"}>
            {demo ? t("mode.demo") : s.sandbox ? t("mode.sandbox") : t("mode.live")}
          </Badge>
        </Fact>
        <Fact label={t("account.sandbox")}>
          {s.sandbox ? t("account.sandboxOn") : t("account.sandboxOff")}
          <span className="block text-ui-fg-muted txt-compact-xsmall">{t("account.sandboxHint")}</span>
        </Fact>
        <Fact label={t("account.token")}>{demo ? "-" : s.tokenSet ? t("account.tokenSet") : <span className="text-ui-tag-red-text">{t("account.tokenMissing")}</span>}</Fact>
        <Fact label={t("account.organization")} mono>
          {demo ? "-" : (s.organizationId ?? <span className="font-sans text-ui-tag-red-text">{t("account.notSet")}</span>)}
        </Fact>
        <Fact label={t("account.lastCheck")}>
          {result ? (
            result.ok ? (
              <span>
                {t("account.checkOk", { name: result.organization?.name ?? "" })}
                <span className="block text-ui-fg-muted txt-compact-xsmall">{fmtDateTime(result.checkedAt, lang)}</span>
              </span>
            ) : (
              <span className="text-ui-tag-red-text">{result.error}</span>
            )
          ) : (
            t("account.never")
          )}
        </Fact>
        <Fact label={t("account.manager")}>
          <a href={s.links.manager} target="_blank" rel="noreferrer" className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {s.links.manager.replace(/^https:\/\//, "")}
          </a>
        </Fact>
        <Fact label={t("account.lastRun")}>{s.lastRun ? `${fmtDateTime(s.lastRun.occurredAt, lang)} (${t("account.lastRunCounts", { read: s.lastRun.counts.read ?? 0, changed: s.lastRun.counts.changed ?? 0 })})` : t("account.never")}</Fact>
        <Fact label={t("account.schedule")}>{t("account.scheduleText")}</Fact>
      </div>
      <div className="flex flex-col gap-3 px-6 py-4">
        <Text size="small" weight="plus">
          {t("webhook.title")}
        </Text>
        {demo ? (
          <Text size="small" className="text-ui-fg-subtle">
            {t("webhook.demo")}
          </Text>
        ) : s.webhook.invalid ? (
          <InlineTip variant="warning" label={t("webhook.title")}>
            {t("webhook.invalid")}
          </InlineTip>
        ) : s.webhook.url ? (
          <div className="flex flex-col gap-y-2">
            <div className="flex items-center gap-x-2">
              <code className="txt-compact-small break-all rounded-md bg-ui-bg-subtle px-2 py-1 font-mono">{s.webhook.url}</code>
              <Copy content={s.webhook.url} />
            </div>
            <Text size="xsmall" className="text-ui-fg-muted">
              {s.webhook.lastAt ? t("webhook.last", { time: fmtDateTime(s.webhook.lastAt, lang), event: s.webhook.lastEvent ?? "" }) : t("webhook.none")}
            </Text>
          </div>
        ) : (
          <Text size="small" className="text-ui-fg-subtle">
            {t("webhook.off")}
          </Text>
        )}
      </div>
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* Shipping: sender, default parcel, label size                        */
/* ------------------------------------------------------------------ */

const SENDER_FIELDS: Array<keyof SenderDto> = ["companyName", "firstName", "lastName", "email", "phone", "street", "buildingNumber", "flatNumber", "city", "postCode"]
const SIZES: ParcelSize[] = ["small", "medium", "large"]
const LABELS: LabelSize[] = ["A6", "A4"]

export function ShippingSection({ status: s }: { status: StatusResponse }) {
  const { t } = useTranslation("inpost")
  const save = useInpostSettings()
  const [sender, setSender] = useState<SenderDto>(s.settings.sender)
  const [size, setSize] = useState<ParcelSize>(s.settings.defaultParcelSize)
  const [label, setLabel] = useState<LabelSize>(s.settings.labelFormat)
  useEffect(() => {
    setSender(s.settings.sender)
    setSize(s.settings.defaultParcelSize)
    setLabel(s.settings.labelFormat)
  }, [s.settings])

  const onSave = async () => {
    try {
      await save.mutateAsync({ sender, defaultParcelSize: size, labelFormat: label })
      toast.success(t("toast.saved"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const onClearSender = async () => {
    try {
      await save.mutateAsync({ sender: null, defaultParcelSize: size, labelFormat: label })
      toast.success(t("toast.saved"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("shipping.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {s.mode === "demo" ? t("shipping.subtitleDemo") : t("shipping.subtitle")}
        </Text>
      </div>
      <div className="grid grid-cols-1 gap-6 px-6 py-4 md:grid-cols-2">
        <div className="flex flex-col gap-y-2">
          <Text size="small" weight="plus">
            {t("shipping.size")}
          </Text>
          <div className="flex flex-wrap gap-2">
            {SIZES.map((x) => (
              <Chip key={x} active={size === x} label={t(`size.long.${x}`)} onClick={() => setSize(x)} />
            ))}
          </div>
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("shipping.sizeHint")}
          </Text>
        </div>
        <div className="flex flex-col gap-y-2">
          <Text size="small" weight="plus">
            {t("shipping.label")}
          </Text>
          <div className="flex flex-wrap gap-2">
            {LABELS.map((x) => (
              <Chip key={x} active={label === x} label={t(`shipping.labels.${x}`)} onClick={() => setLabel(x)} />
            ))}
          </div>
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("shipping.labelHint")}
          </Text>
        </div>
      </div>
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Text size="small" weight="plus">
            {t("shipping.sender")}
          </Text>
          <Badge size="2xsmall" color={s.settings.senderSent ? "green" : "grey"}>
            {s.settings.senderSent ? t("shipping.senderSent") : t("shipping.senderOrganization")}
          </Badge>
          <Badge size="2xsmall" color="grey">
            {t(`shipping.source.${s.settings.source.sender}`)}
          </Badge>
        </div>
        <Text size="xsmall" className="max-w-3xl text-ui-fg-muted">
          {t("shipping.senderHint")}
        </Text>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SENDER_FIELDS.map((field) => (
            <div key={field} className="flex flex-col gap-y-1">
              <Label size="xsmall" weight="plus" htmlFor={`inpost-sender-${field}`}>
                {t(`shipping.fields.${field}`)}
              </Label>
              <Input id={`inpost-sender-${field}`} size="small" value={sender[field]} onChange={(e) => setSender({ ...sender, [field]: e.target.value })} />
            </div>
          ))}
        </div>
        <Text size="xsmall" className="text-ui-fg-muted">
          {s.settings.senderAddress ? t("shipping.pickupReady") : t("shipping.pickupNeedsAddress")}
        </Text>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 px-6 py-3">
        <Button size="small" variant="secondary" disabled={s.settings.source.sender !== "admin"} isLoading={save.isPending} onClick={() => void onClearSender()}>
          {t("shipping.clearSender")}
        </Button>
        <Button size="small" variant="primary" isLoading={save.isPending} onClick={() => void onSave()}>
          {t("actions.save")}
        </Button>
      </div>
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* Writers                                                             */
/* ------------------------------------------------------------------ */

const WRITER_KEYS: WriterKey[] = ["shipment", "fulfillmentStatus"]
const WRITER_OPTION: Record<WriterKey, string> = { shipment: "shipmentWriter", fulfillmentStatus: "fulfillmentStatusWriter" }

function WriterRow({ writer, lang, busy, onFlip }: { writer: WriterDto; lang: string; busy: boolean; onFlip: (on: boolean) => void }) {
  const { t } = useTranslation("inpost")
  return (
    <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
      <div className="flex max-w-3xl flex-col gap-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {t(`writers.names.${writer.key}`)}
          </Text>
          <Badge size="2xsmall" color={writer.armed ? "orange" : writer.allowed ? "grey" : "red"}>
            {writer.armed ? t("writers.armed") : writer.allowed ? t("writers.disarmed") : t("writers.blocked")}
          </Badge>
        </span>
        <Text size="small" className="text-ui-fg-subtle">
          {t(`writers.descriptions.${writer.key}`)}
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          {!writer.allowed
            ? t("writers.blockedHint", { option: `${WRITER_OPTION[writer.key]}: true` })
            : writer.updatedAt
              ? t(writer.on ? "writers.onBy" : "writers.offBy", { who: writer.updatedBy ?? "-", time: fmtDateTime(writer.updatedAt, lang) })
              : t("writers.never")}
        </Text>
      </div>
      <Switch checked={writer.on && writer.allowed} disabled={!writer.allowed || busy} onCheckedChange={(v) => onFlip(v === true)} aria-label={t(`writers.names.${writer.key}`)} />
    </div>
  )
}

export function WritersSection({ status: s, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("inpost")
  const toggle = useInpostWriter()
  const flip = async (writer: WriterKey, on: boolean) => {
    try {
      await toggle.mutateAsync({ writer, on })
      toast.success(t(on ? "toast.armed" : "toast.disarmed", { name: t(`writers.names.${writer}`) }))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("writers.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("writers.subtitle")}
        </Text>
      </div>
      {s.mode === "demo" ? (
        <div className="px-6 py-3">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("writers.demo")}
          </Text>
        </div>
      ) : null}
      {WRITER_KEYS.map((key) => (
        <WriterRow key={key} writer={s.writers[key]} lang={lang} busy={toggle.isPending && toggle.variables?.writer === key} onFlip={(on) => void flip(key, on)} />
      ))}
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Text size="small" weight="plus">
          {t("writers.autoTitle")}
        </Text>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {s.autoCreate ? t("writers.autoOn") : t("writers.autoOff")}
        </Text>
      </div>
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

const KINDS = ["all", "run", "webhook", "action", "status"] as const

export function HistorySection({ lang }: { lang: string }) {
  const { t } = useTranslation("inpost")
  const statusName = useStatusName()
  const eventText = useEventText()
  const actorLabel = useActorLabel()
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all")
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [kind])
  const q = useInpostEvents(kind, page * 20)
  const rows = q.data?.events ?? []
  const count = q.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / 20))
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("history.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("history.subtitle")}
        </Text>
      </div>
      <div className="flex flex-wrap gap-2 px-6 py-3">
        {KINDS.map((k) => (
          <Chip key={k} active={kind === k} label={t(`history.kinds.${k}`)} onClick={() => setKind(k)} />
        ))}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("history.col.when")}</Table.HeaderCell>
              <Table.HeaderCell>{t("history.col.kind")}</Table.HeaderCell>
              <Table.HeaderCell>{t("history.col.what")}</Table.HeaderCell>
              <Table.HeaderCell>{t("history.col.who")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <Table.Row>
                <td colSpan={4} className="px-6 py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {q.isLoading ? "" : t("history.empty")}
                  </Text>
                </td>
              </Table.Row>
            ) : (
              rows.map((e) => {
                const counts = e.data && typeof e.data === "object" ? (e.data as Record<string, unknown>) : {}
                const what =
                  e.kind === "run"
                    ? t("history.run", { read: Number(counts.read ?? 0), changed: Number(counts.changed ?? 0), created: Number(counts.created ?? 0), errors: Number(counts.errors ?? 0), duration: fmtDuration(Number(counts.durationMs ?? 0)) })
                    : e.kind === "status" && e.previousStatus
                      ? `${statusName(e.previousStatus)} > ${statusName(e.status)}`
                      : eventText(e)
                return (
                  <Table.Row key={e.id} className="align-top [&_td]:py-2">
                    <Table.Cell className="whitespace-nowrap">{fmtDateTime(e.occurredAt, lang)}</Table.Cell>
                    <Table.Cell className="whitespace-nowrap">
                      {t(`history.kinds.${e.kind}`, { defaultValue: e.kind })}
                      {e.shipmentId ? <span className="block font-mono text-ui-fg-muted txt-compact-xsmall">{e.shipmentId}</span> : null}
                    </Table.Cell>
                    <Table.Cell className="max-w-xl">
                      <Text size="small">{nb(what)}</Text>
                      {e.kind === "run" && e.message ? (
                        <Text size="xsmall" className="whitespace-pre-line text-ui-tag-red-text">
                          {e.message}
                        </Text>
                      ) : null}
                    </Table.Cell>
                    <Table.Cell className="whitespace-nowrap">{actorLabel(e.actor) ?? t(`detail.source.${e.source ?? "system"}`, { defaultValue: e.source ?? "" })}</Table.Cell>
                  </Table.Row>
                )
              })
            )}
          </Table.Body>
        </Table>
      </div>
      <Table.Pagination
        count={count}
        pageSize={20}
        pageIndex={page}
        pageCount={pageCount}
        canPreviousPage={page > 0}
        canNextPage={page + 1 < pageCount}
        previousPage={() => setPage((x) => Math.max(0, x - 1))}
        nextPage={() => setPage((x) => x + 1)}
        translations={{ of: t("pagination.of"), results: t("pagination.results"), pages: t("pagination.pages"), prev: t("pagination.prev"), next: t("pagination.next") }}
      />
    </Container>
  )
}
