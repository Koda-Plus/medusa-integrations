import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { CursorArrowRays, LockClosedSolid, MapPin, TruckFast } from "@medusajs/icons"
import { Checkbox, Table, Text } from "@medusajs/ui"
import { ATTENTION_GROUPS, type CountsDto, type ShipmentDto, type ShipmentFilter, type StatusResponse } from "../../modules/dpd/lib/contract"
import { useDpdShipments } from "./dpd-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, SearchInput, Section, ToneBadge, useDebouncedValue } from "./dpd-blocks"
import { DispatchActionBar, DispatchDrawer } from "./dpd-dispatch"
import { KitFetchingBar, KitSkeletonRows } from "./dpd-kit"
import { SELECTION_MAX, pageInRange, selectionPageState, selectionPrune, selectionToggle } from "./dpd-logic"
import { PlanDrawer, ShipmentActionBar } from "./dpd-plan"
import { Destination, ErrorText, GROUP_ICON, KindBadges, MedusaMark, OrderCell, ProblemList, ShipmentStatus, WaybillCell, fmtDateTime, fmtMoney } from "./dpd-ui"

const PAGE_SIZE = 15

/** Every filter of the list: everything, then the groups of the contract. */
export const FILTERS: readonly ShipmentFilter[] = ["all", "to_create", "labeled", "handed_over", "in_transit", "delivered", "problems", "canceled", "returns"]

/** The groups of the filter bar: everything, the way of a parcel, what needs a person, returns, what left the list. */
const FILTER_GROUPS: ShipmentFilter[][] = [["all"], ["to_create", "labeled", "handed_over", "in_transit", "delivered"], ["problems"], ["returns", "canceled"]]

function filterCount(c: CountsDto, f: ShipmentFilter): number {
  return f === "all" ? c.all : c[f]
}

/** The demo note, shown in the popover of the mode badge in the header. */
export function DemoDetails({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("dpd")
  if (status.mode !== "demo") return null
  return (
    <>
      <span>{t("demo.text")}</span>
      <span>{t("demo.writes")}</span>
    </>
  )
}

/** The status column: the badge, then what a person should know (the handover it is in, the error, the problems). */
function StatusCell({ shipment: s, lang }: { shipment: ShipmentDto; lang: string }) {
  const { t } = useTranslation("dpd")
  return (
    <div className="flex max-w-[280px] flex-col items-start gap-y-1">
      <ShipmentStatus shipment={s} />
      {s.dispatchId ? <ToneBadge tone="blue">{t("shipments.inDispatch")}</ToneBadge> : null}
      <ErrorText shipment={s} />
      {s.problems.length > 0 ? <ProblemList items={s.problems} /> : null}
      {s.handedOverAt ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {fmtDateTime(s.handedOverAt, lang)}
        </Text>
      ) : null}
    </div>
  )
}

