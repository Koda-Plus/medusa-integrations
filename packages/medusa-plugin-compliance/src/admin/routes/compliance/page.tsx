import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  ArrowPath,
  ArrowUpRightOnBox,
  BarsArrowDown,
  Buildings,
  BuildingStorefront,
  Calendar,
  CheckCircle,
  CircleStack,
  ExclamationCircle,
  BellAlert,
  ListBullet,
  PencilSquare,
  Plus,
  ReceiptPercent,
  ShieldCheck,
  Trash,
  User,
  Users,
  XCircle,
  XMark,
} from "@medusajs/icons"
import { Button, Container, Heading, IconButton, InlineTip, Input, Label, Select, Table, Text, Textarea, toast } from "@medusajs/ui"
import { KitFetchingBar, KitLoading, KitSkeletonRows, announce } from "../../lib/compliance-kit"
import { HelpButtons, IntegrationHeader, ModeBadge, SettingsView, communityLabels, usePageNav } from "../../lib/compliance-guide"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, StatTile, StatTiles, ToneBadge } from "../../lib/compliance-blocks"
import { GuideView, usePromptSpec } from "../../lib/compliance-guide-view"
import { errorMessage, useCapturePrices, useComplianceStatus, useCreateOperator, useDeleteOperator, useSaveProduct, useUpdateDsr } from "../../lib/compliance-api"
import { ComplianceIcon } from "../../lib/compliance-icon"
import { DsrStatusBadge, KindBadge, OptionsTab, SETTINGS_TABS, fmtAmount, type SettingsTabId } from "../../lib/compliance-ui"
import type { DsrDto, ProductComplianceDto, ResponsiblePersonDto, StatusResponse } from "../../../modules/compliance/lib/contract"
import type { OperatorKind } from "../../../modules/compliance/lib/constants"

/* The host of the koda.integration/1 cards learns about this plugin. */
announce({ ns: "compliance", name: "Compliance", adminPath: "/compliance", Icon: ComplianceIcon })

/**
 * EU Compliance by Koda Plus. Three sections of one panel, switched by the
 * buttons under the header (`?section=`):
 *
 * - GPSR: the economic operators and the product safety records.
 * - RODO: the data subject requests queue and the consent summary.
 * - Omnibus: the price history, so a discount can show the lowest price of
 *   the last 30 days.
 *
 * Setup guide and the options in use behind the tabs. `?q=` searches the
 * list of the open section.
 */

type Part = "gpsr" | "rodo" | "omnibus"
const PARTS: Part[] = ["gpsr", "rodo", "omnibus"]
const PART_ICON: Record<Part, ReactNode> = { gpsr: <ShieldCheck />, rodo: <Users />, omnibus: <ReceiptPercent /> }

const OPERATOR_KINDS: OperatorKind[] = ["manufacturer", "responsible_person", "importer", "authorized_representative"]
const NONE = "__none__"

