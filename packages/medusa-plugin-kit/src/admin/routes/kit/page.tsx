import { defineRouteConfig } from "@medusajs/admin-sdk"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Spinner } from "@medusajs/icons"
import { Badge, Button, Checkbox, Container, Heading, Table, Text, Toaster, toast, clx } from "@medusajs/ui"
import { check, forms, saveSettings, status, subscribers, tags, type KitForm, type KitTag, type Status } from "../../lib/kit-api"
import { KitIcon } from "../../lib/kit-icon"
import { KitGuideView } from "../../lib/kit-guide-view"

/**
 * Kit (formerly ConvertKit): the newsletter of the store on the Kit list.
 * Panel: the connection, the list settings (tags, double opt-in form) and
 * the subscription log. Setup guide: the four steps from the key to the test
 * sign-up.
 */

const KitPage = () => {
  const { t } = useTranslation("kit")
  const [view, setView] = useState<"panel" | "guide">("panel")

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-x-2">
          <span className="flex items-center text-ui-fg-subtle">
            <KitIcon width={22} height={22} />
          </span>
          <Heading level="h1">{t("title")}</Heading>
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("by")}
          </Text>
        </div>
        <div className="flex gap-1 rounded-md border border-ui-border-base p-0.5">
          {(["panel", "guide"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={clx(
                "rounded px-3 py-1.5 text-sm transition-fg",
                view === v ? "bg-ui-bg-base text-ui-fg-base shadow-elevation-card-rest" : "text-ui-fg-subtle hover:bg-ui-bg-base-hover",
              )}
            >
              {t(`view.${v}`)}
            </button>
          ))}
        </div>
      </div>
      {view === "panel" ? <Panel /> : <KitGuideView />}
      <Toaster position="bottom-right" />
    </div>
  )
}

