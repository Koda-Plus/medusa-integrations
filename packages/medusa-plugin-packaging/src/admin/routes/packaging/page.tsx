import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArchiveBox, ArrowPath, ArrowUpRightOnBox, CheckCircle, CubeSolid, DocumentText, ExclamationCircle, Hashtag, ListBullet, PencilSquare, ShoppingCart, SquareTwoStack, Tag, XMark } from "@medusajs/icons"
import { Button, Container, Heading, IconButton, InlineTip, Input, Label, Table, Text, toast } from "@medusajs/ui"
import { KitFetchingBar, KitLoading, KitSkeletonRows, announce } from "../../lib/packaging-kit"
import { HelpButtons, IntegrationHeader, ModeBadge, SettingsView, communityLabels, usePageNav } from "../../lib/packaging-guide"
import { EmptyState, EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, StatTile, StatTiles, ToneBadge } from "../../lib/packaging-blocks"
import { GuideView, usePromptSpec } from "../../lib/packaging-guide-view"
import { errorMessage, usePackagingStatus, useSavePackaging, useSscc } from "../../lib/packaging-api"
import { PackagingIcon } from "../../lib/packaging-icon"
import { OptionsTab, SETTINGS_TABS, type SettingsTabId } from "../../lib/packaging-ui"
import type { ProductDto, StatusResponse } from "../../../modules/packaging/lib/contract"

/* The host of the koda.integration/1 cards learns about this plugin. */
announce({ ns: "packaging", name: "Packaging", adminPath: "/packaging", Icon: PackagingIcon })

/**
 * Packaging by Koda Plus. Panel: the counters, the SSCC label tool and the
 * catalog products with their ladders (piece, box, pallet), the minimum and
 * the step, an editor per product. Setup guide and the options in use
 * behind the tabs.
 *
 * Deep links: `?filter=` (moq, sscc, unset) and `?q=` (SKU or name).
 */

type Filter = "all" | "moq" | "sscc" | "unset"
const FILTERS: Filter[] = ["all", "moq", "sscc", "unset"]

const hasLadder = (p: ProductDto) => p.units.some((u) => u.name !== "szt.")
const hasSscc = (p: ProductDto) => p.units.some((u) => Boolean(u.sscc_prefix))

function matches(p: ProductDto, f: Filter): boolean {
  if (f === "moq") return p.moq > 0
  if (f === "sscc") return hasSscc(p)
  if (f === "unset") return !hasLadder(p)
  return true
}

const scrollTo = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }))