const CompliancePage = () => {
  const { t, i18n } = useTranslation("compliance")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const status = useComplianceStatus()
  const s = status.data
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)

  const [params, setParams] = useSearchParams()
  const parts = PARTS.filter((p) => s?.sections[p] !== false)
  const asked = params.get("section") as Part | null
  const part: Part = asked && parts.includes(asked) ? asked : (parts[0] ?? "gpsr")
  const [q, setQ] = useState(params.get("q") ?? "")
  useEffect(() => {
    const p = new URLSearchParams(params)
    if (q) p.set("q", q)
    else p.delete("q")
    if (p.toString() !== params.toString()) setParams(p, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])
  const setPart = (next: Part) => {
    const p = new URLSearchParams(params)
    if (next === parts[0]) p.delete("section")
    else p.set("section", next)
    p.delete("q")
    setQ("")
    setParams(p, { replace: true })
  }

  const onRefresh = async () => {
    const r = await status.refetch()
    if (r.isError) toast.error(t("toast.error", { error: errorMessage(r.error) }))
    else toast.success(t("toast.refreshed"))
  }
  const refresh = { key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, loading: status.isFetching, onClick: () => void onRefresh() }
  const open =
    part === "rodo"
      ? { key: "customers", label: t("actions.customers"), icon: <ArrowUpRightOnBox />, onClick: () => window.location.assign("/app/customers") }
      : { key: "products", label: t("actions.products"), icon: <ArrowUpRightOnBox />, onClick: () => window.location.assign("/app/products") }

  const c = s?.counts
  const incomplete = c ? c.products_total - c.products_complete : 0
  const partCount: Record<Part, number | undefined> = { gpsr: incomplete, rodo: c?.dsr_open, omnibus: s?.prices.length }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <IntegrationHeader
          icon={<ComplianceIcon width={28} height={28} />}
          title={t("title")}
          badges={
            s?.demo ? (
              <ModeBadge color="blue" label={t("mode.demo")} title={t("mode.demoTitle")}>
                <Text size="small">{t("mode.demoText")}</Text>
              </ModeBadge>
            ) : null
          }
          description={t("subtitle")}
          points={[
            s?.sections.gpsr !== false && { icon: <ShieldCheck />, text: t("points.gpsr") },
            s?.sections.rodo !== false && { icon: <Users />, text: t("points.rodo") },
            s?.sections.omnibus !== false && { icon: <ReceiptPercent />, text: t("points.omnibus") },
            { icon: <BuildingStorefront />, text: t("points.store") },
          ]}
          help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
          view={nav.view}
          onView={(v) => nav.go(v)}
          labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("view.settings"), more: t("actions.more") }}
          actions={nav.view === "panel" ? [refresh, open] : nav.view === "settings" ? [refresh] : []}
        />
        <KitFetchingBar active={status.isFetching && !status.isLoading} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {nav.view !== "guide" && !s && status.isLoading ? <KitLoading label={t("loading")} /> : null}
        {nav.view === "panel" && s && parts.length > 1 ? (
          <FilterBar>
            {parts.map((p) => (
              <FilterButton key={p} icon={PART_ICON[p]} label={t(`tabs.${p}`)} count={partCount[p]} attention={p !== "omnibus"} active={part === p} onClick={() => setPart(p)} />
            ))}
          </FilterBar>
        ) : null}
        {nav.view === "panel" && s && part === "gpsr" ? (
          <StatTiles columns={4}>
            <StatTile label={t("stats.operators")} value={s.counts.responsible_persons} hint={t("stats.operatorsHint")} icon={<Buildings />} />
            <StatTile label={t("stats.products")} value={`${s.counts.products_complete}/${s.counts.products_total}`} hint={t("stats.productsHint")} icon={<CheckCircle />} tone={s.counts.products_total > 0 && incomplete === 0 ? "green" : "grey"} />
            <StatTile label={t("stats.incomplete")} value={incomplete} hint={t("stats.incompleteHint")} icon={<ExclamationCircle />} tone={incomplete > 0 ? "orange" : "grey"} />
            <StatTile label={t("stats.dsr")} value={s.counts.dsr_open} hint={t("stats.dsrHint")} icon={<Users />} tone={s.counts.dsr_open > 0 ? "orange" : "grey"} onClick={parts.includes("rodo") ? () => setPart("rodo") : undefined} />
          </StatTiles>
        ) : null}
        {nav.view === "panel" && s && part === "rodo" ? (
          <StatTiles columns={3}>
            <StatTile label={t("stats.dsr")} value={s.counts.dsr_open} hint={t("stats.dsrHint")} icon={<ExclamationCircle />} tone={s.counts.dsr_open > 0 ? "orange" : "grey"} />
            <StatTile label={t("stats.dsrAll")} value={s.dsr.length} hint={t("stats.dsrAllHint")} icon={<ListBullet />} />
            <StatTile label={t("stats.consent")} value={s.counts.consent_total} hint={t("stats.consentHint")} icon={<CheckCircle />} />
          </StatTiles>
        ) : null}
        {nav.view === "panel" && s && part === "omnibus" ? (
          <StatTiles columns={2}>
            <StatTile label={t("stats.prices")} value={s.prices.length} hint={t("stats.pricesHint")} icon={<ReceiptPercent />} />
            <StatTile label={t("stats.snapshots")} value={s.counts.snapshots} hint={t("stats.snapshotsHint")} icon={<CircleStack />} />
          </StatTiles>
        ) : null}
      </Container>

      {nav.view === "guide" ? <GuideView status={s} /> : null}

      {nav.view === "settings" && s ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[{ id: "options", label: t("settings.tab.options") }]}
        >
          <OptionsTab status={s} />
        </SettingsView>
      ) : null}

      {nav.view === "panel" && s && part === "gpsr" ? <GpsrPart status={s} loading={status.isLoading} q={q} onQ={setQ} /> : null}
      {nav.view === "panel" && s && part === "rodo" ? <RodoPart status={s} /> : null}
      {nav.view === "panel" && s && part === "omnibus" ? <OmnibusPart status={s} q={q} onQ={setQ} /> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* GPSR                                                                */
/* ------------------------------------------------------------------ */

type ProductFilter = "all" | "incomplete" | "complete"

function GpsrPart({ status, loading, q, onQ }: { status: StatusResponse; loading: boolean; q: string; onQ: (v: string) => void }) {
  const { t } = useTranslation("compliance")
  const [editing, setEditing] = useState<string | null>(null)
  const [filter, setFilter] = useState<ProductFilter>("all")
  const toggle = (f: ProductFilter) => setFilter((cur) => (cur === f ? "all" : f))
  const needle = q.trim().toLowerCase()
  const products = status.products
  const rows = useMemo(
    () =>
      products.filter((p) => {
        if (filter === "incomplete" && p.complete) return false
        if (filter === "complete" && !p.complete) return false
        return !needle || [p.sku, p.title, p.product_id].some((x) => (x ?? "").toLowerCase().includes(needle))
      }),
    [products, filter, needle],
  )
  const incomplete = products.filter((p) => !p.complete).length
  const editingProduct = products.find((p) => p.product_id === editing) ?? null

  return (
    <>
      <OperatorsCard status={status} />
      <Section
        icon={<ShieldCheck />}
        title={t("products.title")}
        points={[
          { icon: <Buildings />, text: t("products.points.who") },
          { icon: <BellAlert />, text: t("products.points.warnings") },
          { icon: <BuildingStorefront />, text: t("products.points.offer") },
        ]}
        actions={<SearchInput value={q} onChange={onQ} placeholder={t("products.search")} />}
      >
        <FilterBar>
          <FilterButton icon={<ListBullet />} label={t("products.filter.all")} count={products.length} active={filter === "all"} onClick={() => setFilter("all")} />
          <FilterDivider />
          <FilterButton icon={<ExclamationCircle />} label={t("products.filter.incomplete")} count={incomplete} attention active={filter === "incomplete"} onClick={() => toggle("incomplete")} />
          <FilterButton icon={<CheckCircle />} label={t("products.filter.complete")} count={products.length - incomplete} active={filter === "complete"} onClick={() => toggle("complete")} />
        </FilterBar>
        <div className="overflow-x-auto">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("products.sku")}</Table.HeaderCell>
                <Table.HeaderCell>{t("products.product")}</Table.HeaderCell>
                <Table.HeaderCell>{t("products.manufacturer")}</Table.HeaderCell>
                <Table.HeaderCell>{t("products.responsible")}</Table.HeaderCell>
                <Table.HeaderCell>{t("products.state")}</Table.HeaderCell>
                <Table.HeaderCell className="w-px" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {loading && rows.length === 0 ? <KitSkeletonRows cols={6} /> : null}
              {!loading && rows.length === 0 ? <EmptyTableRow cols={6} icon={<ShieldCheck />} title={products.length === 0 ? t("products.empty") : t("products.emptySearch")} /> : null}
              {rows.map((p) => (
                <ProductRow key={p.product_id} product={p} operators={status.responsible_persons} onEdit={() => setEditing(editing === p.product_id ? null : p.product_id)} />
              ))}
            </Table.Body>
          </Table>
        </div>
        {editingProduct ? <ProductEditor key={editingProduct.product_id} product={editingProduct} operators={status.responsible_persons} onDone={() => setEditing(null)} /> : null}
      </Section>
    </>
  )
}