const Panel = () => {
  const { t } = useTranslation("kit")
  const statusQ = useQuery({ queryKey: ["kit", "status"], queryFn: status, refetchInterval: 30_000 })
  const tagsQ = useQuery({ queryKey: ["kit", "tags"], queryFn: tags })
  const formsQ = useQuery({ queryKey: ["kit", "forms"], queryFn: forms })
  const subsQ = useQuery({ queryKey: ["kit", "subscribers"], queryFn: () => subscribers({ take: 25 }) })
  const checkQ = useQuery({ queryKey: ["kit", "check"], queryFn: check, enabled: false })

  const s = statusQ.data
  const tagList = tagsQ.data?.tags ?? []
  const formList = formsQ.data?.forms ?? []
  const tagName = (id: number) => tagList.find((tg) => tg.id === id)?.name ?? `#${id}`

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-6 py-4">
        <Heading level="h2">{t("title")}</Heading>
        {s?.configured ? (
          <Badge size="2xsmall" color="green">
            {t("status.configured")}
          </Badge>
        ) : (
          <Badge size="2xsmall" color="grey">
            {t("mode.off")}
          </Badge>
        )}
      </div>

      {/* Stan */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <Button variant="secondary" size="small" onClick={() => checkQ.refetch()} disabled={checkQ.isFetching}>
          {checkQ.isFetching ? t("check.running") : t("check.run")}
        </Button>
        {checkQ.data?.ok && checkQ.data.account ? (
          <Text size="small" className="text-ui-fg-base">
            {t("check.ok", { name: checkQ.data.account.name ?? checkQ.data.account.primary_email_address ?? "-" })}
            {" · "}
            {t("check.tags", { n: checkQ.data.tags.length })}
            {" · "}
            {t("check.forms", { n: checkQ.data.forms.length })}
          </Text>
        ) : s && !s.configured ? (
          <Text size="small" className="text-ui-fg-subtle">
            {t("status.unconfigured")}
          </Text>
        ) : null}
      </div>

      {/* Liczniki */}
      <div className="grid grid-cols-2 gap-px bg-ui-border-base sm:grid-cols-4">
        {[
          { label: t("stats.subscribed"), value: s?.counts.subscribed ?? "..." },
          { label: t("stats.failed"), value: s?.counts.failed ?? "..." },
          { label: t("stats.week"), value: s?.counts.last_7_days ?? "..." },
          { label: t("stats.account"), value: s?.account ? "Kit" : "-" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-ui-bg-base px-6 py-3">
            <Text size="xsmall" className="text-ui-fg-muted">
              {kpi.label}
            </Text>
            <Text size="large" weight="plus" className="mt-1 tabular-nums text-ui-fg-base">
              {kpi.value}
            </Text>
          </div>
        ))}
      </div>

      {/* Ustawienia listy */}
      <SettingsCard status={s} tagList={tagList} formList={formList} />

      {/* Log zapisow */}
      <div className="px-6 py-4">
        <Heading level="h2" className="mb-1">
          {t("subscribers.title")}
        </Heading>
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("subscribers.subtitle")}
        </Text>
        <div className="mt-3">
          {subsQ.isLoading ? (
            <div className="flex items-center gap-2 text-ui-fg-muted">
              <Spinner /> ...
            </div>
          ) : (subsQ.data?.subscribers ?? []).length === 0 ? (
            <Text size="small" className="text-ui-fg-subtle">
              {t("subscribers.empty")}
            </Text>
          ) : (
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{t("subscribers.email")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("subscribers.state")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("subscribers.tags")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("subscribers.when")}</Table.HeaderCell>
                  <Table.HeaderCell></Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(subsQ.data?.subscribers ?? []).map((r) => (
                  <Table.Row key={r.id}>
                    <Table.Cell>{r.email}</Table.Cell>
                    <Table.Cell>
                      {r.state === "active" ? t("subscribers.stateActive") : r.state === "inactive" ? t("subscribers.stateInactive") : r.state ?? t("subscribers.stateNone")}
                    </Table.Cell>
                    <Table.Cell>{(r.tags ?? []).map(tagName).join(", ") || "-"}</Table.Cell>
                    <Table.Cell className="tabular-nums">{new Date(r.created_at).toLocaleString("pl-PL")}</Table.Cell>
                    <Table.Cell>
                      <Badge size="2xsmall" color={r.status === "ok" ? "green" : "red"}>
                        {r.status === "ok" ? t("subscribers.statusOk") : t("subscribers.statusFailed")}
                      </Badge>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </div>
      </div>
    </Container>
  )
}

const SettingsCard = ({
  status,
  tagList,
  formList,
}: {
  status?: Status
  tagList: KitTag[]
  formList: KitForm[]
}) => {
  const { t } = useTranslation("kit")
  const [pickedTags, setPickedTags] = useState<number[] | null>(null)
  const [formId, setFormId] = useState<string | null>(null)
  const [doubleOptIn, setDoubleOptIn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  const effective = {
    tags: pickedTags ?? status?.settings.tags ?? [],
    formId: formId ?? (status?.settings.form_id !== undefined && status?.settings.form_id !== null ? String(status.settings.form_id) : ""),
    doubleOptIn: doubleOptIn ?? status?.settings.double_opt_in ?? false,
  }

  const toggleTag = (id: number) => {
    const current = pickedTags ?? status?.settings.tags ?? []
    setPickedTags(current.includes(id) ? current.filter((x) => x !== id) : [...current, id])
  }

  const save = async () => {
    setBusy(true)
    try {
      await saveSettings({
        tags: pickedTags ?? undefined,
        form_id: formId === null ? undefined : formId === "" ? null : Number(formId),
        double_opt_in: doubleOptIn ?? undefined,
      })
      toast.success(t("settings.saved"))
    } catch (e: any) {
      toast.error(e?.message ?? "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-6 py-4">
      <Heading level="h2" className="mb-1">
        {t("settings.title")}
      </Heading>
      <Text size="xsmall" className="text-ui-fg-muted">
        {t("settings.subtitle")}
      </Text>

      <div className="mt-4 flex flex-col gap-4">
        <div>
          <Text size="small" weight="plus">
            {t("settings.tags")}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("settings.tagsHint")}
          </Text>
          <div className="mt-2 flex flex-wrap gap-2">
            {tagList.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                {t("settings.tagsEmpty")}
              </Text>
            ) : (
              tagList.map((tg) => (
                <button
                  key={tg.id}
                  type="button"
                  onClick={() => toggleTag(tg.id)}
                  className={clx(
                    "flex items-center gap-x-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-fg",
                    effective.tags.includes(tg.id) ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color" : "border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-base-hover",
                  )}
                >
                  <Checkbox checked={effective.tags.includes(tg.id)} />
                  {tg.name}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="max-w-sm">
          <Text size="small" weight="plus">
            {t("settings.form")}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("settings.formHint")}
          </Text>
          <select
            value={effective.formId}
            onChange={(e) => setFormId(e.target.value)}
            className="mt-2 w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 text-sm text-ui-fg-base"
          >
            <option value="">{t("settings.formNone")}</option>
            {formList.map((f) => (
              <option key={f.id} value={String(f.id)}>
                {f.name ?? `#${f.id}`}
              </option>
            ))}
          </select>
        </div>

        <label className="flex max-w-sm items-start gap-x-2">
          <input type="checkbox" className="mt-1" checked={effective.doubleOptIn} onChange={(e) => setDoubleOptIn(e.target.checked)} />
          <span>
            <Text size="small" weight="plus">
              {t("settings.doubleOptIn")}
            </Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("settings.doubleOptInHint")}
            </Text>
          </span>
        </label>

        <div>
          <Button variant="primary" size="small" onClick={save} disabled={busy || !status?.configured}>
            {busy ? t("settings.saving") : t("settings.save")}
          </Button>
        </div>
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Kit",
  icon: KitIcon,
})

export default KitPage
