import { useEffect, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArchiveBox, ArrowPath, CheckCircle, Clock, CursorArrowRays, ExclamationCircle, ListBullet, MapPin, MinusCircle, PaperPlane, TruckFast, XCircle } from "@medusajs/icons"
import { Table, Text } from "@medusajs/ui"
import type { ParcelDto, ParcelFilter, StatusResponse } from "../../modules/inpost/lib/contract"
import { useInpostParcels } from "./inpost-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, SearchInput, Section, ToneBadge, useDebouncedValue } from "./inpost-blocks"
import { nb } from "./inpost-guide"
import { KitFetchingBar, KitSkeletonRows } from "./inpost-kit"
import { ParcelActions, ParcelDrawer } from "./inpost-plan"
import { KindBadges, LockerLines, MedusaMark, OrderCell, ParcelStatus, ProblemList, TrackingCell, fmtDateTime, fmtMoney } from "./inpost-ui"

const PAGE_SIZE = 15

export const FILTERS: ParcelFilter[] = ["all", "to_create", "waiting", "in_transit", "in_locker", "delivered", "problems", "skipped", "canceled"]

/** The icon of each list, the same on the counters of the page header. */
export const FILTER_ICON: Record<ParcelFilter, ReactNode> = {
  all: <ListBullet />,
  to_create: <PaperPlane />,
  waiting: <Clock />,
  in_transit: <TruckFast />,
  in_locker: <ArchiveBox />,
  delivered: <CheckCircle />,
  problems: <ExclamationCircle />,
  skipped: <MinusCircle />,
  canceled: <XCircle />,
}

/** The groups of the filter bar: everything, the way of a parcel, what needs a person, what left the list. */
const FILTER_GROUPS: ParcelFilter[][] = [["all"], ["to_create", "waiting", "in_transit", "in_locker", "delivered"], ["problems"], ["skipped", "canceled"]]
const ATTENTION: ParcelFilter[] = ["to_create", "problems"]

function filterCount(s: StatusResponse, f: ParcelFilter): number {
  return f === "all" ? s.counts.all : s.counts[f]
}

/** The demo note, shown in the popover of the mode badge in the header. */
export function DemoDetails({ status }: { status: StatusResponse }) {
  const { t } = useTranslation("inpost")
  if (status.mode !== "demo") return null
  return (
    <>
      <span>{t("demo.text")}</span>
      <span>{t("demo.writes")}</span>
      {status.demoReason === "no_token" ? <span>{t("demo.noToken")}</span> : null}
    </>
  )
}

/** Where the parcel goes: the locker, or the order's address for a courier (not stored here). */
function Destination({ parcel }: { parcel: ParcelDto }) {
  const { t } = useTranslation("inpost")
  if (parcel.kind === "locker") {
    return parcel.locker ? (
      <LockerLines locker={parcel.locker} />
    ) : (
      <ToneBadge tone="red" icon={<MapPin />}>
        {t("parcels.noLocker")}
      </ToneBadge>
    )
  }
  return (
    <Text size="small" className="text-ui-fg-subtle">
      {t("parcels.courierTo")}
    </Text>
  )
}

/** The status column: the badge, then what a person should know (an error, the problems, a flag). */
function StatusCell({ parcel: p, lang }: { parcel: ParcelDto; lang: string }) {
  const { t } = useTranslation("inpost")
  return (
    <div className="flex max-w-[280px] flex-col items-start gap-y-1">
      <ParcelStatus parcel={p} />
      {p.state === "skipped" && p.skipReason ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {p.skipReason === "manual" ? t("parcels.skippedManual") : t("parcels.skippedKey", { key: p.skipReason })}
        </Text>
      ) : null}
      {p.external ? <ToneBadge>{t("parcels.external")}</ToneBadge> : null}
      {p.error && (p.state === "failed" || p.state === "unknown") ? (
        <Text size="xsmall" className="text-ui-tag-red-text">
          {nb(p.error)}
        </Text>
      ) : null}
      {p.problems.length > 0 && (p.state === "pending" || p.state === "failed") ? <ProblemList items={p.problems} /> : null}
      {p.fulfillmentCanceledAt && p.state === "created" ? <ToneBadge tone="orange">{t("parcels.fulfillmentCanceled")}</ToneBadge> : null}
      {p.dispatch?.state === "requested" ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("parcels.pickupOrdered", { id: p.dispatch.orderId ?? "" })}
        </Text>
      ) : null}
      {p.statusAt ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {fmtDateTime(p.statusAt, lang)}
        </Text>
      ) : null}
    </div>
  )
}

