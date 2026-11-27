import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { ArrowPath, CheckCircle, DocumentText, ExclamationCircle, ListBullet, PlaySolid, Sparkles } from "@medusajs/icons"
import { Button, Container, InlineTip, Input, Label, Select, Text, Textarea, toast } from "@medusajs/ui"
import { KitLoading } from "../../../../lib/avatars-kit"
import { Section, SubpageHeader, ToneBadge, type Tone } from "../../../../lib/avatars-blocks"
import { AvatarsIcon } from "../../../../lib/avatars-icon"
import { RenderCard } from "../../../../lib/avatars-render"
import { errorMessage, issuesOf, previewAudio, problemsOf, useApproveScript, usePresentation, useSaveScript, useStartScript } from "../../../../lib/avatars-api"
import type { PresentationState } from "../../../../../modules/avatars/lib/constants"
import type { PresentationDetailDto } from "../../../../../modules/avatars/lib/contract"
import { parseScript, words, type QuizQuestion, type Script, type ScriptIssue, type Short, type Slide } from "../../../../../modules/avatars/lib/script"

/**
 * One presentation: start the script, then edit it slide by slide, listen
 * to a narration in the avatar's voice, save and approve. The approval is
 * for the exact script on screen (its hash); an edit after it takes it back.
 */

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

const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean)

/**
 * A list edited as lines of text. The text is kept as typed and turned into
 * the list only when the field loses focus, so Enter and spaces work.
 */
function ListField({ value, disabled, rows = 4, onCommit }: { value: string; disabled: boolean; rows?: number; onCommit: (text: string) => void }) {
  const [text, setText] = useState(value)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(value)
  }, [value, focused])
  return (
    <Textarea
      rows={rows}
      disabled={disabled}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false)
        if (text !== value) onCommit(text)
      }}
    />
  )
}
const splitPair = (l: string): [string, string] => {
  const i = l.indexOf("|")
  return i < 0 ? [l.trim(), ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]
}

const PresentationPage = () => {
  const { t } = useTranslation("avatars")
  const { id = "" } = useParams()
  const q = usePresentation(id)
  const p = q.data?.presentation

  return (
    <div className="flex flex-col gap-y-3">
      {q.isError ? (
        <Container className="px-6 py-4">
          <InlineTip variant="error" label={t("title")}>
            {t("error", { message: errorMessage(q.error) })}
          </InlineTip>
        </Container>
      ) : null}
      {!p && q.isLoading ? <KitLoading label={t("loading")} /> : null}
      {p ? <Body key={p.id} p={p} /> : null}
    </div>
  )
}

function useIssueText() {
  const { t } = useTranslation("avatars")
  return (i: ScriptIssue) => `${i.at}: ${t(`issues.${i.code}`, { defaultValue: i.code, value: i.value ?? "" })}`
}