const PackagingPage = () => {
  const { t, i18n } = useTranslation("packaging")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const status = usePackagingStatus()
  const s = status.data
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)

  const [params, setParams] = useSearchParams()
  const filter = (FILTERS as string[]).includes(params.get("filter") ?? "") ? (params.get("filter") as Filter) : "all"
  const [q, setQ] = useState(params.get("q") ?? "")
  useEffect(() => {
    const p = new URLSearchParams(params)
    if (q) p.set("q", q)
    else p.delete("q")
    if (p.toString() !== params.toString()) setParams(p, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])
  const setFilter = (f: Filter) => {
    const p = new URLSearchParams(params)
    if (f === "all" || f === filter) p.delete("filter")
    else p.set("filter", f)
    setParams(p, { replace: true })
    scrollTo("packaging-products")
  }

  const onRefresh = async () => {
    const r = await status.refetch()
    if (r.isError) toast.error(t("toast.error", { error: errorMessage(r.error) }))
    else toast.success(t("toast.refreshed"))
  }
  const refresh = { key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, loading: status.isFetching, onClick: () => void onRefresh() }
  const unset = (s?.products ?? []).filter((p) => !hasLadder(p)).length

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <IntegrationHeader
          icon={<PackagingIcon width={28} height={28} />}
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
            { icon: <CubeSolid />, text: t("points.ladder") },
            { icon: <ShoppingCart />, text: t("points.moq") },
            { icon: <Tag />, text: t("points.ean") },
            { icon: <DocumentText />, text: t("points.sscc") },
          ]}
          help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
          view={nav.view}
          onView={(v) => nav.go(v)}
          labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("view.settings"), more: t("actions.more") }}
          primary={nav.view === "panel" && s ? { key: "sscc", label: t("actions.sscc"), icon: <DocumentText />, onClick: () => scrollTo("packaging-sscc") } : null}
          actions={
            nav.view === "panel"
              ? [refresh, { key: "products", label: t("actions.products"), icon: <ArrowUpRightOnBox />, onClick: () => window.location.assign("/app/products") }]
              : nav.view === "settings"
                ? [refresh]
                : []
          }
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
        {nav.view === "panel" && s ? (
          <StatTiles columns={4}>
            <StatTile label={t("stats.products")} value={s.counts.products} hint={t("stats.productsHint")} icon={<ArchiveBox />} active={filter === "all" && !q} onClick={() => setFilter("all")} />
            <StatTile label={t("stats.moq")} value={s.counts.with_moq} hint={t("stats.moqHint")} icon={<ShoppingCart />} tone="blue" active={filter === "moq"} onClick={() => setFilter("moq")} />
            <StatTile label={t("stats.sscc")} value={s.counts.with_sscc} hint={t("stats.ssccHint")} icon={<DocumentText />} tone="green" active={filter === "sscc"} onClick={() => setFilter("sscc")} />
            <StatTile label={t("stats.unset")} value={unset} hint={t("stats.unsetHint")} icon={<ExclamationCircle />} tone={unset > 0 ? "orange" : "grey"} active={filter === "unset"} onClick={() => setFilter("unset")} />
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

      {nav.view === "panel" && s ? (
        <>
          <SsccCard status={s} />
          <ProductsCard status={s} filter={filter} onFilter={setFilter} q={q} onQ={setQ} loading={status.isLoading} />
        </>
      ) : null}
    </div>
  )
}

