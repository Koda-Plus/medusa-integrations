import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge, Container, Heading, Input, Table, Text } from "@medusajs/ui"
import type { ParcelDto, ParcelFilter, StatusResponse } from "../../modules/inpost/lib/contract"
import { useInpostParcels } from "./inpost-api"
import { nb } from "./inpost-guide"
import { ParcelActions, ParcelDrawer } from "./inpost-plan"
import { Chip, KindBadges, LockerLines, MedusaMark, OrderCell, ParcelStatus, ProblemList, TrackingCell, fmtDateTime, fmtMoney } from "./inpost-ui"

const PAGE_SIZE = 15

export const FILTERS: ParcelFilter[] = ["all", "to_create", "waiting", "in_transit", "in_locker", "delivered", "problems", "skipped", "canceled"]

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

function useDebounced(value: string, ms = 300): string {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value.trim()), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return out
}

/** Where the parcel goes: the locker, or the order's address for a courier (not stored here). */
function Destination({ parcel }: { parcel: ParcelDto }) {
  const { t } = useTranslation("inpost")
  if (parcel.kind === "locker") {
    return parcel.locker ? (
      <LockerLines locker={parcel.locker} />
    ) : (
      <Badge size="2xsmall" color="red">
        {t("parcels.noLocker")}
      </Badge>
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
      {p.external ? (
        <Badge size="2xsmall" color="grey">
          {t("parcels.external")}
        </Badge>
      ) : null}
      {p.error && (p.state === "failed" || p.state === "unknown") ? (
        <Text size="xsmall" className="text-ui-tag-red-text">
          {nb(p.error)}
        </Text>
      ) : null}
      {p.problems.length > 0 && (p.state === "pending" || p.state === "failed") ? <ProblemList items={p.problems} /> : null}
      {p.fulfillmentCanceledAt && p.state === "created" ? (
        <Badge size="2xsmall" color="orange">
          {t("parcels.fulfillmentCanceled")}
        </Badge>
      ) : null}
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
  onSettings,
}: {
  status: StatusResponse
  lang: string
  filter: ParcelFilter
  onFilter: (f: ParcelFilter) => void
  poll: boolean
  onSettings: () => void
}) {
  const { t } = useTranslation("inpost")
  const [search, setSearch] = useState("")
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => setPage(0), [filter, q])
  const parcels = useInpostParcels(filter, q, page * PAGE_SIZE, PAGE_SIZE, poll)
  const rows = parcels.data?.parcels ?? []
  const count = parcels.data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("parcels.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("parcels.subtitle")}
        </Text>
      </div>
      <div className="flex flex-col gap-3 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Chip key={f} active={filter === f} label={t(`parcels.filter.${f}`)} count={filterCount(status, f)} onClick={() => onFilter(f)} />
          ))}
        </div>
        <div className="w-full lg:w-72">
          <Input size="small" type="search" placeholder={t("parcels.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
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
            {rows.length === 0 ? (
              <Table.Row>
                <td colSpan={7} className="px-6 py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {parcels.isLoading ? "" : filter === "all" && !q ? t(status.mode === "demo" ? "parcels.emptyDemo" : "parcels.emptyAll") : t("parcels.empty")}
                  </Text>
                </td>
              </Table.Row>
            ) : (
              rows.map((p) => (
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
                    <KindBadges parcel={p} />
                    {p.demo ? (
                      <Badge size="2xsmall" color="purple" className="mt-1">
                        {t("parcels.sample")}
                      </Badge>
                    ) : null}
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
                    <ParcelActions parcel={p} lang={lang} writers={status.writers} onOpen={() => setOpen(p.id)} onSettings={onSettings} compact />
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
        pageCount={pageCount}
        canPreviousPage={page > 0}
        canNextPage={page + 1 < pageCount}
        previousPage={() => setPage((x) => Math.max(0, x - 1))}
        nextPage={() => setPage((x) => x + 1)}
        translations={{ of: t("pagination.of"), results: t("pagination.results"), pages: t("pagination.pages"), prev: t("pagination.prev"), next: t("pagination.next") }}
      />
      {open ? <ParcelDrawer parcelId={open} lang={lang} writers={status.writers} onClose={() => setOpen(null)} onSettings={onSettings} /> : null}
    </Container>
  )
}
