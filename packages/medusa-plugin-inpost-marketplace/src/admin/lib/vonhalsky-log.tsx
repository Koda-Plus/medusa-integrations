import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { BarsArrowDown, Clock, CogSixTooth, ExclamationCircle, History as HistoryIcon, ListBullet, ShoppingCart, Tag, TruckFast } from "@medusajs/icons"
import { Table, Text } from "@medusajs/ui"
import { useVonHalskyLog } from "./vonhalsky-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, Section, ToneBadge } from "./vonhalsky-blocks"
import { KitFetchingBar, KitSkeletonRows } from "./vonhalsky-kit"
import { fmtDateTime } from "./vonhalsky-ui"

const AREAS = ["", "offers", "orders", "tracking", "settings"] as const
const AREA_ICON: Record<(typeof AREAS)[number], ReactNode> = { "": <ListBullet />, offers: <Tag />, orders: <ShoppingCart />, tracking: <TruckFast />, settings: <CogSixTooth /> }
const TONE = { ok: "green", warning: "orange", error: "red" } as const

/** The sync log: what the plugin did, newest first. */
export function LogSection({ lang }: { lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const [area, setArea] = useState<string>("")
  const [problems, setProblems] = useState(false)
  const log = useVonHalskyLog(area, problems ? "error" : "")
  const rows = log.data?.entries ?? []
  return (
    <Section
      id="vonhalsky-log"
      icon={<HistoryIcon />}
      title={t("log.title")}
      pointsLabel={t("log.subtitle")}
      points={[
        { icon: <BarsArrowDown />, text: t("log.points.newest") },
        { icon: <Clock />, text: t("log.points.kept") },
      ]}
    >
      <FilterBar>
        {AREAS.map((a) => (
          <FilterButton key={a || "all"} icon={AREA_ICON[a]} label={a ? t(`log.areas.${a}`) : t("log.all")} active={area === a} onClick={() => setArea(area === a ? "" : a)} />
        ))}
        <FilterDivider />
        <FilterButton icon={<ExclamationCircle />} label={t("log.errors")} active={problems} onClick={() => setProblems(!problems)} />
      </FilterBar>
      <KitFetchingBar active={log.isFetching && !log.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("log.when")}</Table.HeaderCell>
              <Table.HeaderCell>{t("log.area")}</Table.HeaderCell>
              <Table.HeaderCell>{t("log.message")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {log.isLoading ? <KitSkeletonRows cols={3} rows={5} /> : null}
            {!log.isLoading && rows.length === 0 ? <EmptyTableRow cols={3} icon={<HistoryIcon />} title={t("log.empty")} /> : null}
            {rows.map((e) => (
              <Table.Row key={e.id}>
                <Table.Cell className="whitespace-nowrap tabular-nums">{fmtDateTime(e.created_at, lang)}</Table.Cell>
                <Table.Cell>
                  <span className="flex items-center gap-1">
                    <ToneBadge tone={TONE[e.outcome]}>{t(`log.areas.${e.area}`, { defaultValue: e.area })}</ToneBadge>
                    {e.demo ? <ToneBadge tone="purple">{t("demo.badge")}</ToneBadge> : null}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small" className="max-w-3xl whitespace-normal text-ui-fg-base">
                    {e.message}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}
