import { useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { ArrowUpRightOnBox, CheckCircleSolid, ChevronDownMini, SquareTwoStack } from "@medusajs/icons"
import { Badge, Container, Heading, Text, clx, toast } from "@medusajs/ui"

/*
 * The guide kit of the Koda Plus integrations: the same components in every
 * package (copied as src/admin/lib/<ns>-guide.tsx, exports prefixed with the
 * namespace), so the five integration pages share one look.
 *
 *   ViewSwitch     "Panel | Setup guide" in the page header, kept in ?view=
 *   References     "Running in production": live stores that use the integration
 *   GuideIntro     what the setup takes: time, what you need, a short overview
 *   GuideSteps     numbered steps with a live state (done / to do / optional)
 *   GuideDiagram   boxes and arrows for how the parts talk to each other
 *   GuideChecklist go-live checklist with ticks from the live status
 *   GuideFaq       troubleshooting, one question per row, opens in place
 *
 * Every string comes in through props, already translated by the page.
 */

/* ------------------------------------------------------------------ */
/* The page view, kept in the URL so a link can open the guide directly */

export type PageView = "panel" | "guide"

export function usePageView(): [PageView, (v: PageView) => void] {
  const [params, setParams] = useSearchParams()
  const view: PageView = params.get("view") === "guide" ? "guide" : "panel"
  const set = (v: PageView) => {
    const next = new URLSearchParams(params)
    if (v === "panel") next.delete("view")
    else next.set("view", v)
    setParams(next, { replace: true })
  }
  return [view, set]
}

export function ViewSwitch({ value, onChange, labels }: { value: PageView; onChange: (v: PageView) => void; labels: Record<PageView, string> }) {
  return (
    <div className="inline-flex rounded-full border border-ui-border-base bg-ui-bg-component p-0.5" role="tablist">
      {(["panel", "guide"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={clx(
            "txt-compact-small-plus rounded-full px-3 py-1 transition-fg",
            value === v ? "bg-ui-bg-interactive text-ui-fg-on-color" : "text-ui-fg-subtle hover:text-ui-fg-base",
          )}
        >
          {labels[v]}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Running in production */

/** One live store, already in the language of the admin (the page picks en or pl from the option). */
export type Reference = {
  name: string
  url: string
  /** The store's own icon (its favicon or logo mark): a data URI or an https URL. Without one the card shows the first letter. */
  icon?: string | null
  description?: string
  since?: string
  metrics?: Array<{ label: string; value: string }>
  /** Pages where the integration can be seen at work, e.g. a product with its Allegro link. */
  links?: Array<{ label: string; url: string }>
}

const host = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function References({ items, title, subtitle, openLabel, sinceLabel }: { items: Reference[]; title: string; subtitle: string; openLabel: string; sinceLabel: (since: string) => string }) {
  if (items.length === 0) return null
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading level="h2">{title}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {subtitle}
        </Text>
      </div>
      <div className="grid grid-cols-1 gap-3 px-6 py-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((r) => (
          <div key={r.url} className="flex flex-col gap-y-3 rounded-lg border border-ui-border-base bg-ui-bg-component px-4 py-3">
            <a href={r.url} target="_blank" rel="noreferrer" className="group flex items-center gap-x-3">
              {r.icon ? (
                <img src={r.icon} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-md bg-white object-contain shadow-borders-base" />
              ) : (
                <span className="txt-compact-medium-plus flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ui-bg-base text-ui-fg-base shadow-borders-base">
                  {r.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="flex min-w-0 flex-col">
                <Text size="small" weight="plus" className="truncate text-ui-fg-base">
                  {r.name}
                </Text>
                <Text size="xsmall" className="truncate text-ui-fg-interactive group-hover:text-ui-fg-interactive-hover">
                  {host(r.url)}
                </Text>
              </span>
              <ArrowUpRightOnBox className="ml-auto shrink-0 text-ui-fg-muted group-hover:text-ui-fg-interactive" />
            </a>
            {r.description ? (
              <Text size="small" className="text-ui-fg-subtle">
                {r.description}
              </Text>
            ) : null}
            {r.metrics?.length || r.since ? (
              <div className="flex flex-wrap items-center gap-2">
                {(r.metrics ?? []).map((m) => (
                  <Badge key={m.label} size="2xsmall" color="green">
                    <span className="tabular-nums">{m.value}</span>&nbsp;{m.label}
                  </Badge>
                ))}
                {r.since ? (
                  <Badge size="2xsmall" color="grey">
                    {sinceLabel(r.since)}
                  </Badge>
                ) : null}
              </div>
            ) : null}
            <div className="mt-auto flex flex-col gap-y-1 border-t border-ui-border-base pt-2">
              {(r.links ?? []).map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="txt-compact-small inline-flex w-fit items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                  {l.label}
                  <ArrowUpRightOnBox className="shrink-0" />
                </a>
              ))}
              <a href={r.url} target="_blank" rel="noreferrer" className="txt-compact-small-plus inline-flex w-fit items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                {openLabel}
                <ArrowUpRightOnBox className="shrink-0" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* Guide */

export function GuideIntro({ title, text, time, needs, needsLabel, timeLabel }: { title: string; text: ReactNode; time: string; needs: string[]; needsLabel: string; timeLabel: string }) {
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Heading level="h2">{title}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {text}
        </Text>
      </div>
      <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-[200px_1fr]">
        <div className="flex flex-col gap-y-1">
          <Text size="xsmall" className="text-ui-fg-muted">
            {timeLabel}
          </Text>
          <Text size="small" weight="plus">
            {time}
          </Text>
        </div>
        <div className="flex flex-col gap-y-2">
          <Text size="xsmall" className="text-ui-fg-muted">
            {needsLabel}
          </Text>
          <div className="flex flex-wrap gap-2">
            {needs.map((n) => (
              <Badge key={n} size="small" color="grey">
                {n}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </Container>
  )
}

export type StepState = "done" | "todo" | "optional" | "later"

export type GuideStep = {
  id: string
  title: string
  state: StepState
  body: ReactNode
  /** Commands, environment variables or options, shown in a copyable block. */
  code?: string
  link?: { label: string; href: string }
  /** What the person should see when the step worked. */
  check?: string
}

const STATE_TONE: Record<StepState, "green" | "orange" | "grey" | "blue"> = { done: "green", todo: "orange", optional: "grey", later: "blue" }

export function CodeBlock({ code, copyLabel, copiedLabel }: { code: string; copyLabel: string; copiedLabel: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-subtle">
      <pre className="txt-compact-small overflow-x-auto px-4 py-3 pr-12 font-mono text-ui-fg-base">{code}</pre>
      <button
        type="button"
        aria-label={copyLabel}
        title={copyLabel}
        className="absolute right-2 top-2 rounded-md p-1.5 text-ui-fg-muted transition-fg hover:bg-ui-bg-component-hover hover:text-ui-fg-base"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => toast.success(copiedLabel))
        }}
      >
        <SquareTwoStack />
      </button>
    </div>
  )
}

export function GuideSteps({
  title,
  subtitle,
  steps,
  stateLabels,
  checkLabel,
  copyLabel,
  copiedLabel,
}: {
  title: string
  subtitle?: string
  steps: GuideStep[]
  stateLabels: Record<StepState, string>
  checkLabel: string
  copyLabel: string
  copiedLabel: string
}) {
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading level="h2">{title}</Heading>
        {subtitle ? (
          <Text size="small" className="text-ui-fg-subtle">
            {subtitle}
          </Text>
        ) : null}
      </div>
      <ol className="flex flex-col px-6 py-5">
        {steps.map((s, i) => {
          const last = i === steps.length - 1
          return (
            <li key={s.id} className="relative flex gap-x-4 pb-6 last:pb-0">
              {!last ? <span aria-hidden className="absolute left-[13px] top-8 bottom-0 w-px bg-ui-border-base" /> : null}
              <span
                className={clx(
                  "txt-compact-small-plus relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
                  s.state === "done" ? "border-ui-tag-green-border bg-ui-tag-green-bg text-ui-tag-green-text" : "border-ui-border-base bg-ui-bg-base text-ui-fg-subtle",
                )}
              >
                {s.state === "done" ? <CheckCircleSolid className="text-ui-tag-green-icon" /> : i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-y-2 pt-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Text size="base" weight="plus" className="text-ui-fg-base">
                    {s.title}
                  </Text>
                  <Badge size="2xsmall" color={STATE_TONE[s.state]}>
                    {stateLabels[s.state]}
                  </Badge>
                </div>
                <div className="txt-small flex max-w-3xl flex-col gap-y-2 text-ui-fg-subtle">{s.body}</div>
                {s.code ? <CodeBlock code={s.code} copyLabel={copyLabel} copiedLabel={copiedLabel} /> : null}
                {s.link ? (
                  <a href={s.link.href} target="_blank" rel="noreferrer" className="txt-compact-small-plus inline-flex w-fit items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                    {s.link.label}
                    <ArrowUpRightOnBox />
                  </a>
                ) : null}
                {s.check ? (
                  <div className="flex max-w-3xl gap-x-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
                    <CheckCircleSolid className="mt-0.5 shrink-0 text-ui-tag-green-icon" />
                    <Text size="small" className="text-ui-fg-subtle">
                      <span className="font-medium text-ui-fg-base">{checkLabel}</span> {s.check}
                    </Text>
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </Container>
  )
}

/* Boxes in a row with arrows between them, wrapping on narrow screens. */
export type DiagramNode = { title: string; caption?: string; accent?: boolean }

export function GuideDiagram({ title, subtitle, nodes, links }: { title: string; subtitle?: string; nodes: DiagramNode[]; links: string[] }) {
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading level="h2">{title}</Heading>
        {subtitle ? (
          <Text size="small" className="text-ui-fg-subtle">
            {subtitle}
          </Text>
        ) : null}
      </div>
      <div className="flex flex-col items-stretch gap-2 px-6 py-5 lg:flex-row lg:items-center">
        {nodes.map((n, i) => (
          <div key={n.title} className="contents">
            <div
              className={clx(
                "flex min-w-0 flex-1 flex-col gap-y-1 rounded-lg border px-4 py-3",
                n.accent ? "border-ui-border-interactive bg-ui-bg-highlight" : "border-ui-border-base bg-ui-bg-component",
              )}
            >
              <Text size="small" weight="plus" className="text-ui-fg-base">
                {n.title}
              </Text>
              {n.caption ? (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {n.caption}
                </Text>
              ) : null}
            </div>
            {i < nodes.length - 1 ? (
              <div className="flex shrink-0 flex-col items-center justify-center px-1 text-center lg:w-28">
                <Text size="xsmall" className="text-ui-fg-muted">
                  {links[i] ?? ""}
                </Text>
                <span aria-hidden className="txt-compact-medium text-ui-fg-muted">
                  <span className="hidden lg:inline">&rarr;</span>
                  <span className="lg:hidden">&darr;</span>
                </span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Container>
  )
}

export function GuideChecklist({ title, subtitle, items }: { title: string; subtitle?: string; items: Array<{ label: string; done: boolean; hint?: string }> }) {
  const done = items.filter((i) => i.done).length
  return (
    <Container className="divide-y p-0">
      <div className="flex items-start justify-between gap-4 px-6 py-4">
        <div className="flex flex-col gap-y-1">
          <Heading level="h2">{title}</Heading>
          {subtitle ? (
            <Text size="small" className="text-ui-fg-subtle">
              {subtitle}
            </Text>
          ) : null}
        </div>
        <Badge size="small" color={done === items.length ? "green" : "orange"}>
          <span className="tabular-nums">
            {done}/{items.length}
          </span>
        </Badge>
      </div>
      <ul className="flex flex-col gap-y-2 px-6 py-4">
        {items.map((i) => (
          <li key={i.label} className="flex gap-x-2">
            <span
              className={clx(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                i.done ? "border-ui-tag-green-border bg-ui-tag-green-bg" : "border-ui-border-base bg-ui-bg-base",
              )}
            >
              {i.done ? <CheckCircleSolid className="h-4 w-4 text-ui-tag-green-icon" /> : null}
            </span>
            <span className="flex flex-col">
              <Text size="small" className={i.done ? "text-ui-fg-base" : "text-ui-fg-subtle"}>
                {i.label}
              </Text>
              {i.hint ? (
                <Text size="xsmall" className="text-ui-fg-muted">
                  {i.hint}
                </Text>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </Container>
  )
}

export function GuideFaq({ title, items }: { title: string; items: Array<{ q: string; a: ReactNode }> }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{title}</Heading>
      </div>
      {items.map((it, i) => (
        <div key={it.q} className="px-6">
          <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 py-3 text-left" aria-expanded={open === i}>
            <Text size="small" weight="plus" className="text-ui-fg-base">
              {it.q}
            </Text>
            <ChevronDownMini className={clx("shrink-0 text-ui-fg-muted transition-transform", open === i && "rotate-180")} />
          </button>
          {open === i ? <div className="txt-small flex max-w-3xl flex-col gap-y-2 pb-4 text-ui-fg-subtle">{it.a}</div> : null}
        </div>
      ))}
    </Container>
  )
}
