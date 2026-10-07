import type { ReactNode } from "react"
import { Badge, Button, Container, Heading, InlineTip, Text, toast, usePrompt } from "@medusajs/ui"
import type { StatusResponse } from "../../modules/tasks/lib/contract"
import { useResetSandbox } from "./tasks-api"
import { useFailToast } from "./tasks-form"
import { PersonAvatar, fmtDateTime, fmtNumber, fmtRelative, roleLine, useLabels } from "./tasks-ui"

/*
 * Settings: the options in use (read only), who works on which board, the
 * tasks taken over from the KODA Panel module, and the sandbox board.
 */

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-0.5">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <div className="txt-small break-words text-ui-fg-base">{children}</div>
    </div>
  )
}

function list(values: string[] | null, count: number, labels: ReturnType<typeof useLabels>): ReactNode {
  if (count === 0) return labels.t("general.none")
  if (!values) return labels.t("general.accounts", { count })
  return (
    <span className="flex flex-wrap gap-1">
      {values.map((v) => (
        <Badge key={v} size="2xsmall" color="grey">
          {v}
        </Badge>
      ))}
    </span>
  )
}

/** "Reset the sandbox" with its confirmation, for the header and the Sandbox tab. */
export function useResetAction() {
  const labels = useLabels()
  const { t } = labels
  const prompt = usePrompt()
  const fail = useFailToast()
  const reset = useResetSandbox()
  const run = async () => {
    const ok = await prompt({ title: t("confirm.resetTitle"), description: t("confirm.resetText"), confirmText: t("confirm.resetConfirm"), cancelText: t("confirm.cancel") })
    if (!ok) return
    try {
      await reset.mutateAsync()
      toast.success(t("toast.reset"))
    } catch (err) {
      fail(err)
    }
  }
  return { run, pending: reset.isPending }
}

/** The note behind the Sandbox board badge. */
export function SandboxDetails({ status }: { status: StatusResponse }) {
  const { t, lang } = useLabels()
  const s = status.sandbox_board
  return (
    <>
      <span>{t("sandbox.text")}</span>
      <span>{s.reset_hours > 0 ? t("sandbox.reset", { count: s.reset_hours }) : t("sandbox.resetManual")}</span>
      {s.seeded_at ? <span>{t("sandbox.seeded", { time: fmtDateTime(s.seeded_at, lang) })}</span> : null}
      <span>{t("sandbox.everyone")}</span>
    </>
  )
}

export function GeneralSection({ status }: { status: StatusResponse }) {
  const labels = useLabels()
  const { t, lang } = labels
  const o = status.options
  const a = status.adoption

  return (
    <>
      <Container className="divide-y p-0">
        <div className="flex flex-col gap-1 px-6 py-4">
          <Heading level="h2">{t("general.title")}</Heading>
          <Text size="small" className="max-w-3xl text-ui-fg-subtle">
            {t("general.subtitle")}
          </Text>
        </div>
        <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-3">
          <Fact label={t("general.you")}>{status.viewer.name ?? status.viewer.email ?? status.viewer.id}</Fact>
          <Fact label={t("general.yourBoard")}>{status.sandbox ? t("general.boardSandbox") : t("general.boardMain")}</Fact>
          <Fact label={t("general.yourRole")}>{labels.role(status.viewer.role)}</Fact>
          <Fact label={t("general.sandboxAccounts")}>{list(o.sandbox_accounts, o.sandbox_account_count, labels)}</Fact>
          <Fact label={t("general.agencyAccounts")}>{list(o.agency_accounts, o.agency_account_count, labels)}</Fact>
          <Fact label={t("general.resetHours")}>{o.sandbox_reset_hours > 0 ? t("general.hours", { count: o.sandbox_reset_hours }) : t("general.onlyReset")}</Fact>
          <Fact label={t("general.people")}>
            {status.named_people.length === 0 ? (
              t("general.none")
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {status.named_people.map((n) => (
                  <span key={n.name} className="inline-flex items-center gap-x-1.5 rounded-full border border-ui-border-base bg-ui-bg-component py-0.5 pl-0.5 pr-2" title={roleLine(n.role, lang) ?? undefined}>
                    <PersonAvatar who={{ name: n.name, url: n.avatar, ai: n.kind === "agent" }} />
                    <span className="txt-compact-xsmall-plus">{n.name}</span>
                  </span>
                ))}
              </span>
            )}
          </Fact>
          <Fact label={t("general.references")}>{fmtNumber(status.references.length, lang)}</Fact>
          <Fact label={t("general.automation")}>
            {status.automation.api_key_activity > 0
              ? t("general.automationSome", { count: status.automation.api_key_activity, time: fmtRelative(status.automation.last_api_key_at, lang) })
              : t("general.automationNone")}
          </Fact>
        </div>
        <div className="px-6 py-3">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("general.optionsHint")}
          </Text>
        </div>
      </Container>

      {a ? (
        <Container className="divide-y p-0">
          <div className="flex flex-col gap-1 px-6 py-4">
            <Heading level="h2">{t("adoption.title")}</Heading>
          </div>
          <div className="px-6 py-4">
            {a.state === "adopted" ? (
              <Text size="small" className="max-w-3xl text-ui-fg-subtle">
                {t("adoption.adopted", { time: fmtDateTime(a.at, lang), tasks: a.tasks, comments: a.comments, activity: a.activity })}
              </Text>
            ) : (
              <InlineTip variant="warning" label={t("adoption.title")}>
                {t("adoption.skipped", { reason: a.reason ?? "" })}
              </InlineTip>
            )}
          </div>
        </Container>
      ) : null}
    </>
  )
}

export function SandboxSection({ status }: { status: StatusResponse }) {
  const labels = useLabels()
  const { t, lang } = labels
  const s = status.sandbox_board
  const reset = useResetAction()

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-3xl flex-col gap-1">
          <Heading level="h2">{t("sandboxTab.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("sandboxTab.subtitle")}
          </Text>
        </div>
        {s.enabled ? (
          <Button size="small" variant="secondary" isLoading={reset.pending} onClick={() => void reset.run()}>
            {t("actions.resetSandbox")}
          </Button>
        ) : null}
      </div>
      {s.enabled ? (
        <>
          <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
            <Fact label={t("sandboxTab.accounts")}>{list(status.options.sandbox_accounts, status.options.sandbox_account_count, labels)}</Fact>
            <Fact label={t("sandboxTab.seeded")}>{s.seeded_at ? fmtDateTime(s.seeded_at, lang) : t("sandboxTab.never")}</Fact>
            <Fact label={t("sandboxTab.tasks")}>{fmtNumber(s.tasks, lang)}</Fact>
            <Fact label={t("sandboxTab.next")}>
              {s.next_reset_at ? t("sandboxTab.onOpen", { time: fmtDateTime(s.next_reset_at, lang) }) : t("general.onlyReset")}
            </Fact>
          </div>
          <div className="px-6 py-3">
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("sandboxTab.resetHint")}
            </Text>
          </div>
        </>
      ) : (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            {t("sandboxTab.off")}
          </Text>
        </div>
      )}
    </Container>
  )
}
