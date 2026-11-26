import { useMemo, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ArrowUpTray, CheckCircle, Clock, DocumentText, ExclamationCircle, Eye, FaceSmile, Camera, ListBullet, Plus, ShieldCheck, Sparkles, Trash, User, XMark } from "@medusajs/icons"
import { Button, Container, Heading, IconButton, InlineTip, Input, Label, Select, Table, Text, Textarea, toast } from "@medusajs/ui"
import { KitFetchingBar, KitLoading, KitSkeletonRows, announce } from "../../lib/avatars-kit"
import { HelpButtons, IntegrationHeader, ModeBadge, SettingsView, communityLabels, usePageNav } from "../../lib/avatars-guide"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, Section, StatTile, StatTiles, ToneBadge, type Tone } from "../../lib/avatars-blocks"
import { GuideView, usePromptSpec } from "../../lib/avatars-guide-view"
import {
  errorMessage,
  problemsOf,
  uploadFile,
  useAvatarsStatus,
  useCreateAvatar,
  useCreatePresentation,
  useDeleteAvatar,
  useDeletePresentation,
  useRecordConsent,
  useRevokeConsent,
  useSeedDemo,
} from "../../lib/avatars-api"
import { AvatarsIcon } from "../../lib/avatars-icon"
import { OptionsTab, SETTINGS_TABS, type SettingsTabId } from "../../lib/avatars-ui"
import { LANGS, type PresentationState } from "../../../modules/avatars/lib/constants"
import type { AvatarDto, PresentationDto, StatusResponse } from "../../../modules/avatars/lib/contract"

/* The host of the koda.integration/1 cards learns about this plugin. */
announce({ ns: "avatars", name: "AI Avatars", adminPath: "/avatars", Icon: AvatarsIcon })

/**
 * AI Avatars by Koda Plus. Panel: the counters, the presentations (a lecture
 * or a text that becomes a script, then a video with an avatar) and the
 * avatars with their written consent. Setup guide and the options in use
 * behind the tabs.
 *
 * Deep links: `?filter=` (needs_action, review, failed, running, published,
 * without_consent) and `?new=1` (the new presentation form open).
 */

type Filter = "all" | "needs_action" | "review" | "failed" | "running" | "published" | "without_consent"
const FILTERS: Filter[] = ["all", "needs_action", "review", "failed", "running", "published", "without_consent"]
const RUNNING: PresentationState[] = ["transcribing", "scripting", "rendering"]

function matches(p: PresentationDto, f: Filter): boolean {
  if (f === "running") return RUNNING.includes(p.state)
  if (f === "needs_action") return p.state === "review" || p.state === "failed"
  if (f === "review" || f === "failed" || f === "published") return p.state === f
  return true
}

const STATE_TONE: Record<PresentationState, Tone> = {
  draft: "grey",
  transcribing: "blue",
  scripting: "blue",
  review: "orange",
  approved: "green",
  rendering: "blue",
  ready: "green",
  published: "green",
  failed: "red",
}

const scrollTo = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }))

/** Translated problem codes of a refused write, joined for a toast. */
function useProblemText() {
  const { t } = useTranslation("avatars")
  return (err: unknown) => {
    const codes = problemsOf(err)
    return codes.length ? codes.map((c) => t(`problems.${c}`, { defaultValue: c })).join(", ") : errorMessage(err)
  }
}

