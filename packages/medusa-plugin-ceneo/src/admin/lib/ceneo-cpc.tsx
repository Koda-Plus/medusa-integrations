import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowPath, ChartBar, CurrencyDollar, PencilSquare, Tag, Trophy } from "@medusajs/icons"
import { Button, Drawer, Input, InlineTip, Label, Table, Text, toast } from "@medusajs/ui"
import type { BidDto, StatusResponse } from "../../modules/ceneo/lib/contract"
import { CPC_PAGE, errorMessage, useCeneoCpc, useRunCpc, useSetTargets } from "./ceneo-api"
import { EmptyTableRow, FilterBar, SearchInput, Section, ToneBadge, useDebouncedValue } from "./ceneo-blocks"
import { KitSkeletonRows } from "./ceneo-kit"

const PROMO_MAX = 30

function pln(gr: number | null, lang: string): string {
  return gr === null ? "-" : new Intl.NumberFormat(lang, { style: "currency", currency: "PLN" }).format(gr / 100)
}

/** "0,25" or "0.25" PLN to grosze; "" clears; null when unreadable. */
function parseBid(v: string): number | null | "clear" {
  const s = v.trim().replace(",", ".")
  if (!s) return "clear"
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) : null
}

function Plan({ b, lang }: { b: BidDto; lang: string }) {
  const { t } = useTranslation("ceneo")
  if (b.targetBid === null) return <Text size="xsmall" className="text-ui-fg-muted">{t("cpc.noTarget")}</Text>
  return (
    <div className="flex flex-col gap-y-0.5">
      <Text size="xsmall" className="tabular-nums">
        {t("cpc.target", { bid: pln(b.targetBid, lang) })}
      </Text>
      {b.plannedBid !== null ? (
        <Text size="xsmall" className="tabular-nums text-ui-fg-subtle">
          {t("cpc.next", { bid: pln(b.plannedBid, lang) })}
        </Text>
      ) : (
        <Text size="xsmall" className="text-ui-fg-muted">{t("cpc.reached")}</Text>
      )}
      {b.planReasons.map((r) => (
        <Text key={r} size="xsmall" className="text-ui-fg-muted">
          {t(`cpc.reasons.${r}`)}
        </Text>
      ))}
    </div>
  )
}