function ProductsCard({ status, filter, onFilter, q, onQ, loading }: { status: StatusResponse; filter: Filter; onFilter: (f: Filter) => void; q: string; onQ: (v: string) => void; loading: boolean }) {
  const { t } = useTranslation("packaging")
  const [editing, setEditing] = useState<string | null>(null)
  const needle = q.trim().toLowerCase()
  const rows = useMemo(
    () => status.products.filter((p) => matches(p, filter) && (!needle || [p.sku, p.title, p.product_id].some((x) => (x ?? "").toLowerCase().includes(needle)))),
    [status.products, filter, needle],
  )
  const count = (f: Filter) => status.products.filter((p) => matches(p, f)).length
  const editingProduct = status.products.find((p) => p.product_id === editing) ?? null

  return (
    <Section
      id="packaging-products"
      icon={<CubeSolid />}
      title={t("products.title")}
      points={[
        { icon: <CubeSolid />, text: t("products.points.ladder") },
        { icon: <ShoppingCart />, text: t("products.points.moq") },
        { icon: <PencilSquare />, text: t("products.points.edit") },
      ]}
      actions={<SearchInput value={q} onChange={onQ} placeholder={t("products.search")} />}
    >
      <FilterBar>
        <FilterButton icon={<ListBullet />} label={t("products.filter.all")} count={status.products.length} active={filter === "all"} onClick={() => onFilter("all")} />
        <FilterDivider />
        <FilterButton icon={<ShoppingCart />} label={t("products.filter.moq")} count={count("moq")} active={filter === "moq"} onClick={() => onFilter("moq")} />
        <FilterButton icon={<DocumentText />} label={t("products.filter.sscc")} count={count("sscc")} active={filter === "sscc"} onClick={() => onFilter("sscc")} />
        <FilterDivider />
        <FilterButton icon={<ExclamationCircle />} label={t("products.filter.unset")} count={count("unset")} attention active={filter === "unset"} onClick={() => onFilter("unset")} />
      </FilterBar>
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("products.sku")}</Table.HeaderCell>
              <Table.HeaderCell>{t("products.product")}</Table.HeaderCell>
              <Table.HeaderCell>{t("products.ladder")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("products.moq")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("products.step")}</Table.HeaderCell>
              <Table.HeaderCell className="w-px" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loading && rows.length === 0 ? <KitSkeletonRows cols={6} /> : null}
            {!loading && rows.length === 0 ? <EmptyTableRow cols={6} icon={<CubeSolid />} title={status.products.length === 0 ? t("products.empty") : t("products.emptySearch")} /> : null}
            {rows.map((p) => (
              <Table.Row key={p.product_id} className="cursor-pointer" onClick={() => setEditing(editing === p.product_id ? null : p.product_id)}>
                <Table.Cell className="font-mono txt-compact-xsmall">{p.sku ?? "-"}</Table.Cell>
                <Table.Cell>
                  <span className="flex items-center gap-x-2">
                    <Link to={`/products/${p.product_id}`} onClick={(e) => e.stopPropagation()} className="txt-compact-small-plus text-ui-fg-base hover:text-ui-fg-interactive">
                      {p.title ?? p.product_id}
                    </Link>
                    {p.demo ? <ToneBadge tone="blue">{t("mode.demo")}</ToneBadge> : null}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  {hasLadder(p) ? (
                    <span className="flex flex-wrap items-center gap-1">
                      {[...p.units]
                        .sort((a, b) => a.pieces - b.pieces)
                        .map((u) => (
                          <ToneBadge key={u.id} tone={u.sscc_prefix ? "green" : "grey"} title={u.ean ?? undefined}>
                            {u.name} {u.pieces}
                          </ToneBadge>
                        ))}
                    </span>
                  ) : (
                    <ToneBadge tone="orange" dot>
                      {t("products.unset")}
                    </ToneBadge>
                  )}
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums">{p.moq > 0 ? p.moq : "-"}</Table.Cell>
                <Table.Cell className="text-right tabular-nums">{p.step > 0 ? p.step : "-"}</Table.Cell>
                <Table.Cell className="text-right">
                  <RowActions
                    actions={[
                      { key: "edit", label: t("products.edit"), icon: <PencilSquare />, onClick: () => setEditing(editing === p.product_id ? null : p.product_id) },
                      { key: "open", label: t("products.open"), icon: <ArrowUpRightOnBox />, href: `/app/products/${p.product_id}` },
                    ]}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
      {editingProduct ? <ProductEditor key={editingProduct.product_id} product={editingProduct} onDone={() => setEditing(null)} /> : null}
    </Section>
  )
}

function SsccCard({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("packaging")
  const [serial, setSerial] = useState("")
  const ready = serial.replace(/\D/g, "").length >= 3
  const sscc = useSscc(serial, ready)
  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => toast.success(t("sscc.copied")))
  return (
    <Section
      id="packaging-sscc"
      icon={<DocumentText />}
      title={t("sscc.title")}
      points={[
        { icon: <Hashtag />, text: t("sscc.points.prefix", { prefix: status.gs1Prefix || "-" }) },
        { icon: <DocumentText />, text: t("sscc.points.digits") },
        { icon: <CheckCircle />, text: t("sscc.points.check") },
        { icon: <ArchiveBox />, text: t("sscc.points.nothing") },
      ]}
    >
      <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-[minmax(14rem,20rem)_1fr]">
        <div className="flex flex-col gap-y-1">
          <Label size="xsmall">{t("sscc.serial")}</Label>
          <Input size="small" inputMode="numeric" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder={t("sscc.placeholder")} />
        </div>
        {sscc.data ? (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
            <div className="flex min-w-0 flex-col gap-y-1">
              <Text size="large" weight="plus" className="font-mono tabular-nums text-ui-fg-base">
                {sscc.data.formatted}
              </Text>
              <Text size="xsmall" className="text-ui-fg-muted">
                {t("sscc.payload")}: <span className="font-mono">{sscc.data.payload}</span>
              </Text>
            </div>
            <IconButton size="small" variant="transparent" title={t("sscc.copy")} aria-label={t("sscc.copy")} onClick={() => copy(sscc.data!.sscc)}>
              <SquareTwoStack />
            </IconButton>
          </div>
        ) : (
          <EmptyState compact icon={<DocumentText />} title={t("sscc.empty")} className="items-start px-0 text-left" />
        )}
      </div>
    </Section>
  )
}

function ProductEditor({ product, onDone }: { product: ProductDto; onDone: () => void }) {
  const { t } = useTranslation("packaging")
  const save = useSavePackaging()
  const [moq, setMoq] = useState(String(product.moq || ""))
  const [step, setStep] = useState(String(product.step || ""))
  const [boxPieces, setBoxPieces] = useState(String(product.units.find((u) => u.name === "karton")?.pieces ?? ""))
  const [boxEan, setBoxEan] = useState(product.units.find((u) => u.name === "karton")?.ean ?? "")
  const [palletPieces, setPalletPieces] = useState(String(product.units.find((u) => u.name === "paleta")?.pieces ?? ""))
  const [ssccPrefix, setSsccPrefix] = useState(product.units.find((u) => u.name === "paleta")?.sscc_prefix ?? "")

  const n = (v: string) => {
    const x = Number(v.replace(",", "."))
    return Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0
  }

  const submit = () => {
    const units: Array<{ name: string; pieces: number; ean: string | null; sscc_prefix: string | null }> = [{ name: "szt.", pieces: 1, ean: null, sscc_prefix: null }]
    const box = n(boxPieces)
    if (box > 0) units.push({ name: "karton", pieces: box, ean: boxEan || null, sscc_prefix: null })
    const pallet = n(palletPieces)
    if (pallet > 0) units.push({ name: "paleta", pieces: pallet, ean: null, sscc_prefix: ssccPrefix || null })
    save.mutate(
      { id: product.product_id, body: { moq: n(moq), step: n(step), units } },
      {
        onSuccess: () => {
          toast.success(t("toast.saved"))
          onDone()
        },
        onError: (e) => toast.error(t("toast.error", { error: e.message })),
      },
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 bg-ui-bg-subtle px-6 py-4 md:grid-cols-3">
      <div className="flex items-center justify-between gap-x-2 md:col-span-3">
        <div className="flex min-w-0 items-center gap-x-2">
          <PencilSquare className="shrink-0 text-ui-fg-subtle" />
          <Heading level="h3" className="truncate text-ui-fg-base">
            {t("editor.title")}: {product.sku ?? product.product_id} / {product.title}
          </Heading>
        </div>
        <IconButton size="small" variant="transparent" title={t("editor.cancel")} aria-label={t("editor.cancel")} onClick={onDone}>
          <XMark />
        </IconButton>
      </div>
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("editor.moq")}</Label>
        <Input size="small" inputMode="numeric" value={moq} onChange={(e) => setMoq(e.target.value)} placeholder="0" />
      </div>
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("editor.step")}</Label>
        <Input size="small" inputMode="numeric" value={step} onChange={(e) => setStep(e.target.value)} placeholder="0" />
      </div>
      <div className="hidden md:block" />
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("editor.box")}</Label>
        <Input size="small" inputMode="numeric" value={boxPieces} onChange={(e) => setBoxPieces(e.target.value)} placeholder="12" />
      </div>
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("editor.boxEan")}</Label>
        <Input size="small" value={boxEan} onChange={(e) => setBoxEan(e.target.value)} placeholder="590..." maxLength={14} />
      </div>
      <div className="hidden md:block" />
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("editor.pallet")}</Label>
        <Input size="small" inputMode="numeric" value={palletPieces} onChange={(e) => setPalletPieces(e.target.value)} placeholder="120" />
      </div>
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("editor.ssccPrefix")}</Label>
        <Input size="small" value={ssccPrefix} onChange={(e) => setSsccPrefix(e.target.value)} placeholder="590123456789" maxLength={10} />
      </div>
      <div className="flex items-end gap-x-2">
        <Button size="small" variant="primary" isLoading={save.isPending} onClick={submit}>
          {t("editor.save")}
        </Button>
        <Button size="small" variant="secondary" onClick={onDone}>
          {t("editor.cancel")}
        </Button>
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "packaging",
  icon: PackagingIcon,
})

export default PackagingPage