export function ShipmentsSection({
  status,
  lang,
  filter,
  onFilter,
  initialQuery = "",
  seeding = false,
  seedFailed = false,
  onSettings,
  onOpenDispatch,
}: {
  status: StatusResponse
  lang: string
  filter: ShipmentFilter
  onFilter: (f: ShipmentFilter) => void
  /** From the page URL (?q=), e.g. the order number a host links to. */
  initialQuery?: string
  /** Demo mode: the sample shipments are being built right now. */
  seeding?: boolean
  /** Demo mode: building the sample shipments failed; the page shows the error with Retry above. */
  seedFailed?: boolean
  /** Opens Settings, Writers (from the plan of a shipment when the writer is not armed). */
  onSettings?: () => void
  /** Opens the handover of a shipment (the page keeps it in the URL as ?dispatch=). */
  onOpenDispatch?: (id: string) => void
}) {
  const { t } = useTranslation("dpd")
  const [search, setSearch] = useState(initialQuery)
  const q = useDebouncedValue(search.trim())
  const [page, setPage] = useState(0)
  /* The shipment whose plan is open in the drawer. */
  const [planFor, setPlanFor] = useState<string | null>(null)
  const writerArmed = status.writers.shipment.armed
  /* The shipments picked for a handover: kept across pages and filters, never in the URL; gone after a handover and on Clear. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  /* The shipments of the handover drawer while it is open. */
  const [handover, setHandover] = useState<string[] | null>(null)
  useEffect(() => setPage(0), [filter, q])
  const list = useDpdShipments(filter, q, page * PAGE_SIZE, PAGE_SIZE)
  /* After an action shrank the list below this page, the last page that has rows. */
  const total = list.data?.count
  useEffect(() => {
    if (total !== undefined) setPage((p) => pageInRange(p, total, PAGE_SIZE))
  }, [total])
  /* A picked shipment that is no candidate any more (do not send, another tab) leaves the selection with its box. */
  const listed = list.data?.shipments
  useEffect(() => {
    if (listed) setSelected((sel) => selectionPrune(sel, listed))
  }, [listed])
  const rows = list.data?.shipments ?? []
  const count = list.data?.count ?? 0
  const counts = list.data?.counts ?? status.counts
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  /* A second click on the active filter clears it. */
  const pick = (f: ShipmentFilter) => onFilter(filter === f ? "all" : f)
  const fresh = filter === "all" && !q
  const demo = status.mode === "demo"
  /* Demo with no rows: being built, or not yet (no orders, a failed seed, a reset); real data: none yet. */
  const emptyTitle = demo ? (seeding ? "shipments.seeding" : "shipments.emptyDemo") : "shipments.emptyAll"
  const emptyHint = demo ? (seeding ? "shipments.seedingHint" : "shipments.emptyDemoHint") : "shipments.emptyHint"
  /* After a failed seed the error tip with Retry says it all; no hint that the rows come by themselves. */
  const showHint = fresh && !(demo && seedFailed && !seeding)
  /* Only a candidate (labeled, outbound, domestic, free) can be picked. */
  const pageIds = rows.filter((r) => r.actions.dispatch).map((r) => r.id)
  const pageState = selectionPageState(selected, pageIds)
  const full = selected.size >= SELECTION_MAX
  /* At the limit the header can add nothing: disabled with the limit, like the row boxes (it still clears a page whose rows are all selected). */
  const pageFull = full && pageState !== "all"

  return (
    <Section
      id="dpd-shipments"
      icon={<TruckFast />}
      title={t("shipments.title")}
      pointsLabel={t("shipments.subtitle")}
      points={[
        { icon: <MapPin />, text: t("shipments.points.kinds") },
        { icon: <LockClosedSolid />, text: t("shipments.points.noSend"), tone: "green" },
        { icon: <CursorArrowRays />, text: t("shipments.points.row") },
      ]}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("shipments.search")} className="sm:w-72" />}
    >
      <FilterBar>
        {FILTER_GROUPS.map((group, i) => (
          <span key={group.join()} className="contents">
            {i > 0 ? <FilterDivider /> : null}
            {group.map((f) => (
              <FilterButton
                key={f}
                icon={GROUP_ICON[f]}
                label={t(`shipments.filter.${f}`)}
                count={filterCount(counts, f)}
                attention={f !== "all" && ATTENTION_GROUPS.includes(f)}
                active={filter === f}
                onClick={() => pick(f)}
              />
            ))}
          </span>
        ))}
      </FilterBar>
      <KitFetchingBar active={list.isFetching && !list.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell className="w-8">
                <Checkbox
                  aria-label={t("shipments.selectPage")}
                  title={pageFull ? t("shipments.selectLimit", { max: SELECTION_MAX }) : t("shipments.selectPage")}
                  disabled={pageIds.length === 0 || pageFull}
                  checked={pageState === "all" ? true : pageState === "some" ? "indeterminate" : false}
                  onCheckedChange={() => setSelected((sel) => selectionToggle(sel, pageIds, pageState !== "all"))}
                />
              </Table.HeaderCell>
              <Table.HeaderCell>
                <span className="inline-flex items-center gap-x-1.5">
                  <MedusaMark className="h-3.5 w-3.5 text-ui-fg-muted" />
                  {t("shipments.col.order")}
                </span>
              </Table.HeaderCell>
              <Table.HeaderCell>{t("shipments.col.service")}</Table.HeaderCell>
              <Table.HeaderCell>{t("shipments.col.destination")}</Table.HeaderCell>
              <Table.HeaderCell>{t("shipments.col.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("shipments.col.waybills")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("shipments.col.cod")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("shipments.col.actions")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.isLoading ? <KitSkeletonRows cols={8} rows={5} /> : null}
            {!list.isLoading && list.isError ? <EmptyTableRow cols={8} icon={GROUP_ICON.problems} title={t("shipments.failed")} /> : null}
            {!list.isLoading && !list.isError && rows.length === 0 ? (
              <EmptyTableRow
                cols={8}
                icon={GROUP_ICON[filter]}
                title={fresh ? t(emptyTitle) : t("shipments.empty")}
                points={showHint ? [{ icon: <TruckFast />, text: t(emptyHint) }] : undefined}
              />
            ) : null}
            {rows.map((s) => (
              <Table.Row key={s.id} className="align-top [&_td]:py-2.5">
                <Table.Cell className="w-8">
                  {s.actions.dispatch ? (
                    <Checkbox
                      aria-label={t("shipments.select")}
                      title={full && !selected.has(s.id) ? t("shipments.selectLimit", { max: SELECTION_MAX }) : t("shipments.select")}
                      disabled={full && !selected.has(s.id)}
                      checked={selected.has(s.id)}
                      onCheckedChange={(v) => setSelected((sel) => selectionToggle(sel, [s.id], v === true))}
                    />
                  ) : null}
                </Table.Cell>
                <Table.Cell className="max-w-[200px]">
                  <OrderCell orderId={s.orderId} displayId={s.displayId} />
                </Table.Cell>
                <Table.Cell>
                  <div className="flex flex-col items-start gap-y-1">
                    <KindBadges shipment={s} />
                    {s.demo ? <ToneBadge tone="purple">{t("shipments.sample")}</ToneBadge> : null}
                  </div>
                </Table.Cell>
                <Table.Cell className="max-w-[240px]">
                  <Destination shipment={s} />
                </Table.Cell>
                <Table.Cell>
                  <StatusCell shipment={s} lang={lang} />
                </Table.Cell>
                <Table.Cell>
                  <WaybillCell shipment={s} />
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap text-right tabular-nums">
                  {s.codAmount ? fmtMoney(s.codAmount, s.currency, lang) : s.cod ? <span className="text-ui-fg-muted">{t("shipments.codLater")}</span> : ""}
                </Table.Cell>
                <Table.Cell className="text-right">
                  <ShipmentActionBar
                    shipment={s}
                    writerArmed={writerArmed}
                    writer={status.writers.shipment}
                    onPlan={() => setPlanFor(s.id)}
                    onHandover={(ids) => setHandover(ids)}
                    onOpenDispatch={onOpenDispatch}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
      <Table.Pagination
        count={count}
        pageSize={PAGE_SIZE}
        pageIndex={page}
        pageCount={pageCount}
        canPreviousPage={page > 0}
        canNextPage={page + 1 < pageCount}
        previousPage={() => setPage((x) => Math.max(0, x - 1))}
        nextPage={() => setPage((x) => x + 1)}
        translations={{ of: t("pagination.of"), results: t("pagination.results"), pages: t("pagination.pages"), prev: t("pagination.prev"), next: t("pagination.next") }}
      />
      <DispatchActionBar count={selected.size} onHandover={() => setHandover([...selected])} onClear={() => setSelected(new Set())} />
      {handover ? (
        <DispatchDrawer
          shipmentIds={handover}
          lang={lang}
          onClose={() => setHandover(null)}
          /* A handover exists now (printed or stopped after the create): the picked shipments are in it. */
          onCreated={() => setSelected(new Set())}
          onSettings={
            onSettings
              ? () => {
                  setHandover(null)
                  onSettings()
                }
              : undefined
          }
        />
      ) : null}
      {planFor ? (
        <PlanDrawer
          shipmentId={planFor}
          lang={lang}
          writer={status.writers.shipment}
          onClose={() => setPlanFor(null)}
          onSettings={
            onSettings
              ? () => {
                  setPlanFor(null)
                  onSettings()
                }
              : undefined
          }
        />
      ) : null}
    </Section>
  )
}