export function ParcelsSection({
  status,
  lang,
  filter,
  onFilter,
  poll,
  initialQuery = "",
  onSettings,
}: {
  status: StatusResponse
  lang: string
  filter: ParcelFilter
  onFilter: (f: ParcelFilter) => void
  poll: boolean
  /** From the page URL (?q=), e.g. the order number a host links to. */
  initialQuery?: string
  onSettings: () => void
}) {
  const { t } = useTranslation("inpost")
  const [search, setSearch] = useState(initialQuery)
  const q = useDebouncedValue(search.trim())
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => setPage(0), [filter, q])
  const parcels = useInpostParcels(filter, q, page * PAGE_SIZE, PAGE_SIZE, poll)
  const rows = parcels.data?.parcels ?? []
  const count = parcels.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  /* A second click on the active filter clears it. */
  const pick = (f: ParcelFilter) => onFilter(filter === f ? "all" : f)
  const fresh = filter === "all" && !q

  return (
    <Section
      id="inpost-parcels"
      icon={<TruckFast />}
      title={t("parcels.title")}
      pointsLabel={t("parcels.subtitle")}
      points={[
        { icon: <PaperPlane />, text: t("parcels.points.plan") },
        { icon: <ArrowPath />, text: t("parcels.points.statuses") },
        { icon: <CursorArrowRays />, text: t("parcels.points.row") },
      ]}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("parcels.search")} className="sm:w-72" />}
    >
      <FilterBar>
        {FILTER_GROUPS.map((group, i) => (
          <span key={group.join()} className="contents">
            {i > 0 ? <FilterDivider /> : null}
            {group.map((f) => (
              <FilterButton
                key={f}
                icon={FILTER_ICON[f]}
                label={t(`parcels.filter.${f}`)}
                count={filterCount(status, f)}
                attention={ATTENTION.includes(f)}
                active={filter === f}
                onClick={() => pick(f)}
              />
            ))}
          </span>
        ))}
      </FilterBar>
      <KitFetchingBar active={parcels.isFetching && !parcels.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>
                <span className="inline-flex items-center gap-x-1.5">
                  <MedusaMark className="h-3.5 w-3.5 text-ui-fg-muted" />
                  {t("parcels.col.order")}
                </span>
              </Table.HeaderCell>
              <Table.HeaderCell>{t("parcels.col.service")}</Table.HeaderCell>
              <Table.HeaderCell>{t("parcels.col.destination")}</Table.HeaderCell>
              <Table.HeaderCell>{t("parcels.col.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("parcels.col.tracking")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("parcels.col.cod")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {parcels.isLoading ? <KitSkeletonRows cols={7} rows={5} /> : null}
            {!parcels.isLoading && rows.length === 0 ? (
              <EmptyTableRow
                cols={7}
                icon={FILTER_ICON[filter]}
                title={fresh ? t(status.mode === "demo" ? "parcels.emptyDemo" : "parcels.emptyAll") : t("parcels.empty")}
                points={fresh ? [{ icon: <TruckFast />, text: t(status.mode === "demo" ? "parcels.emptyDemoHint" : "parcels.emptyHint") }] : undefined}
              />
            ) : null}
            {rows.map((p) => (
              <Table.Row key={p.id} className="align-top [&_td]:py-2.5">
                <Table.Cell className="max-w-[200px]">
                  <div className="flex flex-col items-start gap-y-1">
                    <OrderCell orderId={p.orderId} displayId={p.displayId} />
                    {p.parcelNo > 1 ? (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {t("parcels.parcelNo", { n: p.parcelNo })}
                      </Text>
                    ) : null}
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <div className="flex flex-col items-start gap-y-1">
                    <KindBadges parcel={p} />
                    {p.demo ? <ToneBadge tone="purple">{t("parcels.sample")}</ToneBadge> : null}
                  </div>
                </Table.Cell>
                <Table.Cell className="max-w-[260px]">
                  <Destination parcel={p} />
                </Table.Cell>
                <Table.Cell>
                  <StatusCell parcel={p} lang={lang} />
                </Table.Cell>
                <Table.Cell>
                  <TrackingCell parcel={p} />
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap text-right tabular-nums">{p.codAmount ? fmtMoney(p.codAmount, p.currency, lang) : p.cod ? <span className="text-ui-fg-muted">{t("parcels.codOnCreate")}</span> : ""}</Table.Cell>
                <Table.Cell className="text-right">
                  <ParcelActions parcel={p} lang={lang} writers={status.writers} onOpen={() => setOpen(p.id)} onSettings={onSettings} layout="row" />
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
      {open ? <ParcelDrawer parcelId={open} lang={lang} writers={status.writers} onClose={() => setOpen(null)} onSettings={onSettings} /> : null}
    </Section>
  )
}