const AvatarsPage = () => {
  const { t, i18n } = useTranslation("avatars")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const status = useAvatarsStatus()
  const s = status.data
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)
  const seed = useSeedDemo()

  const [params, setParams] = useSearchParams()
  const filter = (FILTERS as string[]).includes(params.get("filter") ?? "") ? (params.get("filter") as Filter) : "all"
  const setFilter = (f: Filter) => {
    const p = new URLSearchParams(params)
    if (f === "all" || f === filter) p.delete("filter")
    else p.set("filter", f)
    setParams(p, { replace: true })
    scrollTo(f === "without_consent" ? "avatars-people" : "avatars-presentations")
  }
  const adding = params.get("new") === "1"
  const setAdding = (open: boolean) => {
    const p = new URLSearchParams(params)
    if (open) p.set("new", "1")
    else p.delete("new")
    setParams(p, { replace: true })
    if (open) scrollTo("avatars-presentations")
  }

  const onRefresh = async () => {
    const r = await status.refetch()
    if (r.isError) toast.error(t("toast.error", { error: errorMessage(r.error) }))
    else toast.success(t("toast.refreshed"))
  }
  const refresh = { key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, loading: status.isFetching, onClick: () => void onRefresh() }
  const seedAction = {
    key: "seed",
    label: t("actions.seed"),
    icon: <Sparkles />,
    loading: seed.isPending,
    onClick: () =>
      seed.mutate(undefined, {
        onSuccess: (r) => toast.success(r.created ? t("toast.seeded") : t("toast.seededBefore")),
        onError: (e) => toast.error(t("toast.error", { error: e.message })),
      }),
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <IntegrationHeader
          icon={<AvatarsIcon width={28} height={28} />}
          title={t("title")}
          badges={
            s?.demo ? (
              <ModeBadge color="blue" label={t("mode.demo")} title={t("mode.demoTitle")}>
                <Text size="small">{t("mode.demoText")}</Text>
              </ModeBadge>
            ) : null
          }
          description={t("subtitle")}
          points={[
            { icon: <DocumentText />, text: t("points.source") },
            { icon: <ListBullet />, text: t("points.script") },
            { icon: <Camera />, text: t("points.video") },
            { icon: <ShieldCheck />, text: t("points.consent") },
          ]}
          help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
          view={nav.view}
          onView={(v) => nav.go(v)}
          labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("view.settings"), more: t("actions.more") }}
          primary={nav.view === "panel" && s ? { key: "new", label: t("actions.newPresentation"), icon: <Plus />, onClick: () => setAdding(true) } : null}
          actions={nav.view === "panel" ? (s?.demo ? [refresh, seedAction] : [refresh]) : nav.view === "settings" ? [refresh] : []}
        />
        <KitFetchingBar active={status.isFetching && !status.isLoading} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {nav.view !== "guide" && !s && status.isLoading ? <KitLoading label={t("loading")} /> : null}
        {nav.view === "panel" && s ? (
          <StatTiles columns={4}>
            <StatTile label={t("stats.presentations")} value={s.counts.presentations} hint={t("stats.presentationsHint")} icon={<Camera />} active={filter === "all"} onClick={() => setFilter("all")} />
            <StatTile
              label={t("stats.needsAction")}
              value={s.counts.needs_action}
              hint={t("stats.needsActionHint")}
              icon={<ExclamationCircle />}
              tone={s.counts.needs_action > 0 ? "orange" : "grey"}
              active={filter === "needs_action"}
              onClick={() => setFilter("needs_action")}
            />
            <StatTile label={t("stats.published")} value={s.counts.published} hint={t("stats.publishedHint")} icon={<CheckCircle />} tone={s.counts.published > 0 ? "green" : "grey"} active={filter === "published"} onClick={() => setFilter("published")} />
            <StatTile
              label={t("stats.withoutConsent")}
              value={s.counts.without_consent}
              hint={t("stats.withoutConsentHint", { count: s.counts.avatars })}
              icon={<ShieldCheck />}
              tone={s.counts.without_consent > 0 ? "orange" : "grey"}
              active={filter === "without_consent"}
              onClick={() => setFilter("without_consent")}
            />
          </StatTiles>
        ) : null}
      </Container>

      {nav.view === "guide" ? <GuideView status={s} /> : null}

      {nav.view === "settings" && s ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[{ id: "options", label: t("settings.tab.options") }]}
        >
          <OptionsTab status={s} />
        </SettingsView>
      ) : null}

      {nav.view === "panel" && s ? (
        <>
          <PresentationsCard status={s} filter={filter} onFilter={setFilter} loading={status.isLoading} adding={adding} onAdding={setAdding} />
          <AvatarsCard status={s} onlyWithoutConsent={filter === "without_consent"} />
        </>
      ) : null}
    </div>
  )
}