function EditDrawer({ b, lang, onClose }: { b: BidDto; lang: string; onClose: () => void }) {
  const { t } = useTranslation("ceneo")
  const [bid, setBid] = useState(b.targetBid === null ? "" : (b.targetBid / 100).toFixed(2))
  const [promo, setPromo] = useState(b.promoText ?? "")
  const save = useSetTargets()
  const parsed = parseBid(bid)
  const promoTooLong = [...promo.trim()].length > PROMO_MAX
  const onSave = () => {
    if (parsed === null || promoTooLong) return
    save.mutate(
      { items: [{ kind: b.kind, key: b.key, targetBid: parsed === "clear" ? null : parsed, promoText: promo.trim() ? promo.trim() : null }] },
      {
        onSuccess: () => {
          toast.success(t("cpc.saved"))
          onClose()
        },
        onError: (e) => toast.error(t("toast.error", { error: errorMessage(e) })),
      },
    )
  }
  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content className="max-w-xl">
        <Drawer.Header>
          <Drawer.Title>{b.name ?? b.key}</Drawer.Title>
          <Drawer.Description>{t("cpc.editSubtitle")}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-y-0.5">
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">{t("cpc.col.current")}</Text>
              <Text size="small" className="tabular-nums">{pln(b.currentBid, lang)}</Text>
            </div>
            <div className="flex flex-col gap-y-0.5">
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">{t("cpc.minSuggested")}</Text>
              <Text size="small" className="tabular-nums">{pln(b.minSuggestedBid, lang)}</Text>
            </div>
          </div>
          <div className="flex flex-col gap-y-1.5">
            <Label size="small" htmlFor="ceneo-bid">{t("cpc.targetLabel")}</Label>
            <Input id="ceneo-bid" size="small" inputMode="decimal" value={bid} onChange={(e) => setBid(e.target.value)} placeholder="0.25" aria-invalid={parsed === null} />
            <Text size="xsmall" className="text-ui-fg-muted">{t("cpc.targetHint")}</Text>
          </div>
          <div className="flex flex-col gap-y-1.5">
            <Label size="small" htmlFor="ceneo-promo">{t("cpc.promoLabel")}</Label>
            <Input id="ceneo-promo" size="small" value={promo} onChange={(e) => setPromo(e.target.value)} aria-invalid={promoTooLong} />
            <Text size="xsmall" className={promoTooLong ? "text-ui-fg-error" : "text-ui-fg-muted"}>
              {t("cpc.promoHint", { count: [...promo.trim()].length, max: PROMO_MAX })}
            </Text>
          </div>
          {b.kind === "product" ? (
            <div className="flex flex-col gap-y-1.5">
              <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
                {t("cpc.top10", { count: b.offersNumber ?? b.top10.length })}
              </Text>
              {b.top10.length === 0 ? (
                <Text size="xsmall" className="text-ui-fg-muted">{t("cpc.noTop")}</Text>
              ) : (
                <ul className="flex flex-col divide-y rounded-md border">
                  {b.top10.map((o) => (
                    <li key={`${o.position}-${o.shop}`} className="flex items-center justify-between gap-x-3 px-3 py-1.5">
                      <Text size="xsmall" className="truncate">
                        {o.position ?? "-"}. {o.shop}
                      </Text>
                      <Text size="xsmall" className="shrink-0 tabular-nums">
                        {o.price === null ? "-" : new Intl.NumberFormat(lang, { style: "currency", currency: "PLN" }).format(o.price)}
                      </Text>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
          {b.error ? (
            <InlineTip variant="warning" label={t("cpc.errorLabel")}>
              {b.error}
            </InlineTip>
          ) : null}
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">{t("orders.close")}</Button>
          </Drawer.Close>
          <Button size="small" onClick={onSave} isLoading={save.isPending} disabled={parsed === null || promoTooLong}>
            {t("cpc.save")}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

function CategoryForm() {
  const { t } = useTranslation("ceneo")
  const [id, setId] = useState("")
  const [bid, setBid] = useState("")
  const save = useSetTargets()
  const parsed = parseBid(bid)
  const ok = /^\d{1,9}$/.test(id.trim()) && typeof parsed === "number"
  const onAdd = () => {
    if (!ok || typeof parsed !== "number") return
    save.mutate(
      { items: [{ kind: "category", key: id.trim(), targetBid: parsed }] },
      {
        onSuccess: () => {
          toast.success(t("cpc.saved"))
          setId("")
          setBid("")
        },
        onError: (e) => toast.error(t("toast.error", { error: errorMessage(e) })),
      },
    )
  }
  return (
    <div className="flex flex-wrap items-end gap-2 px-6 py-3">
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall" htmlFor="ceneo-cat-id">{t("cpc.categoryId")}</Label>
        <Input id="ceneo-cat-id" size="small" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value)} className="w-32" />
      </div>
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall" htmlFor="ceneo-cat-bid">{t("cpc.targetLabel")}</Label>
        <Input id="ceneo-cat-bid" size="small" inputMode="decimal" value={bid} onChange={(e) => setBid(e.target.value)} placeholder="1.00" className="w-28" />
      </div>
      <Button size="small" variant="secondary" onClick={onAdd} disabled={!ok} isLoading={save.isPending}>
        {t("cpc.addCategory")}
      </Button>
    </div>
  )
}

/** Bids, promotion texts and the top 10 per product, plus category bids. */
export function CpcSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("ceneo")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<BidDto | null>(null)
  const q = useDebouncedValue(search.trim(), 300)
  const cpc = useCeneoCpc(q, offset)
  const run = useRunCpc()
  const rows = cpc.data?.rows ?? []
  const count = cpc.data?.count ?? 0
  const categories = cpc.data?.categories ?? []
  const mode = status.api.mode
  const onRun = () =>
    run.mutate(undefined, {
      onSuccess: (r) => {
        if (r.status === "ran") toast.success(t("cpc.ran", { read: r.read, bids: r.bidsSent, promos: r.promosSent, failed: r.failed }))
        else if (r.status === "failed") toast.error(t("cpc.failed", { error: r.error ?? "" }))
        else if (r.status === "off") toast.info(t("orders.off"))
        else toast.info(t("orders.syncRunning"))
      },
      onError: (e) => toast.error(t("toast.error", { error: errorMessage(e) })),
    })
  return (
    <Section
      id="ceneo-cpc"
      icon={<CurrencyDollar />}
      title={t("cpc.title")}
      badges={mode === "demo" ? <ToneBadge tone="purple">{t("orders.demo")}</ToneBadge> : null}
      points={[
        { icon: <ChartBar />, text: t("cpc.points.plan", { max: status.cpc.maxBid === null ? "-" : pln(status.cpc.maxBid, lang), pct: status.cpc.maxBidChangePercent }) },
        { icon: <Trophy />, text: t("cpc.points.top") },
        { icon: <Tag />, text: t("cpc.points.promo") },
      ]}
      actions={
        <Button size="small" variant="secondary" onClick={onRun} isLoading={run.isPending} disabled={mode === "missing_key"}>
          <ArrowPath />
          {t("cpc.run")}
        </Button>
      }
    >
      <FilterBar>
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v)
            setOffset(0)
          }}
          placeholder={t("cpc.search")}
        />
      </FilterBar>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{t("cpc.col.product")}</Table.HeaderCell>
            <Table.HeaderCell className="text-right">{t("cpc.col.current")}</Table.HeaderCell>
            <Table.HeaderCell>{t("cpc.col.plan")}</Table.HeaderCell>
            <Table.HeaderCell>{t("cpc.col.position")}</Table.HeaderCell>
            <Table.HeaderCell>{t("cpc.col.promo")}</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {cpc.isLoading ? (
            <KitSkeletonRows cols={5} rows={4} />
          ) : rows.length === 0 ? (
            <EmptyTableRow cols={5} compact icon={<CurrencyDollar />} title={t("cpc.empty")} />
          ) : (
            rows.map((b) => (
              <Table.Row key={b.id} className="cursor-pointer [&_td]:py-2.5 [&_td]:align-top" onClick={() => setOpen(b)}>
                <Table.Cell className="max-w-[280px]">
                  <div className="flex flex-col gap-y-0.5">
                    <span className="txt-compact-small-plus truncate text-ui-fg-base">{b.name ?? b.key}</span>
                    <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{b.key}</span>
                    {b.error ? <ToneBadge tone="orange">{t("cpc.hasError")}</ToneBadge> : null}
                  </div>
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums">{pln(b.currentBid, lang)}</Table.Cell>
                <Table.Cell>
                  <Plan b={b} lang={lang} />
                </Table.Cell>
                <Table.Cell>
                  <Text size="xsmall" className="tabular-nums">
                    {b.position !== null ? t("cpc.position", { position: b.position, count: b.offersNumber ?? b.top10.length }) : "-"}
                  </Text>
                  {b.lowestPrice !== null ? (
                    <Text size="xsmall" className="tabular-nums text-ui-fg-muted">
                      {t("cpc.lowest", { price: new Intl.NumberFormat(lang, { style: "currency", currency: "PLN" }).format(b.lowestPrice) })}
                    </Text>
                  ) : null}
                </Table.Cell>
                <Table.Cell>
                  <div className="flex items-center gap-x-1.5">
                    <Text size="xsmall" className="truncate">{b.promoText ?? "-"}</Text>
                    {b.promoPending ? <ToneBadge tone="blue">{t("cpc.pending")}</ToneBadge> : null}
                    <PencilSquare className="shrink-0 text-ui-fg-muted" />
                  </div>
                </Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table>
      {count > CPC_PAGE ? (
        <div className="flex items-center justify-between gap-x-3 px-6 py-3">
          <Text size="xsmall" className="tabular-nums text-ui-fg-subtle">
            {t("offers.page", { from: offset + 1, to: Math.min(offset + CPC_PAGE, count), count })}
          </Text>
          <div className="flex gap-x-2">
            <Button size="small" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - CPC_PAGE))}>
              {t("offers.prev")}
            </Button>
            <Button size="small" variant="secondary" disabled={offset + CPC_PAGE >= count} onClick={() => setOffset(offset + CPC_PAGE)}>
              {t("offers.next")}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-y-1 px-6 pt-4">
        <Text size="small" weight="plus">{t("cpc.categoriesTitle")}</Text>
        <Text size="xsmall" className="text-ui-fg-subtle">{t("cpc.categoriesHint")}</Text>
      </div>
      {categories.map((c) => (
        <button key={c.id} type="button" className="flex w-full items-center justify-between gap-x-3 px-6 py-2 text-left hover:bg-ui-bg-base-hover" onClick={() => setOpen(c)}>
          <span className="txt-compact-small truncate">{c.name ?? t("cpc.categoryName", { id: c.key })}</span>
          <span className="flex items-center gap-x-3">
            <Text size="xsmall" className="tabular-nums">{pln(c.currentBid, lang)}</Text>
            <Plan b={c} lang={lang} />
          </span>
        </button>
      ))}
      <CategoryForm />
      {open ? <EditDrawer b={open} lang={lang} onClose={() => setOpen(null)} /> : null}
    </Section>
  )
}
