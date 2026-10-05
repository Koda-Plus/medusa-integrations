import { useTranslation } from "react-i18next"
import { Badge, Container, InlineTip, Switch, Text, clx, toast, usePrompt } from "@medusajs/ui"
import { LockClosedSolid } from "@medusajs/icons"
import type { AllegroStatusResponse, AllegroWriterDto, AllegroWriterKey } from "../../modules/allegro/lib/contract"
import { errorMessage, useAllegroWriterToggle } from "./allegro-api"
import { SectionHeader, fmtDateTime } from "./allegro-ui"

/** The order the writers should be armed in: orders first, so Allegro sales reach Medusa before stock moves. */
export const WRITER_ORDER: AllegroWriterKey[] = ["orders", "stock", "shipping", "invoices", "prices", "publish"]

function WriterRow({ writer, status, lang }: { writer: AllegroWriterDto; status: AllegroStatusResponse; lang: string }) {
  const { t } = useTranslation("allegro")
  const prompt = usePrompt()
  const toggle = useAllegroWriterToggle()
  const name = t(`writers.names.${writer.key}`)
  const demo = status.mode === "demo"
  const canArm = writer.blockers.length === 0
  const locked = !writer.allowed

  const onChange = async (armed: boolean) => {
    const ok = await prompt({
      title: armed ? t("writers.armTitle", { name }) : t("writers.disarmTitle", { name }),
      description: armed ? (demo ? t("writers.armTextDemo") : writer.key === "orders" ? t("writers.armTextOrders") : t("writers.armText")) : t("writers.disarmText"),
      confirmText: armed ? t("writers.armConfirm") : t("writers.disarmConfirm"),
      cancelText: t("writers.cancel"),
    })
    if (!ok) return
    try {
      await toggle.mutateAsync({ key: writer.key, armed })
      toast.success(armed ? t("toast.armed") : t("toast.disarmed"))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const blockers = writer.blockers.filter((b) => b !== "hard_switch")
  return (
    <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {name}
          </Text>
          {writer.effective ? (
            <Badge size="2xsmall" color="green">
              {t("writers.state.armed")}
            </Badge>
          ) : writer.armed ? (
            <Badge size="2xsmall" color="orange">
              {t("writers.state.blocked")}
            </Badge>
          ) : (
            <Badge size="2xsmall" color="grey">
              {t("writers.state.off")}
            </Badge>
          )}
          {!writer.writesAllegro ? (
            <Badge size="2xsmall" color="blue">
              {t("writers.medusaOnly")}
            </Badge>
          ) : null}
          {locked ? (
            <Badge size="2xsmall" color="grey">
              <span className="inline-flex items-center gap-x-1">
                <LockClosedSolid />
                {t("writers.notAllowed", { key: writer.key })}
              </span>
            </Badge>
          ) : (
            <Badge size="2xsmall" color="grey">
              {t("writers.allowed")}
            </Badge>
          )}
        </div>
        <Text size="small" className="max-w-2xl text-ui-fg-subtle">
          {t(`writers.describe.${writer.key}`)}
        </Text>
        {blockers.map((b) => (
          <Text key={b} size="xsmall" className="text-ui-tag-orange-text">
            {t(`writers.blocker.${b}`, { scopes: writer.missingScopes.join(", ") })}
          </Text>
        ))}
        {writer.modeChanged ? (
          <Text size="xsmall" className="text-ui-tag-orange-text">
            {t("writers.modeChanged")}
          </Text>
        ) : null}
        {writer.tripReason && !writer.armed ? (
          <InlineTip variant="error" label={name}>
            {t("writers.tripped", { when: fmtDateTime(writer.trippedAt, lang), reason: writer.tripReason })}
          </InlineTip>
        ) : null}
        <Text size="xsmall" className="text-ui-fg-muted">
          {writer.changedAt
            ? writer.armed
              ? t("writers.armedBy", { who: writer.changedBy ?? "?", when: fmtDateTime(writer.changedAt, lang) })
              : t("writers.disarmedBy", { who: writer.changedBy ?? "?", when: fmtDateTime(writer.changedAt, lang) })
            : t("writers.never")}
          {writer.lastRunAt ? ` | ${t("writers.lastRun", { when: fmtDateTime(writer.lastRunAt, lang) })}` : ""}
          {writer.failureStreak > 0 ? ` | ${t("writers.streak", { count: writer.failureStreak, limit: status.settings.breakerThreshold })}` : ""}
        </Text>
      </div>
      <div className="flex shrink-0 items-center gap-x-2 pt-0.5">
        <Switch
          checked={writer.armed}
          disabled={toggle.isPending || (!writer.armed && !canArm)}
          onCheckedChange={(v) => void onChange(Boolean(v))}
          aria-label={name}
        />
      </div>
    </div>
  )
}

export function WritersSection({ status, lang }: { status: AllegroStatusResponse; lang: string }) {
  const { t } = useTranslation("allegro")
  const writers = WRITER_ORDER.map((k) => status.writers.find((w) => w.key === k)).filter((w): w is AllegroWriterDto => Boolean(w))
  return (
    <Container className="divide-y p-0">
      <SectionHeader title={t("writers.title")} subtitle={t("writers.subtitle")} />
      {status.mode === "demo" ? (
        <div className="px-6 py-3">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("writers.demoNote")}
          </Text>
        </div>
      ) : null}
      <div className={clx("divide-y")}>
        {writers.map((w) => (
          <WriterRow key={w.key} writer={w} status={status} lang={lang} />
        ))}
      </div>
    </Container>
  )
}
