import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge, StatusBadge, Table, Text } from "@medusajs/ui"
import { useVonHalskyLog } from "./vonhalsky-api"
import { KitLoading } from "./vonhalsky-kit"
import { Chip, Section, fmtDateTime } from "./vonhalsky-ui"

const AREAS = ["", "offers", "orders", "tracking", "settings"] as const
const TONE = { ok: "green", warning: "orange", error: "red" } as const

/** The sync log: what the plugin did, newest first. */
export function LogSection({ lang }: { lang: string }) {
  const { t } = useTranslation("vonhalsky")
  const [area, setArea] = useState<string>("")
  const [problems, setProblems] = useState(false)
  const log = useVonHalskyLog(area, problems ? "error" : "")
  const rows = log.data?.entries ?? []
  return (
    <Section title={t("log.title")} subtitle={t("log.subtitle")}>
      <div className="flex flex-wrap gap-1.5 px-6 py-3">
        {AREAS.map((a) => (
          <Chip key={a || "all"} active={area === a} label={a ? t(`log.areas.${a}`) : t("log.all")} onClick={() => setArea(a)} />
        ))}
        <Chip active={problems} label={t("log.errors")} onClick={() => setProblems(!problems)} />
      </div>
      {log.isLoading ? (
        <KitLoading label={t("widget.loading")} />
      ) : rows.length === 0 ? (
        <Text size="small" className="px-6 py-6 text-ui-fg-subtle">
          {t("log.empty")}
        </Text>
      ) : (
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
              {rows.map((e) => (
                <Table.Row key={e.id}>
                  <Table.Cell className="whitespace-nowrap tabular-nums">{fmtDateTime(e.created_at, lang)}</Table.Cell>
                  <Table.Cell>
                    <span className="flex items-center gap-1">
                      <StatusBadge color={TONE[e.outcome]}>{t(`log.areas.${e.area}`, { defaultValue: e.area })}</StatusBadge>
                      {e.demo ? (
                        <Badge size="2xsmall" color="purple">
                          {t("demo.badge")}
                        </Badge>
                      ) : null}
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
      )}
    </Section>
  )
}