function OperatorsCard({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("compliance")
  const create = useCreateOperator()
  const del = useDeleteOperator()
  const [form, setForm] = useState({ kind: "responsible_person" as OperatorKind, name: "", address: "", email: "", country: "" })
  const operators = status.responsible_persons

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
    <Section
      icon={<Buildings />}
      title={t("operators.title")}
      points={[
        { icon: <Buildings />, text: t("operators.points.kinds") },
        { icon: <CheckCircle />, text: t("operators.points.complete"), tone: "green" },
      ]}
    >
      <form
        className="grid grid-cols-1 gap-3 px-6 py-4 md:grid-cols-2 xl:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="flex flex-col gap-y-1 xl:col-span-2">
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
        <div className="flex flex-col gap-y-1 xl:col-span-2">
          <Label size="xsmall">{t("operators.name")}</Label>
          <Input size="small" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("operators.namePlaceholder")} />
        </div>
        <div className="flex flex-col gap-y-1">
          <Label size="xsmall">{t("operators.country")}</Label>
          <Input size="small" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="PL" maxLength={2} />
        </div>
        <div className="flex items-end">
          <Button type="submit" size="small" variant="secondary" isLoading={create.isPending} disabled={!form.name.trim()}>
            <Plus />
            {t("operators.add")}
          </Button>
        </div>
      </form>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("operators.name")}</Table.HeaderCell>
              <Table.HeaderCell>{t("operators.kind")}</Table.HeaderCell>
              <Table.HeaderCell>{t("operators.contact")}</Table.HeaderCell>
              <Table.HeaderCell className="w-px" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {operators.length === 0 ? <EmptyTableRow cols={4} icon={<Buildings />} title={t("operators.empty")} points={[{ icon: <Plus />, text: t("operators.emptyHint") }]} /> : null}
            {operators.map((o) => (
              <Table.Row key={o.id}>
                <Table.Cell>
                  <span className="flex items-center gap-x-2">
                    <span className="txt-compact-small-plus text-ui-fg-base">{o.name}</span>
                    {o.demo ? <ToneBadge tone="blue">{t("mode.demo")}</ToneBadge> : null}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <KindBadge kind={o.kind} />
                </Table.Cell>
                <Table.Cell className="text-ui-fg-subtle">{[o.address, o.email, o.country_code].filter(Boolean).join(" / ") || "-"}</Table.Cell>
                <Table.Cell className="text-right">
                  <RowActions
                    actions={[
                      {
                        key: "delete",
                        label: t("operators.remove"),
                        icon: <Trash />,
                        danger: true,
                        loading: del.isPending && del.variables === o.id,
                        disabled: del.isPending,
                        onClick: () => del.mutate(o.id, { onSuccess: () => toast.success(t("toast.deleted")), onError: (e) => toast.error(t("toast.error", { error: e.message })) }),
                      },
                    ]}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

function ProductRow({ product, operators, onEdit }: { product: ProductComplianceDto; operators: ResponsiblePersonDto[]; onEdit: () => void }) {
  const { t } = useTranslation("compliance")
  const byId = useMemo(() => new Map(operators.map((o) => [o.id, o])), [operators])
  const nameOf = (id: string | null) => (id ? (byId.get(id)?.name ?? id) : null)

  return (
    <Table.Row className="cursor-pointer" onClick={onEdit}>
      <Table.Cell className="font-mono txt-compact-xsmall">{product.sku ?? "-"}</Table.Cell>
      <Table.Cell>
        <span className="flex items-center gap-x-2">
          <Link to={`/products/${product.product_id}`} onClick={(e) => e.stopPropagation()} className="txt-compact-small-plus text-ui-fg-base hover:text-ui-fg-interactive">
            {product.title ?? product.product_id}
          </Link>
          {product.demo ? <ToneBadge tone="blue">{t("mode.demo")}</ToneBadge> : null}
        </span>
      </Table.Cell>
      <Table.Cell className="text-ui-fg-subtle">{nameOf(product.manufacturer_id) ?? "-"}</Table.Cell>
      <Table.Cell className="text-ui-fg-subtle">{nameOf(product.responsible_person_id) ?? "-"}</Table.Cell>
      <Table.Cell>
        <ToneBadge tone={product.complete ? "green" : "orange"}>{t(product.complete ? "products.complete" : "products.incomplete")}</ToneBadge>
      </Table.Cell>
      <Table.Cell className="text-right">
        <RowActions
          actions={[
            { key: "edit", label: t("products.edit"), icon: <PencilSquare />, onClick: onEdit },
            { key: "open", label: t("products.open"), icon: <ArrowUpRightOnBox />, href: `/app/products/${product.product_id}` },
          ]}
        />
      </Table.Cell>
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
          warnings: warnings
            .split(/\r?\n/)
            .map((w) => w.trim())
            .filter(Boolean),
          safety_info: safety || null,
        },
      },
      {
        onSuccess: () => {
          toast.success(t("toast.saved"))
          onDone()
        },
        onError: (e) => toast.error(t("toast.error", { error: e.message })),
      },
    )
  }

  const operatorSelect = (value: string, onChange: (v: string) => void) => (
    <Select size="small" value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
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
  )

  return (
    <div className="grid grid-cols-1 gap-3 bg-ui-bg-subtle px-6 py-4 md:grid-cols-2">
      <div className="flex items-center justify-between gap-x-2 md:col-span-2">
        <div className="flex min-w-0 items-center gap-x-2">
          <PencilSquare className="shrink-0 text-ui-fg-subtle" />
          <Heading level="h3" className="truncate text-ui-fg-base">
            {t("products.editor")}: {product.sku ?? product.product_id} / {product.title}
          </Heading>
        </div>
        <IconButton size="small" variant="transparent" title={t("products.cancel")} aria-label={t("products.cancel")} onClick={onDone}>
          <XMark />
        </IconButton>
      </div>
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("products.manufacturer")}</Label>
        {operatorSelect(manufacturer, setManufacturer)}
      </div>
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("products.responsible")}</Label>
        {operatorSelect(responsible, setResponsible)}
      </div>
      <div className="flex flex-col gap-y-1 md:col-span-2">
        <Label size="xsmall">{t("products.warnings")}</Label>
        <Textarea value={warnings} onChange={(e) => setWarnings(e.target.value)} placeholder={t("products.warningsPlaceholder")} />
      </div>
      <div className="flex flex-col gap-y-1 md:col-span-2">
        <Label size="xsmall">{t("products.safety")}</Label>
        <Textarea value={safety} onChange={(e) => setSafety(e.target.value)} placeholder={t("products.safetyPlaceholder")} />
      </div>
      <div className="flex items-center gap-x-2 md:col-span-2">
        <Button size="small" variant="primary" isLoading={save.isPending} onClick={submit}>
          {t("products.save")}
        </Button>
        <Button size="small" variant="secondary" onClick={onDone}>
          {t("products.cancel")}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* RODO                                                                */