function PresentationsCard({
  status,
  filter,
  onFilter,
  loading,
  adding,
  onAdding,
}: {
  status: StatusResponse
  filter: Filter
  onFilter: (f: Filter) => void
  loading: boolean
  adding: boolean
  onAdding: (open: boolean) => void
}) {
  const { t } = useTranslation("avatars")
  const del = useDeletePresentation()
  const problemText = useProblemText()
  const list = status.presentations
  const rows = useMemo(() => list.filter((p) => matches(p, filter === "without_consent" ? "all" : filter)), [list, filter])
  const count = (f: Filter) => list.filter((p) => matches(p, f)).length
  const avatarName = (id: string | null) => status.avatars.find((a) => a.id === id)?.name ?? null

  const remove = (p: PresentationDto) => {
    if (!window.confirm(t("presentations.confirmDelete", { title: p.title }))) return
    del.mutate(p.id, { onSuccess: () => toast.success(t("toast.deleted")), onError: (e) => toast.error(problemText(e)) })
  }

  return (
    <Section
      id="avatars-presentations"
      icon={<Camera />}
      title={t("presentations.title")}
      points={[
        { icon: <DocumentText />, text: t("presentations.points.source") },
        { icon: <Eye />, text: t("presentations.points.review") },
        { icon: <Clock />, text: t("presentations.points.minutes") },
      ]}
      actions={
        <Button size="small" variant="secondary" onClick={() => onAdding(!adding)}>
          <Plus />
          {t("presentations.new")}
        </Button>
      }
    >
      <FilterBar>
        <FilterButton icon={<ListBullet />} label={t("presentations.filter.all")} count={list.length} active={filter === "all"} onClick={() => onFilter("all")} />
        <FilterDivider />
        <FilterButton icon={<ExclamationCircle />} label={t("presentations.filter.needsAction")} count={count("needs_action")} attention active={filter === "needs_action"} onClick={() => onFilter("needs_action")} />
        <FilterButton icon={<Eye />} label={t("presentations.filter.review")} count={count("review")} attention active={filter === "review"} onClick={() => onFilter("review")} />
        <FilterButton icon={<ExclamationCircle />} label={t("presentations.filter.failed")} count={count("failed")} attention active={filter === "failed"} onClick={() => onFilter("failed")} />
        <FilterDivider />
        <FilterButton icon={<Clock />} label={t("presentations.filter.running")} count={count("running")} active={filter === "running"} onClick={() => onFilter("running")} />
        <FilterButton icon={<CheckCircle />} label={t("presentations.filter.published")} count={count("published")} active={filter === "published"} onClick={() => onFilter("published")} />
      </FilterBar>
      {adding ? <PresentationForm status={status} onDone={() => onAdding(false)} /> : null}
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("presentations.name")}</Table.HeaderCell>
              <Table.HeaderCell>{t("presentations.state")}</Table.HeaderCell>
              <Table.HeaderCell>{t("presentations.avatar")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("presentations.slides")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("presentations.minutes")}</Table.HeaderCell>
              <Table.HeaderCell className="w-px" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {loading && rows.length === 0 ? <KitSkeletonRows cols={6} /> : null}
            {!loading && rows.length === 0 ? <EmptyTableRow cols={6} icon={<Camera />} title={list.length === 0 ? t("presentations.empty") : t("presentations.emptyFilter")} /> : null}
            {rows.map((p) => (
              <Table.Row key={p.id}>
                <Table.Cell>
                  <span className="flex items-center gap-x-2">
                    <Link to={`/avatars/presentations/${encodeURIComponent(p.id)}`} className="txt-compact-small-plus text-ui-fg-base hover:underline">
                      {p.title}
                    </Link>
                    <ToneBadge>{p.lang.toUpperCase()}</ToneBadge>
                    {p.demo ? <ToneBadge tone="blue">{t("mode.demo")}</ToneBadge> : null}
                  </span>
                  {p.error ? (
                    <Text size="xsmall" className="text-ui-fg-error">
                      {p.error}
                    </Text>
                  ) : null}
                </Table.Cell>
                <Table.Cell>
                  <ToneBadge tone={STATE_TONE[p.state]} dot>
                    {t(`state.${p.state}`)}
                  </ToneBadge>
                </Table.Cell>
                <Table.Cell className="txt-compact-small">{avatarName(p.avatar_id) ?? <span className="text-ui-fg-muted">{t("presentations.noAvatar")}</span>}</Table.Cell>
                <Table.Cell className="text-right tabular-nums">{p.slides > 0 ? p.slides : "-"}</Table.Cell>
                <Table.Cell className="text-right tabular-nums">
                  {p.estimated_minutes > 0 ? p.estimated_minutes.toFixed(1) : "-"}
                  <span className="text-ui-fg-muted"> / {p.target_minutes}</span>
                </Table.Cell>
                <Table.Cell className="text-right">
                  <RowActions actions={[{ key: "delete", label: t("presentations.delete"), icon: <Trash />, danger: true, hidden: RUNNING.includes(p.state), onClick: () => remove(p) }]} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

/** A file picker that uploads at once and hands back the URL. */
function FilePick({ label, accept, url, onUrl }: { label: string; accept: string; url: string; onUrl: (url: string) => void }) {
  const { t } = useTranslation("avatars")
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState("")
  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      onUrl(await uploadFile(file))
      setName(file.name)
    } catch (e) {
      toast.error(t("toast.uploadError", { error: errorMessage(e) }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-y-1">
      <Label size="xsmall">{label}</Label>
      <div className="flex items-center gap-x-2">
        <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
        <Button size="small" variant="secondary" type="button" isLoading={busy} onClick={() => ref.current?.click()}>
          <ArrowUpTray />
          {url ? t("form.replaceFile") : t("form.chooseFile")}
        </Button>
        {url ? (
          <ToneBadge tone="green" dot>
            {name || t("form.fileReady")}
          </ToneBadge>
        ) : null}
      </div>
    </div>
  )
}

function FormHead({ icon, title, onClose }: { icon: ReactNode; title: string; onClose: () => void }) {
  const { t } = useTranslation("avatars")
  return (
    <div className="flex items-center justify-between gap-x-2 md:col-span-3">
      <div className="flex min-w-0 items-center gap-x-2 text-ui-fg-subtle">
        {icon}
        <Heading level="h3" className="truncate text-ui-fg-base">
          {title}
        </Heading>
      </div>
      <IconButton size="small" variant="transparent" title={t("form.cancel")} aria-label={t("form.cancel")} onClick={onClose}>
        <XMark />
      </IconButton>
    </div>
  )
}

function PresentationForm({ status, onDone }: { status: StatusResponse; onDone: () => void }) {
  const { t } = useTranslation("avatars")
  const create = useCreatePresentation()
  const problemText = useProblemText()
  const [title, setTitle] = useState("")
  const [lang, setLang] = useState<string>(status.options.defaultLang)
  const [kind, setKind] = useState<"text" | "recording">("recording")
  const [text, setText] = useState("")
  const [fileUrl, setFileUrl] = useState("")
  const [minutes, setMinutes] = useState("12")
  const [avatarId, setAvatarId] = useState("none")

  const submit = () =>
    create.mutate(
      {
        title,
        lang,
        source_kind: kind,
        source_text: kind === "text" ? text : undefined,
        source_file_url: kind === "recording" ? fileUrl : undefined,
        target_minutes: Number(minutes),
        avatar_id: avatarId === "none" ? undefined : avatarId,
      },
      {
        onSuccess: () => {
          toast.success(t("toast.created"))
          onDone()
        },
        onError: (e) => toast.error(problemText(e)),
      },
    )

  return (
    <div className="grid grid-cols-1 gap-3 border-b border-ui-border-base bg-ui-bg-subtle px-6 py-4 md:grid-cols-3">
      <FormHead icon={<Plus />} title={t("presentations.new")} onClose={onDone} />
      <div className="flex flex-col gap-y-1 md:col-span-2">
        <Label size="xsmall">{t("form.title")}</Label>
        <Input size="small" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder={t("form.titlePlaceholder")} />
      </div>
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("form.lang")}</Label>
        <Select size="small" value={lang} onValueChange={setLang}>
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {LANGS.map((l) => (
              <Select.Item key={l} value={l}>
                {t(`lang.${l}`)}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("form.source")}</Label>
        <Select size="small" value={kind} onValueChange={(v) => setKind(v === "text" ? "text" : "recording")}>
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="recording">{t("form.sourceRecording")}</Select.Item>
            <Select.Item value="text">{t("form.sourceText")}</Select.Item>
          </Select.Content>
        </Select>
      </div>
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("form.minutes")}</Label>
        <Input size="small" type="number" min={2} max={25} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </div>
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("form.avatar")}</Label>
        <Select size="small" value={avatarId} onValueChange={setAvatarId}>
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="none">{t("form.avatarLater")}</Select.Item>
            {status.avatars.map((a) => (
              <Select.Item key={a.id} value={a.id}>
                {a.name}
                {a.can_render ? "" : ` (${t("consent.none")})`}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      {kind === "recording" ? (
        <div className="md:col-span-3">
          <FilePick label={t("form.recording")} accept="audio/*,video/*" url={fileUrl} onUrl={setFileUrl} />
        </div>
      ) : (
        <div className="flex flex-col gap-y-1 md:col-span-3">
          <Label size="xsmall">{t("form.text")}</Label>
          <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("form.textPlaceholder")} />
        </div>
      )}
      <div className="flex items-center gap-x-2 md:col-span-3">
        <Button size="small" variant="primary" isLoading={create.isPending} onClick={submit}>
          {t("form.create")}
        </Button>
        <Button size="small" variant="secondary" onClick={onDone}>
          {t("form.cancel")}
        </Button>
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("form.nothingPaid")}
        </Text>
      </div>
    </div>
  )
}

function consentTone(a: AvatarDto): Tone {
  if (a.can_render) return "green"
  return a.consent.state === "revoked" ? "red" : "orange"
}

function AvatarsCard({ status, onlyWithoutConsent }: { status: StatusResponse; onlyWithoutConsent: boolean }) {
  const { t } = useTranslation("avatars")
  const [adding, setAdding] = useState(false)
  const [consentFor, setConsentFor] = useState<string | null>(null)
  const del = useDeleteAvatar()
  const revoke = useRevokeConsent()
  const problemText = useProblemText()
  const rows = onlyWithoutConsent ? status.avatars.filter((a) => !a.can_render) : status.avatars
  const consentAvatar = status.avatars.find((a) => a.id === consentFor) ?? null

  const remove = (a: AvatarDto) => {
    if (!window.confirm(t("avatars.confirmDelete", { name: a.name }))) return
    del.mutate(a.id, { onSuccess: () => toast.success(t("toast.deleted")), onError: (e) => toast.error(problemText(e)) })
  }
  const revokeConsent = (a: AvatarDto) => {
    if (!window.confirm(t("avatars.confirmRevoke", { name: a.name }))) return
    revoke.mutate(a.id, { onSuccess: () => toast.success(t("toast.revoked")), onError: (e) => toast.error(problemText(e)) })
  }

  return (
    <Section
      id="avatars-people"
      icon={<FaceSmile />}
      title={t("avatars.title")}
      points={[
        { icon: <ShieldCheck />, text: t("avatars.points.consent"), tone: status.counts.without_consent > 0 ? "orange" : undefined },
        { icon: <User />, text: t("avatars.points.face") },
        { icon: <DocumentText />, text: t("avatars.points.history") },
      ]}
      actions={
        <Button size="small" variant="secondary" onClick={() => setAdding(!adding)}>
          <Plus />
          {t("avatars.new")}
        </Button>
      }
    >
      {adding ? <AvatarForm defaultVoice={status.options.defaultVoice} onDone={() => setAdding(false)} /> : null}
      {consentAvatar ? <ConsentForm key={consentAvatar.id} avatar={consentAvatar} onDone={() => setConsentFor(null)} /> : null}
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("avatars.name")}</Table.HeaderCell>
              <Table.HeaderCell>{t("avatars.face")}</Table.HeaderCell>
              <Table.HeaderCell>{t("avatars.voice")}</Table.HeaderCell>
              <Table.HeaderCell>{t("avatars.consent")}</Table.HeaderCell>
              <Table.HeaderCell className="w-px" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? <EmptyTableRow cols={5} icon={<FaceSmile />} title={status.avatars.length === 0 ? t("avatars.empty") : t("avatars.allSigned")} /> : null}
            {rows.map((a) => (
              <Table.Row key={a.id}>
                <Table.Cell>
                  <span className="flex items-center gap-x-2">
                    <span className="txt-compact-small-plus text-ui-fg-base">{a.name}</span>
                    {a.demo ? <ToneBadge tone="blue">{t("mode.demo")}</ToneBadge> : null}
                  </span>
                </Table.Cell>
                <Table.Cell className="font-mono txt-compact-xsmall">{a.face_id}</Table.Cell>
                <Table.Cell className="font-mono txt-compact-xsmall">{a.voice}</Table.Cell>
                <Table.Cell>
                  <span className="flex flex-col gap-y-0.5">
                    <ToneBadge tone={consentTone(a)} dot>
                      {a.can_render ? t("consent.signed") : t(`consent.${a.consent.state}`)}
                    </ToneBadge>
                    {a.consent.signed_by ? (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {a.consent.signed_by}
                        {a.consent.signed_at ? `, ${a.consent.signed_at.slice(0, 10)}` : ""}
                      </Text>
                    ) : null}
                  </span>
                </Table.Cell>
                <Table.Cell className="text-right">
                  <RowActions
                    actions={[
                      { key: "consent", label: t("avatars.recordConsent"), icon: <ShieldCheck />, onClick: () => setConsentFor(consentFor === a.id ? null : a.id) },
                      { key: "file", label: t("avatars.openConsent"), icon: <DocumentText />, href: a.consent.file_url ?? undefined, hidden: !a.consent.file_url },
                      { key: "revoke", label: t("avatars.revoke"), icon: <XMark />, danger: true, hidden: a.consent.state !== "signed", onClick: () => revokeConsent(a) },
                      { key: "delete", label: t("avatars.delete"), icon: <Trash />, danger: true, onClick: () => remove(a) },
                    ]}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

function AvatarForm({ defaultVoice, onDone }: { defaultVoice: string; onDone: () => void }) {
  const { t } = useTranslation("avatars")
  const create = useCreateAvatar()
  const problemText = useProblemText()
  const [name, setName] = useState("")
  const [face, setFace] = useState("")
  const [voice, setVoice] = useState(defaultVoice)
  const submit = () =>
    create.mutate(
      { name, face_id: face, voice },
      {
        onSuccess: () => {
          toast.success(t("toast.created"))
          onDone()
        },
        onError: (e) => toast.error(problemText(e)),
      },
    )
  return (
    <div className="grid grid-cols-1 gap-3 border-b border-ui-border-base bg-ui-bg-subtle px-6 py-4 md:grid-cols-3">
      <FormHead icon={<Plus />} title={t("avatars.new")} onClose={onDone} />
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("form.name")}</Label>
        <Input size="small" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </div>
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("form.face")}</Label>
        <Input size="small" className="font-mono" value={face} onChange={(e) => setFace(e.target.value)} placeholder="r1234abcd" maxLength={64} />
      </div>
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("form.voice")}</Label>
        <Input size="small" className="font-mono" value={voice} onChange={(e) => setVoice(e.target.value)} maxLength={64} />
      </div>
      <div className="flex items-center gap-x-2 md:col-span-3">
        <Button size="small" variant="primary" isLoading={create.isPending} onClick={submit}>
          {t("form.create")}
        </Button>
        <Button size="small" variant="secondary" onClick={onDone}>
          {t("form.cancel")}
        </Button>
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("form.consentNext")}
        </Text>
      </div>
    </div>
  )
}

function ConsentForm({ avatar, onDone }: { avatar: AvatarDto; onDone: () => void }) {
  const { t } = useTranslation("avatars")
  const record = useRecordConsent()
  const problemText = useProblemText()
  const [fileUrl, setFileUrl] = useState("")
  const [signedBy, setSignedBy] = useState(avatar.consent.signed_by ?? "")
  const [signedAt, setSignedAt] = useState("")
  const [note, setNote] = useState("")
  const submit = () =>
    record.mutate(
      { avatarId: avatar.id, body: { file_url: fileUrl, signed_by: signedBy, signed_at: signedAt, note: note || undefined } },
      {
        onSuccess: () => {
          toast.success(t("toast.consentSaved"))
          onDone()
        },
        onError: (e) => toast.error(problemText(e)),
      },
    )
  return (
    <div className="grid grid-cols-1 gap-3 border-b border-ui-border-base bg-ui-bg-subtle px-6 py-4 md:grid-cols-3">
      <FormHead icon={<ShieldCheck />} title={t("consent.formTitle", { name: avatar.name })} onClose={onDone} />
      <div className="md:col-span-3">
        <InlineTip variant="info" label={t("consent.tipLabel")}>
          {t("consent.tip")}
        </InlineTip>
      </div>
      <FilePick label={t("consent.file")} accept="application/pdf,image/*" url={fileUrl} onUrl={setFileUrl} />
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("consent.signedBy")}</Label>
        <Input size="small" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} maxLength={120} />
      </div>
      <div className="flex flex-col gap-y-1">
        <Label size="xsmall">{t("consent.signedAt")}</Label>
        <Input size="small" type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} />
      </div>
      <div className="flex flex-col gap-y-1 md:col-span-3">
        <Label size="xsmall">{t("consent.note")}</Label>
        <Input size="small" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={t("consent.notePlaceholder")} />
      </div>
      <div className="flex items-center gap-x-2 md:col-span-3">
        <Button size="small" variant="primary" isLoading={record.isPending} onClick={submit}>
          {t("consent.save")}
        </Button>
        <Button size="small" variant="secondary" onClick={onDone}>
          {t("form.cancel")}
        </Button>
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "avatars",
  icon: AvatarsIcon,
})

export default AvatarsPage