function Body({ p }: { p: PresentationDetailDto }) {
  const { t } = useTranslation("avatars")
  const start = useStartScript()
  const save = useSaveScript()
  const approve = useApproveScript()
  const issueText = useIssueText()
  const stored = useMemo(() => {
    const r = parseScript(p.script)
    return r.ok ? r.script : null
  }, [p.script])
  /* The script the editor started from and its hash: a newer save elsewhere never overwrites an edit in progress. */
  const [base, setBase] = useState<{ script: Script | null; hash: string | null }>({ script: stored, hash: p.script_hash })
  const [draft, setDraft] = useState<Script | null>(stored)
  const [shapeIssues, setShapeIssues] = useState<ScriptIssue[]>([])
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.script)
  const changedElsewhere = base.hash !== p.script_hash
  useEffect(() => {
    if (changedElsewhere && !dirty) {
      setBase({ script: stored, hash: p.script_hash })
      setDraft(stored)
    }
  }, [changedElsewhere, dirty, stored, p.script_hash])
  const reset = () => {
    setBase({ script: stored, hash: p.script_hash })
    setDraft(stored)
    setShapeIssues([])
  }
  const editable = p.state === "review" || p.state === "approved"
  const running = p.state === "transcribing" || p.state === "scripting"

  const problemText = (e: unknown) => {
    const codes = problemsOf(e)
    return codes.length ? codes.map((c) => t(`problems.${c}`, { defaultValue: c })).join(", ") : errorMessage(e)
  }
  const onStart = () => start.mutate(p.id, { onSuccess: () => toast.success(t("detail.started")), onError: (e) => toast.error(problemText(e)) })
  const onSave = () => {
    if (!draft) return
    save.mutate(
      { presentationId: p.id, script: draft, baseHash: base.hash },
      {
        onSuccess: (r) => {
          const saved = parseScript(r.presentation.script)
          const next = saved.ok ? saved.script : draft
          setBase({ script: next, hash: r.presentation.script_hash })
          setDraft(next)
          setShapeIssues([])
          toast.success(r.issues.length ? t("detail.savedWithIssues", { count: r.issues.length }) : t("detail.saved"))
        },
        onError: (e) => {
          setShapeIssues(issuesOf(e))
          toast.error(problemText(e))
        },
      },
    )
  }
  const onApprove = () => {
    if (!p.script_hash || dirty || changedElsewhere) return
    if (!window.confirm(t("detail.confirmApprove", { minutes: p.estimated_minutes.toFixed(1) }))) return
    approve.mutate({ presentationId: p.id, scriptHash: p.script_hash }, { onSuccess: () => toast.success(t("detail.approved")), onError: (e) => toast.error(problemText(e)) })
  }

  const setSlide = (i: number, s: Slide) => draft && setDraft({ ...draft, slides: draft.slides.map((x, j) => (j === i ? s : x)) })
  const setQuiz = (i: number, v: QuizQuestion) => draft && setDraft({ ...draft, quiz: draft.quiz.map((x, j) => (j === i ? v : x)) })
  const setShort = (i: number, v: Short) => draft && setDraft({ ...draft, shorts: draft.shorts.map((x, j) => (j === i ? v : x)) })
  const total = draft ? draft.slides.reduce((a, s) => a + words(s.narration), 0) : 0

  return (
    <>
      <SubpageHeader
        icon={<AvatarsIcon />}
        title={p.title}
        back={{ href: "/app/avatars", label: t("detail.back") }}
        badges={
          <>
            <ToneBadge tone={STATE_TONE[p.state]} dot>
              {t(`state.${p.state}`)}
            </ToneBadge>
            <ToneBadge>{p.lang.toUpperCase()}</ToneBadge>
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("detail.minutes", { estimated: p.estimated_minutes.toFixed(1), target: p.target_minutes })}
            </Text>
          </>
        }
        actions={
          <>
            {p.state === "draft" || (p.state === "failed" && !p.approved) ? (
              <Button size="small" variant="primary" isLoading={start.isPending} onClick={onStart}>
                <Sparkles />
                {p.state === "failed" ? t("detail.retry") : t("detail.start")}
              </Button>
            ) : null}
            {editable ? (
              <>
                <Button size="small" variant="secondary" disabled={!dirty} isLoading={save.isPending} onClick={onSave}>
                  {t("detail.save")}
                </Button>
                <Button size="small" variant="secondary" disabled={!dirty && !changedElsewhere} onClick={reset}>
                  <ArrowPath />
                  {t("detail.discard")}
                </Button>
                <Button size="small" variant="primary" disabled={dirty || changedElsewhere || p.state !== "review"} isLoading={approve.isPending} onClick={onApprove}>
                  <CheckCircle />
                  {t("detail.approve")}
                </Button>
              </>
            ) : null}
            {draft ? (
              <Text size="xsmall" className="text-ui-fg-muted">
                {t("detail.totals", { slides: draft.slides.length, words: total })}
                {dirty ? `, ${t("detail.unsaved")}` : ""}
              </Text>
            ) : null}
          </>
        }
      >
        <div className="flex flex-col gap-y-3 px-6 py-4 empty:hidden">
        {p.error ? (
          <InlineTip variant="error" label={t("detail.errorLabel")}>
            {p.error}
          </InlineTip>
        ) : null}
        {changedElsewhere && dirty ? (
          <InlineTip variant="warning" label={t("detail.changedLabel")}>
            {t("detail.changedElsewhere")}
          </InlineTip>
        ) : null}
        {running ? (
          <InlineTip variant="info" label={t(`state.${p.state}`)}>
            {t("detail.running")}
          </InlineTip>
        ) : null}
        {p.approved && !dirty ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("detail.approvedBy", { at: (p.approved_at ?? "").slice(0, 16).replace("T", " ") })}
          </Text>
        ) : null}
        {[...shapeIssues, ...(dirty ? [] : p.issues)].length ? (
          <InlineTip variant="warning" label={t("detail.issuesLabel")}>
            <ul className="list-disc pl-4">
              {[...shapeIssues, ...(dirty ? [] : p.issues)].slice(0, 30).map((i, k) => (
                <li key={k}>{issueText(i)}</li>
              ))}
            </ul>
          </InlineTip>
        ) : null}
        </div>
      </SubpageHeader>

      <RenderCard p={p} dirty={dirty} />

      {draft ? (
        <>
          <Section icon={<DocumentText />} title={t("detail.slides")}>
            <div className="flex flex-col divide-y">
              <div className="flex flex-col gap-y-1 px-6 py-4">
                <Label size="xsmall">{t("detail.lessonTitle")}</Label>
                <Input size="small" disabled={!editable} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </div>
              {draft.slides.map((s, i) => (
                <SlideEditor key={s.id + i} presentationId={p.id} slide={s} editable={editable} onChange={(v) => setSlide(i, v)} />
              ))}
            </div>
          </Section>
          <Section icon={<ListBullet />} title={t("detail.quiz")}>
            <div className="flex flex-col divide-y">
              {draft.quiz.map((qq, i) => (
                <QuizEditor key={i} n={i + 1} q={qq} editable={editable} onChange={(v) => setQuiz(i, v)} />
              ))}
            </div>
          </Section>
          {draft.shorts.length ? (
            <Section icon={<PlaySolid />} title={t("detail.shorts")}>
              <div className="flex flex-col divide-y">
                {draft.shorts.map((k, i) => (
                  <div key={k.id} className="flex flex-col gap-y-2 px-6 py-4">
                    <Field label={`${k.id}, ${t("detail.fromSlide", { slide: k.slide })}`}>
                      <Input size="small" disabled={!editable} value={k.title} onChange={(e) => setShort(i, { ...k, title: e.target.value })} />
                    </Field>
                    <Narration presentationId={p.id} item={k.id} value={k.narration} editable={editable} onChange={(v) => setShort(i, { ...k, narration: v })} />
                  </div>
                ))}
              </div>
            </Section>
          ) : null}
          {draft.notes.length ? (
            <Section icon={<ExclamationCircle />} title={t("detail.notes")}>
              <ul className="txt-small list-disc px-10 py-4 text-ui-fg-subtle">
                {draft.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      ) : null}

      <SourceCard p={p} />
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-1">
      <Label size="xsmall">{label}</Label>
      {children}
    </div>
  )
}

function Narration({ presentationId, item, value, editable, onChange }: { presentationId: string; item: string; value: string; editable: boolean; onChange: (v: string) => void }) {
  const { t } = useTranslation("avatars")
  const [busy, setBusy] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => () => audio.current?.pause(), [])
  const listen = async () => {
    setBusy(true)
    try {
      const url = await previewAudio(presentationId, item, value)
      audio.current?.pause()
      const a = new Audio(url)
      a.onended = () => URL.revokeObjectURL(url)
      a.onpause = () => URL.revokeObjectURL(url)
      audio.current = a
      await a.play().catch((e: unknown) => {
        URL.revokeObjectURL(url)
        throw e
      })
    } catch (e) {
      toast.error(t(`problems.${errorMessage(e)}`, { defaultValue: errorMessage(e) }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-y-1">
      <div className="flex items-center justify-between gap-x-2">
        <Label size="xsmall">{t("detail.narration", { count: words(value) })}</Label>
        <Button size="small" variant="transparent" isLoading={busy} onClick={() => void listen()}>
          <PlaySolid />
          {t("detail.listen")}
        </Button>
      </div>
      <Textarea rows={5} disabled={!editable} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function SlideEditor({ presentationId, slide: s, editable, onChange }: { presentationId: string; slide: Slide; editable: boolean; onChange: (s: Slide) => void }) {
  const { t } = useTranslation("avatars")
  const set = (patch: Partial<Slide>) => onChange({ ...s, ...patch } as Slide)
  return (
    <div className="grid grid-cols-1 gap-3 px-6 py-4 md:grid-cols-2">
      <div className="flex items-center gap-x-2 md:col-span-2">
        <span className="font-mono txt-compact-small-plus text-ui-fg-base">{s.id}</span>
        <ToneBadge>{t(`layout.${s.layout}`)}</ToneBadge>
      </div>
      <div className="flex flex-col gap-y-3">
        <Field label={t("detail.kicker")}>
          <Input size="small" disabled={!editable} value={s.kicker} onChange={(e) => set({ kicker: e.target.value })} />
        </Field>
        <Field label={t("detail.heading")}>
          <Input size="small" disabled={!editable} value={s.heading} onChange={(e) => set({ heading: e.target.value })} />
        </Field>
        {s.layout === "title" ? (
          <Field label={t("detail.lead")}>
            <Textarea rows={2} disabled={!editable} value={s.lead} onChange={(e) => set({ lead: e.target.value } as Partial<Slide>)} />
          </Field>
        ) : null}
        {s.layout === "question" || s.layout === "cards" ? (
          <Field label={t("detail.quote")}>
            <Input size="small" disabled={!editable} value={s.quote ?? ""} onChange={(e) => set({ quote: e.target.value } as Partial<Slide>)} />
          </Field>
        ) : null}
        {s.layout === "points" ? (
          <Field label={t("detail.points")}>
            <ListField disabled={!editable} value={s.points.join("\n")} onCommit={(v) => set({ points: lines(v) } as Partial<Slide>)} />
          </Field>
        ) : null}
        {s.layout === "cards" ? (
          <Field label={t("detail.cards")}>
            <ListField
              disabled={!editable}
              value={s.cards.map((c) => `${c.title} | ${c.text}`).join("\n")}
              onCommit={(v) => set({ cards: lines(v).map((l) => splitPair(l)).map(([title, text]) => ({ title, text })) } as Partial<Slide>)}
            />
          </Field>
        ) : null}
        {s.layout === "compare" ? (
          <Field label={t("detail.pairs")}>
            <ListField
              disabled={!editable}
              value={s.pairs.map((c) => `${c.before} | ${c.after}`).join("\n")}
              onCommit={(v) => set({ pairs: lines(v).map((l) => splitPair(l)).map(([before, after]) => ({ before, after })) } as Partial<Slide>)}
            />
          </Field>
        ) : null}
        {(s.layout === "question" || s.layout === "compare") ? (
          <Field label={t("detail.note")}>
            <Input size="small" disabled={!editable} value={s.note ?? ""} onChange={(e) => set({ note: e.target.value } as Partial<Slide>)} />
          </Field>
        ) : null}
      </div>
      <div className="flex flex-col gap-y-2">
        <Narration presentationId={presentationId} item={s.id} value={s.narration} editable={editable} onChange={(v) => set({ narration: v })} />
        {s.source ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("detail.source")}: {s.source}
          </Text>
        ) : null}
      </div>
    </div>
  )
}

function QuizEditor({ n, q, editable, onChange }: { n: number; q: QuizQuestion; editable: boolean; onChange: (q: QuizQuestion) => void }) {
  const { t } = useTranslation("avatars")
  return (
    <div className="grid grid-cols-1 gap-3 px-6 py-4 md:grid-cols-2">
      <div className="flex flex-col gap-y-3">
        <Field label={t("detail.question", { n })}>
          <Input size="small" disabled={!editable} value={q.question} onChange={(e) => onChange({ ...q, question: e.target.value })} />
        </Field>
        <Field label={t("detail.answers")}>
          <ListField
            disabled={!editable}
            value={q.answers.join("\n")}
            onCommit={(v) => {
              /* The right answer follows its text when lines move; a removed one is chosen again. */
              const answers = lines(v)
              const kept = answers.indexOf(q.answers[q.correct] ?? "")
              onChange({ ...q, answers, correct: kept >= 0 ? kept : -1 })
            }}
          />
        </Field>
      </div>
      <div className="flex flex-col gap-y-3">
        <Field label={t("detail.correct")}>
          <Select size="small" disabled={!editable} value={q.correct >= 0 ? String(q.correct) : undefined} onValueChange={(v) => onChange({ ...q, correct: Number(v) })}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {q.answers.map((a, i) => (
                <Select.Item key={i} value={String(i)}>
                  {a.slice(0, 80)}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </Field>
        <Field label={t("detail.explanation")}>
          <Textarea rows={2} disabled={!editable} value={q.explanation} onChange={(e) => onChange({ ...q, explanation: e.target.value })} />
        </Field>
      </div>
    </div>
  )
}

function SourceCard({ p }: { p: PresentationDetailDto }) {
  const { t } = useTranslation("avatars")
  const [open, setOpen] = useState(false)
  const text = p.transcript ?? p.source_text
  return (
    <Section icon={<DocumentText />} title={p.transcript ? t("detail.transcript") : t("detail.sourceText")} actions={text ? <Button size="small" variant="transparent" onClick={() => setOpen(!open)}>{open ? t("detail.hide") : t("detail.show")}</Button> : null}>
      <div className="px-6 py-4">
        {p.source_file_url ? (
          <a href={p.source_file_url} target="_blank" rel="noreferrer" className="txt-compact-small text-ui-fg-interactive hover:underline">
            {t("detail.recording")}
          </a>
        ) : null}
        {text ? (
          <Text size="small" className="text-ui-fg-subtle">
            {t("detail.sourceWords", { count: p.source_words })}
          </Text>
        ) : (
          <Text size="small" className="text-ui-fg-muted">
            {t("detail.noText")}
          </Text>
        )}
        {open && text ? <pre className="txt-small mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap font-sans text-ui-fg-base">{text}</pre> : null}
      </div>
    </Section>
  )
}

export default PresentationPage