/* ------------------------------------------------------------------ */

type DsrFilter = "all" | "open" | "closed"
const isOpen = (d: DsrDto) => d.status === "pending" || d.status === "in_progress"

function RodoPart({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("compliance")
  const [filter, setFilter] = useState<DsrFilter>("all")
  const toggle = (f: DsrFilter) => setFilter((cur) => (cur === f ? "all" : f))
  const open = status.dsr.filter(isOpen).length
  const rows = status.dsr.filter((d) => (filter === "open" ? isOpen(d) : filter === "closed" ? !isOpen(d) : true))
  return (
    <>
      <Section
        icon={<Users />}
        title={t("dsr.title")}
        points={[
          { icon: <User />, text: t("dsr.points.account") },
          { icon: <CheckCircle />, text: t("dsr.points.queue") },
        ]}
      >
        <FilterBar>
          <FilterButton icon={<ListBullet />} label={t("dsr.filter.all")} count={status.dsr.length} active={filter === "all"} onClick={() => setFilter("all")} />
          <FilterDivider />
          <FilterButton icon={<ExclamationCircle />} label={t("dsr.filter.open")} count={open} attention active={filter === "open"} onClick={() => toggle("open")} />
          <FilterButton icon={<CheckCircle />} label={t("dsr.filter.closed")} count={status.dsr.length - open} active={filter === "closed"} onClick={() => toggle("closed")} />
        </FilterBar>
        <div className="overflow-x-auto">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("dsr.when")}</Table.HeaderCell>
                <Table.HeaderCell>{t("dsr.customer")}</Table.HeaderCell>
                <Table.HeaderCell>{t("dsr.type")}</Table.HeaderCell>
                <Table.HeaderCell>{t("dsr.status")}</Table.HeaderCell>
                <Table.HeaderCell className="w-px" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.length === 0 ? <EmptyTableRow cols={5} icon={<Users />} title={t("dsr.empty")} points={status.dsr.length === 0 ? [{ icon: <User />, text: t("dsr.emptyHint") }] : undefined} /> : null}
              {rows.map((d) => (
                <DsrRow key={d.id} dsr={d} />
              ))}
            </Table.Body>
          </Table>
        </div>
      </Section>

      <Section
        icon={<CheckCircle />}
        title={t("consent.title")}
        points={[
          { icon: <BuildingStorefront />, text: t("consent.points.sources") },
          { icon: <ListBullet />, text: t("consent.points.purpose") },
        ]}
      >
        <div className="overflow-x-auto">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("consent.purpose")}</Table.HeaderCell>
                <Table.HeaderCell className="text-right">{t("consent.granted")}</Table.HeaderCell>
                <Table.HeaderCell className="text-right">{t("consent.declined")}</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {status.consent.length === 0 ? <EmptyTableRow cols={3} icon={<CheckCircle />} title={t("consent.empty")} points={[{ icon: <BuildingStorefront />, text: t("consent.emptyHint") }]} /> : null}
              {status.consent.map((c) => (
                <Table.Row key={c.purpose}>
                  <Table.Cell className="txt-compact-small-plus text-ui-fg-base">{t(`purpose.${c.purpose}`)}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{c.granted}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{c.declined}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      </Section>
    </>
  )
}

function DsrRow({ dsr }: { dsr: DsrDto }) {
  const { t, i18n } = useTranslation("compliance")
  const update = useUpdateDsr()
  const done = (status: "completed" | "rejected") => update.mutate({ id: dsr.id, body: { status } }, { onSuccess: () => toast.success(t("toast.saved")), onError: (e) => toast.error(t("toast.error", { error: e.message })) })
  const open = isOpen(dsr)
  return (
    <Table.Row>
      <Table.Cell className="tabular-nums text-ui-fg-subtle">
        <span className="inline-flex items-center gap-x-1.5">
          <Calendar className="text-ui-fg-muted" />
          {new Date(dsr.created_at).toLocaleDateString(i18n.language || "en")}
        </span>
      </Table.Cell>
      <Table.Cell>
        <span className="flex items-center gap-x-2">
          <Link to={`/customers/${dsr.customer_id}`} className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {dsr.customer_email ?? dsr.customer_id}
          </Link>
          {dsr.demo ? <ToneBadge tone="blue">{t("mode.demo")}</ToneBadge> : null}
        </span>
      </Table.Cell>
      <Table.Cell>
        <ToneBadge>{t(`type.${dsr.type}`)}</ToneBadge>
      </Table.Cell>
      <Table.Cell>
        <DsrStatusBadge status={dsr.status} />
      </Table.Cell>
      <Table.Cell className="text-right">
        <RowActions
          actions={[
            { key: "done", label: t("dsr.complete"), icon: <CheckCircle />, hidden: !open, disabled: update.isPending, loading: update.isPending && update.variables?.body.status === "completed", onClick: () => done("completed") },
            { key: "reject", label: t("dsr.reject"), icon: <XCircle />, danger: true, hidden: !open, disabled: update.isPending, loading: update.isPending && update.variables?.body.status === "rejected", onClick: () => done("rejected") },
            { key: "customer", label: t("dsr.open"), icon: <ArrowUpRightOnBox />, href: `/app/customers/${dsr.customer_id}` },
          ]}
        />
      </Table.Cell>
    </Table.Row>
  )
}

/* ------------------------------------------------------------------ */
/* Omnibus                                                             */
/* ------------------------------------------------------------------ */

function OmnibusPart({ status, q, onQ }: { status: StatusResponse; q: string; onQ: (v: string) => void }) {
  const { t, i18n } = useTranslation("compliance")
  const lang = i18n.language || "en"
  const capture = useCapturePrices()
  const needle = q.trim().toLowerCase()
  const rows = status.prices.filter((p) => !needle || [p.sku, p.title, p.product_id].some((x) => (x ?? "").toLowerCase().includes(needle)))
  return (
    <Section
      icon={<ReceiptPercent />}
      title={t("prices.title")}
      points={[
        { icon: <Calendar />, text: t("prices.points.daily") },
        { icon: <BarsArrowDown />, text: t("prices.points.lowest") },
        { icon: <ReceiptPercent />, text: t("prices.points.discount") },
      ]}
      actions={
        <>
          <SearchInput value={q} onChange={onQ} placeholder={t("prices.search")} />
          <Button
            size="small"
            variant="secondary"
            isLoading={capture.isPending}
            onClick={() => capture.mutate(undefined, { onSuccess: (d) => toast.success(t("prices.captured", { n: d.captured })), onError: (e) => toast.error(t("toast.error", { error: e.message })) })}
          >
            <CircleStack />
            {t("prices.capture")}
          </Button>
        </>
      }
    >
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("prices.sku")}</Table.HeaderCell>
              <Table.HeaderCell>{t("prices.product")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("prices.current")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("prices.lowest")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("prices.snapshots")}</Table.HeaderCell>
              <Table.HeaderCell className="w-px" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyTableRow
                cols={6}
                icon={<ReceiptPercent />}
                title={status.prices.length === 0 ? t("prices.empty") : t("prices.emptySearch")}
                points={status.prices.length === 0 ? [{ icon: <CircleStack />, text: t("prices.emptyHint") }] : undefined}
              />
            ) : null}
            {rows.map((p) => (
              <Table.Row key={`${p.sku}-${p.currency_code}`}>
                <Table.Cell className="font-mono txt-compact-xsmall">{p.sku}</Table.Cell>
                <Table.Cell>
                  <Link to={`/products/${p.product_id}`} className="txt-compact-small-plus text-ui-fg-base hover:text-ui-fg-interactive">
                    {p.title ?? p.product_id}
                  </Link>
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums">{fmtAmount(p.amount, p.currency_code, lang)}</Table.Cell>
                <Table.Cell className="text-right tabular-nums text-ui-fg-subtle">{fmtAmount(p.lowest_30d, p.currency_code, lang)}</Table.Cell>
                <Table.Cell className="text-right tabular-nums text-ui-fg-subtle">{p.snapshots}</Table.Cell>
                <Table.Cell className="text-right">
                  <RowActions actions={[{ key: "open", label: t("prices.open"), icon: <ArrowUpRightOnBox />, href: `/app/products/${p.product_id}` }]} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  rank: 5,
  translationNs: "compliance",
  icon: ComplianceIcon,
})

export default CompliancePage
