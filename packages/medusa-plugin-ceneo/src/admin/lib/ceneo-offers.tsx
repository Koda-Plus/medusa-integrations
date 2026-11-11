import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArrowRightOnRectangle, CheckCircle, ExclamationCircle, MinusCircle, SquaresPlus, Tag } from "@medusajs/icons"
import { Button, Table, Text, clx, toast, usePrompt } from "@medusajs/ui"
import { PROBLEMS, type OfferState } from "../../modules/ceneo/lib/constants"
import type { OfferDto, OfferProblemDto, StatusResponse } from "../../modules/ceneo/lib/contract"
import { OFFERS_PAGE, errorMessage, useCeneoOffers, useTakeOver } from "./ceneo-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, ToneBadge, useDebouncedValue, type Tone } from "./ceneo-blocks"
import { KitSkeletonRows } from "./ceneo-kit"

export const STATE_TONE: Record<OfferState, Tone> = { ok: "green", warning: "orange", error: "red", excluded: "grey" }

export function StateBadge({ state }: { state: OfferState }) {
  const { t } = useTranslation("ceneo")
  return (
    <ToneBadge tone={STATE_TONE[state]} dot>
      {t(`offers.state.${state}`)}
    </ToneBadge>
  )
}

/** The problems of an offer, worst first, each in one sentence. */
export function ProblemList({ problems }: { problems: OfferProblemDto[] }) {
  const { t } = useTranslation("ceneo")
  if (problems.length === 0) return null
  const rank = { error: 0, excluded: 1, warning: 2 } as const
  const sorted = [...problems].sort((a, b) => rank[PROBLEMS[a.code]] - rank[PROBLEMS[b.code]])
  return (
    <ul className="flex flex-col gap-y-0.5">
      {sorted.map((p, i) => {
        const sev = PROBLEMS[p.code]
        return (
          <li key={`${p.code}-${i}`} className="flex gap-x-1.5">
            <span className={clx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", sev === "error" ? "bg-ui-tag-red-icon" : sev === "warning" ? "bg-ui-tag-orange-icon" : "bg-ui-tag-neutral-icon")} />
            <Text size="xsmall" className="text-ui-fg-subtle">
              {t(`problems.${p.code}`, { detail: p.detail ?? "" })}
            </Text>
          </li>
        )
      })}
    </ul>
  )
}

export function fmtPln(price: OfferDto["price"], lang: string): string {
  if (!price) return "-"
  return new Intl.NumberFormat(lang, { style: "currency", currency: price.currency_code.toUpperCase() }).format(price.amount)
}

/** Takes a refused id over, after a confirmation that names the Ceneo rule. */
export function useTakeOverAction() {
  const { t } = useTranslation("ceneo")
  const prompt = usePrompt()
  const take = useTakeOver()
  return {
    pending: take.isPending,
    run: async (o: OfferDto) => {
      const id = o.problems.find((p) => p.code === "offer_id_taken")?.detail ?? ""
      const ok = await prompt({
        title: t("offers.takeOver.title"),
        description: t("offers.takeOver.description", { id }),
        confirmText: t("offers.takeOver.confirm"),
        cancelText: t("offers.takeOver.cancel"),
      })
      if (!ok) return
      try {
        await take.mutateAsync(o.id)
        toast.success(t("offers.takeOver.done", { id }))
      } catch (e) {
        toast.error(t("toast.error", { error: errorMessage(e) }))
      }
    },
  }
}

const FILTERS: Array<{ state: OfferState | null; icon: ReactNode }> = [
  { state: null, icon: <SquaresPlus /> },
  { state: "error", icon: <ExclamationCircle /> },
  { state: "warning", icon: <Tag /> },
  { state: "ok", icon: <CheckCircle /> },
  { state: "excluded", icon: <MinusCircle /> },
]

/** Every variant as Ceneo sees it after the last build, with the reasons it stays out. */
export function OffersSection({ status, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("ceneo")
  const [state, setState] = useState<OfferState | null>(status.counts.error > 0 ? "error" : null)
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const q = useDebouncedValue(search.trim(), 300)
  const offers = useCeneoOffers(state, q, offset)
  const takeOver = useTakeOverAction()
  const rows = offers.data?.offers ?? []
  const count = offers.data?.count ?? 0
  const counts = status.counts

  const pick = (s: OfferState | null) => {
    setState(s === state ? null : s)
    setOffset(0)
  }

  return (
    <Section
      id="ceneo-offers"
      icon={<SquaresPlus />}
      title={t("offers.title")}
      points={[
        { icon: <ExclamationCircle />, text: t("offers.points.errors") },
        { icon: <Tag />, text: t("offers.points.warnings") },
      ]}
    >
      <FilterBar>
        {FILTERS.map((f) => (
          <FilterButton
            key={f.state ?? "all"}
            icon={f.icon}
            label={t(f.state ? `offers.state.${f.state}` : "offers.all")}
            count={f.state ? counts[f.state] : counts.offers}
            attention={f.state === "error"}
            active={state === f.state}
            onClick={() => pick(f.state)}
          />
        ))}
        <FilterDivider />
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v)
            setOffset(0)
          }}
          placeholder={t("offers.search")}
        />
      </FilterBar>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{t("offers.col.offer")}</Table.HeaderCell>
            <Table.HeaderCell>{t("offers.col.state")}</Table.HeaderCell>
            <Table.HeaderCell className="text-right">{t("offers.col.price")}</Table.HeaderCell>
            <Table.HeaderCell className="text-right">{t("offers.col.avail")}</Table.HeaderCell>
            <Table.HeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {offers.isLoading ? (
            <KitSkeletonRows cols={5} rows={5} />
          ) : rows.length === 0 ? (
            <EmptyTableRow cols={5} compact icon={<CheckCircle />} title={t(status.feed.last ? "offers.empty" : "offers.emptyNever")} />
          ) : (
            rows.map((o) => (
              <Table.Row key={o.id} className="[&_td]:py-2.5 [&_td]:align-top">
                <Table.Cell className="max-w-[420px]">
                  <div className="flex min-w-0 flex-col gap-y-1">
                    <a href={`/app/products/${o.productId}`} className="txt-compact-small-plus truncate text-ui-fg-base hover:underline" title={o.title}>
                      {o.title}
                    </a>
                    <span className="flex flex-wrap items-center gap-x-2 font-mono text-ui-fg-muted txt-compact-xsmall">
                      {o.offerId ? <span title={t("offers.offerId")}>{o.offerId}</span> : <span>{t("offers.noId")}</span>}
                      {o.sku && o.sku !== o.offerId ? <span>{o.sku}</span> : null}
                    </span>
                    <ProblemList problems={o.problems} />
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <StateBadge state={o.state} />
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums">{fmtPln(o.price, lang)}</Table.Cell>
                <Table.Cell className="text-right tabular-nums">{o.avail === null ? "-" : o.stock !== null ? t("offers.availStock", { avail: o.avail, stock: o.stock }) : String(o.avail)}</Table.Cell>
                <Table.Cell className="text-right">
                  <RowActions
                    actions={[
                      { key: "take", label: t("offers.takeOver.action"), icon: <ArrowRightOnRectangle />, onClick: () => void takeOver.run(o), hidden: !o.canTakeOver, loading: takeOver.pending },
                    ]}
                  />
                </Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table>
      {count > OFFERS_PAGE ? (
        <div className="flex items-center justify-between gap-x-3 px-6 py-3">
          <Text size="xsmall" className="tabular-nums text-ui-fg-subtle">
            {t("offers.page", { from: offset + 1, to: Math.min(offset + OFFERS_PAGE, count), count })}
          </Text>
          <div className="flex gap-x-2">
            <Button size="small" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - OFFERS_PAGE))}>
              {t("offers.prev")}
            </Button>
            <Button size="small" variant="secondary" disabled={offset + OFFERS_PAGE >= count} onClick={() => setOffset(offset + OFFERS_PAGE)}>
              {t("offers.next")}
            </Button>
          </div>
        </div>
      ) : null}
    </Section>
  )
}
