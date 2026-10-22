import type { ReactNode } from "react"
import { ArrowDownTray, ArrowPath, ArrowUturnLeft, Beaker, ChatBubble, CheckCircle, Clock, CogSixTooth, Eye, History, ListBullet, LockClosedSolid, Users } from "@medusajs/icons"
import { Button, InlineTip, Text, toast, usePrompt } from "@medusajs/ui"
import type { StatusResponse } from "../../modules/tasks/lib/contract"
import { useResetSandbox } from "./tasks-api"
import { EmptyState, Section, ToneBadge } from "./tasks-blocks"
import { KeyPoints } from "./tasks-guide"
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
        <ToneBadge key={v}>{v}</ToneBadge>
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
      <Section
        id="tasks-options"
        icon={<CogSixTooth />}
        title={t("general.title")}
        pointsLabel={t("general.optionsHint")}
        points={[
          { icon: <Eye />, text: t("general.points.readOnly"), tone: "blue" },
          { icon: <CogSixTooth />, text: t("general.points.config") },
          { icon: <ArrowPath />, text: t("general.points.restart") },
        ]}
      >
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
          <Fact label={t("general.agentKeys")}>{o.agent_key_prefix ? t("general.agentKeysOn", { prefix: o.agent_key_prefix }) : t("general.agentKeysOff")}</Fact>
          <Fact label={t("general.automation")}>
            {status.automation.api_key_activity > 0
              ? t("general.automationSome", { count: status.automation.api_key_activity, time: fmtRelative(status.automation.last_api_key_at, lang) })
              : t("general.automationNone")}
          </Fact>
        </div>
      </Section>

      {a ? (
        <Section
          id="tasks-adoption"
          icon={<ArrowDownTray />}
          title={t("adoption.title")}
          badges={a.state === "adopted" ? <ToneBadge tone="green">{t("adoption.done")}</ToneBadge> : <ToneBadge tone="orange">{t("adoption.notDone")}</ToneBadge>}
        >
          <div className="px-6 py-4">
            {a.state === "adopted" ? (
              <KeyPoints
                label={t("adoption.adopted", { time: fmtDateTime(a.at, lang), tasks: a.tasks, comments: a.comments, activity: a.activity })}
                items={[
                  { icon: <Clock />, text: fmtDateTime(a.at, lang) },
                  { icon: <ListBullet />, text: t("adoption.tasks", { count: a.tasks }) },
                  { icon: <ChatBubble />, text: t("adoption.comments", { count: a.comments }) },
                  { icon: <History />, text: t("adoption.activity", { count: a.activity }) },
                  { icon: <LockClosedSolid />, text: t("adoption.untouched"), tone: "green" },
                ]}
              />
            ) : (
              <InlineTip variant="warning" label={t("adoption.title")}>
                {t("adoption.skipped", { reason: a.reason ?? "" })}
              </InlineTip>
            )}
          </div>
        </Section>
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
    <Section
      id="tasks-sandbox"
      icon={<Beaker />}
      title={t("sandboxTab.title")}
      badges={s.enabled ? <ToneBadge tone="blue">{t("sandboxTab.on")}</ToneBadge> : <ToneBadge>{t("sandboxTab.offBadge")}</ToneBadge>}
      pointsLabel={t("sandboxTab.subtitle")}
      points={[
        { icon: <Users />, text: t("sandboxTab.points.accounts") },
        { icon: <LockClosedSolid />, text: t("sandboxTab.points.isolated"), tone: "green" },
        { icon: <ArrowUturnLeft />, text: t("sandboxTab.points.reset") },
      ]}
      actions={
        s.enabled ? (
          <Button size="small" variant="secondary" isLoading={reset.pending} onClick={() => void reset.run()}>
            <ArrowUturnLeft />
            {t("actions.resetSandbox")}
          </Button>
        ) : null
      }
    >
      {s.enabled ? (
        <>
          <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
            <Fact label={t("sandboxTab.accounts")}>{list(status.options.sandbox_accounts, status.options.sandbox_account_count, labels)}</Fact>
            <Fact label={t("sandboxTab.seeded")}>{s.seeded_at ? fmtDateTime(s.seeded_at, lang) : t("sandboxTab.never")}</Fact>
            <Fact label={t("sandboxTab.tasks")}>{fmtNumber(s.tasks, lang)}</Fact>
            <Fact label={t("sandboxTab.next")}>
              {s.next_reset_at ? t("sandboxTab.onOpen", { time: fmtDateTime(s.next_reset_at, lang) }) : t("general.onlyReset")}
            </Fact>
            <Fact label={t("sandboxTab.guard")}>
              {status.options.sandbox_guard ? (
                <ToneBadge tone="green" icon={<CheckCircle />}>
                  {t("sandboxTab.guardOn")}
                </ToneBadge>
              ) : (
                <ToneBadge tone="orange">{t("sandboxTab.guardOff")}</ToneBadge>
              )}
            </Fact>
          </div>
          {!status.options.sandbox_guard && !status.sandbox ? (
            <div className="px-6 py-4">
              <InlineTip variant="warning" label={t("sandboxTab.guard")}>
                {t("sandboxTab.guardWarning")}
              </InlineTip>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={<Beaker />}
          title={t("sandboxTab.off")}
          points={[{ icon: <CogSixTooth />, text: t("sandboxTab.offHow") }]}
        />
      )}
    </Section>
  )
}
