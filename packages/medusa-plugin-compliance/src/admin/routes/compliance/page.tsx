import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, Plus, Trash, XMark } from "@medusajs/icons"
import { Badge, Button, Container, Heading, IconButton, Input, Label, Select, Table, Text, Textarea, clx, toast } from "@medusajs/ui"
import { useCapturePrices, useComplianceStatus, useCreateOperator, useDeleteOperator, useSaveProduct, useUpdateDsr } from "../../lib/compliance-api"
import { ComplianceIcon } from "../../lib/compliance-icon"
import { DsrStatusBadge, EmptyLine, KindBadge, SampleBadge, StatTile, fmtAmount } from "../../lib/compliance-ui"
import type { DsrDto, ProductComplianceDto, ResponsiblePersonDto, StatusResponse } from "../../../modules/compliance/lib/contract"
import type { OperatorKind } from "../../../modules/compliance/lib/constants"

/**
 * EU Compliance by Koda Plus. Three sections, one panel:
 *
 * - GPSR: the responsible persons and the product safety records (who made
 *   the product, who is responsible in the EU, what to warn about).
 * - RODO: the data subject requests queue and the consent summary.
 * - Omnibus: the price history, so a discount can show the lowest price of
 *   the last 30 days.
 */

type Tab = "gpsr" | "rodo" | "omnibus"

const OPERATOR_KINDS: OperatorKind[] = ["manufacturer", "responsible_person", "importer", "authorized_representative"]
const NONE = "__none__"

const CompliancePage = () => {
  const { t } = useTranslation("compliance")
  const [tab, setTab] = useState<Tab>("gpsr")
  const status = useComplianceStatus()

  const allTabs: Array<{ key: Tab; label: string }> = [
    { key: "gpsr", label: t("tabs.gpsr") },
    { key: "rodo", label: t("tabs.rodo") },
    { key: "omnibus", label: t("tabs.omnibus") },
  ]
  const tabs = allTabs.filter((x) => status.data?.sections[x.key] !== false)

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-x-3">
            <span className="flex items-center">
              <ComplianceIcon width={28} height={28} />
            </span>
            <div>
              <div className="flex items-center gap-x-2">
                <Heading>{t("title")}</Heading>
                {status.data?.demo ? <SampleBadge /> : null}
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                {t("by")} / {t("subtitle")}
              </Text>
            </div>
          </div>
        </div>
        <div role="tablist" className="flex flex-wrap gap-1 px-6 pb-3">
          {tabs.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={x.key === tab}
              onClick={() => setTab(x.key)}
              className={clx(
                "rounded-md px-2.5 py-1.5 transition-fg",
                x.key === tab ? "bg-ui-bg-base txt-compact-small-plus text-ui-fg-base shadow-elevation-card-rest" : "txt-compact-small text-ui-fg-subtle hover:bg-ui-bg-base-hover",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
      </Container>

      {status.isError ? (
        <Container className="p-0">
          <Text size="small" className="px-6 py-4 text-ui-fg-error">
            {t("error", { message: String(status.error) })}
          </Text>
        </Container>
      ) : null}

      {tab === "gpsr" ? <GpsrTab status={status.data} loading={status.isLoading} /> : null}
      {tab === "rodo" ? <RodoTab status={status.data} loading={status.isLoading} /> : null}
      {tab === "omnibus" ? <OmnibusTab status={status.data} loading={status.isLoading} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* GPSR                                                                */
/* ------------------------------------------------------------------ */

function GpsrTab({ status, loading }: { status: StatusResponse | undefined; loading: boolean }) {
  const { t } = useTranslation("compliance")
  const [editing, setEditing] = useState<string | null>(null)
  const editingProduct = (status?.products ?? []).find((p) => p.product_id === editing) ?? null

  return (
    <>
      <Container className="p-0">
        <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-4">
          <StatTile label={t("stats.operators")} value={status?.counts.responsible_persons ?? "-"} />
          <StatTile label={t("stats.products")} value={status ? `${status.counts.products_complete}/${status.counts.products_total}` : "-"} tone={status && status.counts.products_total > 0 && status.counts.products_complete < status.counts.products_total ? "orange" : "green"} />
          <StatTile label={t("stats.dsr")} value={status?.counts.dsr_open ?? "-"} tone={status && status.counts.dsr_open > 0 ? "orange" : "default"} />
          <StatTile label={t("stats.snapshots")} value={status?.counts.snapshots ?? "-"} />
        </div>
      </Container>

      <OperatorsCard status={status} loading={loading} />

      <Container className="divide-y p-0">
        <div className="flex flex-col gap-1 px-6 py-4">
          <Heading level="h2">{t("products.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("products.subtitle")}
          </Text>
        </div>
        {loading && !status ? (
          <EmptyLine>{t("loading")}</EmptyLine>
        ) : (status?.products ?? []).length === 0 ? (
          <EmptyLine>{t("products.empty")}</EmptyLine>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{t("products.sku")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("products.product")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("products.manufacturer")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("products.responsible")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("products.state")}</Table.HeaderCell>
                  <Table.HeaderCell />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(status?.products ?? []).map((p) => (
                  <ProductRow key={p.product_id} product={p} operators={status?.responsible_persons ?? []} onEdit={() => setEditing(editing === p.product_id ? null : p.product_id)} />
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
        {editingProduct ? (
          <ProductEditor product={editingProduct} operators={status?.responsible_persons ?? []} onDone={() => setEditing(null)} />
        ) : null}
      </Container>
    </>
  )
}

function OperatorsCard({ status, loading }: { status: StatusResponse | undefined; loading: boolean }) {
  const { t } = useTranslation("compliance")
  const create = useCreateOperator()
  const del = useDeleteOperator()
  const [form, setForm] = useState({ kind: "responsible_person" as OperatorKind, name: "", address: "", email: "", country: "" })
  const operators = status?.responsible_persons ?? []

  const submit = () => {
    if (!form.name.trim()) return
    create.mutate(
      { kind: form.kind, name: form.name, address: form.address || null, email: form.email || null, country_code: form.country || null },
      {
        onSuccess: () => {
          setForm({ kind: "responsible_person", name: "", address: "", email: "", country: "" })
          toast.success(t("toast.created"))
        },
        onError: (e) => toast.error(t("toast.error", { error: e.message })),
      },
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("operators.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("operators.subtitle")}
        </Text>
      </div>
      <div className="grid grid-cols-1 gap-3 px-6 py-4 md:grid-cols-2 xl:grid-cols-6">
        <div className="xl:col-span-2">
          <Label size="xsmall">{t("operators.kind")}</Label>
          <Select size="small" value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as OperatorKind })}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {OPERATOR_KINDS.map((k) => (
                <Select.Item key={k} value={k}>
                  {t(`kind.${k}`)}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <div className="xl:col-span-2">
          <Label size="xsmall">{t("operators.name")}</Label>
          <Input size="small" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("operators.namePlaceholder")} />
        </div>
        <div>
          <Label size="xsmall">{t("operators.country")}</Label>
          <Input size="small" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="PL" maxLength={2} />
        </div>
        <div className="flex items-end">
          <Button size="small" variant="secondary" onClick={submit} disabled={create.isPending || !form.name.trim()}>
            <Plus />
            {t("operators.add")}
          </Button>
        </div>
      </div>
      {loading && !status ? (
        <EmptyLine>{t("loading")}</EmptyLine>
      ) : operators.length === 0 ? (
        <EmptyLine>{t("operators.empty")}</EmptyLine>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("operators.name")}</Table.HeaderCell>
                <Table.HeaderCell>{t("operators.kind")}</Table.HeaderCell>
                <Table.HeaderCell>{t("operators.contact")}</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {operators.map((o) => (
                <Table.Row key={o.id}>
                  <Table.Cell>
                    <span className="flex items-center gap-x-2">
                      <span className="txt-compact-small-plus text-ui-fg-base">{o.name}</span>
                      {o.demo ? <SampleBadge /> : null}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <KindBadge kind={o.kind} />
                  </Table.Cell>
                  <Table.Cell className="text-ui-fg-subtle">{[o.address, o.email, o.country_code].filter(Boolean).join(" / ") || "-"}</Table.Cell>
                  <Table.Cell className="text-right">
                    <IconButton
                      variant="transparent"
                      onClick={() => del.mutate(o.id, { onSuccess: () => toast.success(t("toast.deleted")), onError: (e) => toast.error(t("toast.error", { error: e.message })) })}
                    >
                      <Trash />
                    </IconButton>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}
    </Container>
  )
}

function ProductRow({ product, operators, onEdit }: { product: ProductComplianceDto; operators: ResponsiblePersonDto[]; onEdit: () => void }) {
  const { t } = useTranslation("compliance")
  const byId = useMemo(() => new Map(operators.map((o) => [o.id, o])), [operators])
  const nameOf = (id: string | null) => (id ? (byId.get(id)?.name ?? id) : null)

  return (
    <Table.Row className="cursor-pointer" onClick={onEdit}>
      <Table.Cell className="font-mono txt-compact-xsmall">{product.sku ?? "-"}</Table.Cell>
      <Table.Cell className="txt-compact-small text-ui-fg-base">{product.title ?? product.product_id}</Table.Cell>
      <Table.Cell className="text-ui-fg-subtle">{nameOf(product.manufacturer_id) ?? "-"}</Table.Cell>
      <Table.Cell className="text-ui-fg-subtle">{nameOf(product.responsible_person_id) ?? "-"}</Table.Cell>
      <Table.Cell>
        <Badge size="2xsmall" color={product.complete ? "green" : "orange"}>
          {t(product.complete ? "products.complete" : "products.incomplete")}
        </Badge>
      </Table.Cell>
      <Table.Cell className="text-right text-ui-fg-subtle">{t("products.edit")}</Table.Cell>
    </Table.Row>
  )
}

function ProductEditor({ product, operators, onDone }: { product: ProductComplianceDto; operators: ResponsiblePersonDto[]; onDone: () => void }) {
  const { t } = useTranslation("compliance")
  const save = useSaveProduct()
  const [manufacturer, setManufacturer] = useState(product.manufacturer_id ?? "")
  const [responsible, setResponsible] = useState(product.responsible_person_id ?? "")
  const [warnings, setWarnings] = useState((product.warnings ?? []).join("\n"))
  const [safety, setSafety] = useState(product.safety_info ?? "")

  const submit = () => {
    save.mutate(
      {
        id: product.product_id,
        body: {
          manufacturer_id: manufacturer || null,
          responsible_person_id: responsible || null,
          warnings: warnings.split(/\r?\n/).map((w) => w.trim()).filter(Boolean),
          safety_info: safety || null,
        },
      },
      { onSuccess: () => { toast.success(t("toast.saved")); onDone() }, onError: (e) => toast.error(t("toast.error", { error: e.message })) },
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 border-t border-ui-border-base bg-ui-bg-subtle px-6 py-4 md:grid-cols-2">
      <div className="flex items-center gap-x-2 md:col-span-2">
        <Heading level="h3" className="text-ui-fg-base">
          {product.sku ?? product.product_id}
        </Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {product.title}
        </Text>
      </div>
      <div>
        <Label size="xsmall">{t("products.manufacturer")}</Label>
        <Select size="small" value={manufacturer || NONE} onValueChange={(v) => setManufacturer(v === NONE ? "" : v)}>
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value={NONE}>{t("products.none")}</Select.Item>
            {operators.map((o) => (
              <Select.Item key={o.id} value={o.id}>
                {o.name} ({t(`kind.${o.kind}`)})
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      <div>
        <Label size="xsmall">{t("products.responsible")}</Label>
        <Select size="small" value={responsible || NONE} onValueChange={(v) => setResponsible(v === NONE ? "" : v)}>
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value={NONE}>{t("products.none")}</Select.Item>
            {operators.map((o) => (
              <Select.Item key={o.id} value={o.id}>
                {o.name} ({t(`kind.${o.kind}`)})
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      <div className="md:col-span-2">
        <Label size="xsmall">{t("products.warnings")}</Label>
        <Textarea value={warnings} onChange={(e) => setWarnings(e.target.value)} placeholder={t("products.warningsPlaceholder")} />
      </div>
      <div className="md:col-span-2">
        <Label size="xsmall">{t("products.safety")}</Label>
        <Textarea value={safety} onChange={(e) => setSafety(e.target.value)} placeholder={t("products.safetyPlaceholder")} />
      </div>
      <div className="flex items-center gap-x-2 md:col-span-2">
        <Button size="small" variant="primary" onClick={submit} disabled={save.isPending}>
          {t("products.save")}
        </Button>
        <Button size="small" variant="secondary" onClick={onDone}>
          <XMark />
          {t("products.cancel")}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* RODO                                                                */
/* ------------------------------------------------------------------ */

function RodoTab({ status, loading }: { status: StatusResponse | undefined; loading: boolean }) {
  const { t } = useTranslation("compliance")
  return (
    <>
      <Container className="p-0">
        <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-3">
          <StatTile label={t("stats.dsr")} value={status?.counts.dsr_open ?? "-"} tone={status && status.counts.dsr_open > 0 ? "orange" : "default"} />
          <StatTile label={t("stats.consent")} value={status?.counts.consent_total ?? "-"} />
        </div>
      </Container>

      <Container className="divide-y p-0">
        <div className="flex flex-col gap-1 px-6 py-4">
          <Heading level="h2">{t("dsr.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("dsr.subtitle")}
          </Text>
        </div>
        {loading && !status ? (
          <EmptyLine>{t("loading")}</EmptyLine>
        ) : (status?.dsr ?? []).length === 0 ? (
          <EmptyLine>{t("dsr.empty")}</EmptyLine>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{t("dsr.when")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("dsr.customer")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("dsr.type")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("dsr.status")}</Table.HeaderCell>
                  <Table.HeaderCell />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(status?.dsr ?? []).map((d) => (
                  <DsrRow key={d.id} dsr={d} />
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </Container>

      <Container className="divide-y p-0">
        <div className="flex flex-col gap-1 px-6 py-4">
          <Heading level="h2">{t("consent.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("consent.subtitle")}
          </Text>
        </div>
        {(status?.consent ?? []).length === 0 ? (
          <EmptyLine>{t("consent.empty")}</EmptyLine>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{t("consent.purpose")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("consent.granted")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("consent.declined")}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(status?.consent ?? []).map((c) => (
                  <Table.Row key={c.purpose}>
                    <Table.Cell className="txt-compact-small-plus text-ui-fg-base">{t(`purpose.${c.purpose}`)}</Table.Cell>
                    <Table.Cell className="tabular-nums">{c.granted}</Table.Cell>
                    <Table.Cell className="tabular-nums">{c.declined}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </Container>
    </>
  )
}

function DsrRow({ dsr }: { dsr: DsrDto }) {
  const { t } = useTranslation("compliance")
  const update = useUpdateDsr()
  const done = (status: "completed" | "rejected") => update.mutate({ id: dsr.id, body: { status } }, { onSuccess: () => toast.success(t("toast.saved")), onError: (e) => toast.error(t("toast.error", { error: e.message })) })
  return (
    <Table.Row>
      <Table.Cell className="text-ui-fg-subtle">{new Date(dsr.created_at).toLocaleDateString()}</Table.Cell>
      <Table.Cell className="text-ui-fg-base">{dsr.customer_email ?? dsr.customer_id}</Table.Cell>
      <Table.Cell>
        <Badge size="2xsmall" color="grey">
          {t(`type.${dsr.type}`)}
        </Badge>
      </Table.Cell>
      <Table.Cell>
        <DsrStatusBadge status={dsr.status} />
      </Table.Cell>
      <Table.Cell className="text-right">
        {dsr.status === "pending" || dsr.status === "in_progress" ? (
          <div className="flex justify-end gap-x-1">
            <Button size="small" variant="secondary" onClick={() => done("completed")} disabled={update.isPending}>
              {t("dsr.complete")}
            </Button>
            <Button size="small" variant="transparent" onClick={() => done("rejected")} disabled={update.isPending}>
              {t("dsr.reject")}
            </Button>
          </div>
        ) : null}
      </Table.Cell>
    </Table.Row>
  )
}

/* ------------------------------------------------------------------ */
/* Omnibus                                                             */
/* ------------------------------------------------------------------ */

function OmnibusTab({ status, loading }: { status: StatusResponse | undefined; loading: boolean }) {
  const { t } = useTranslation("compliance")
  const capture = useCapturePrices()
  return (
    <>
      <Container className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex flex-col gap-1">
            <Heading level="h2">{t("prices.title")}</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {t("prices.subtitle")}
            </Text>
          </div>
          <Button size="small" variant="secondary" onClick={() => capture.mutate(undefined, { onSuccess: (d) => toast.success(t("prices.captured", { n: d.captured })), onError: (e) => toast.error(t("toast.error", { error: e.message })) })} disabled={capture.isPending}>
            <ArrowPath className={capture.isPending ? "animate-spin" : ""} />
            {t("prices.capture")}
          </Button>
        </div>
      </Container>

      <Container className="divide-y p-0">
        {loading && !status ? (
          <EmptyLine>{t("loading")}</EmptyLine>
        ) : (status?.prices ?? []).length === 0 ? (
          <EmptyLine>{t("prices.empty")}</EmptyLine>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{t("prices.sku")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("prices.product")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("prices.current")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("prices.lowest")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("prices.snapshots")}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(status?.prices ?? []).map((p) => (
                  <Table.Row key={`${p.sku}-${p.currency_code}`}>
                    <Table.Cell className="font-mono txt-compact-xsmall">{p.sku}</Table.Cell>
                    <Table.Cell className="txt-compact-small text-ui-fg-base">{p.title ?? p.product_id}</Table.Cell>
                    <Table.Cell className="tabular-nums">{fmtAmount(p.amount, p.currency_code)}</Table.Cell>
                    <Table.Cell className="tabular-nums text-ui-fg-subtle">{fmtAmount(p.lowest_30d, p.currency_code)}</Table.Cell>
                    <Table.Cell className="tabular-nums text-ui-fg-subtle">{p.snapshots}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </Container>
    </>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "compliance",
  icon: ComplianceIcon,
})

export default CompliancePage
