import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowUpRightMini } from "@medusajs/icons"
import { Badge, Container, Heading, Text, clx } from "@medusajs/ui"
import type { CheckItemDto, CheckResultDto, MethodKey, StripeChecksResponse } from "../../modules/stripe/lib/contract"
import { ExternalLink, SampleBadge, VerdictBadge, VerdictIcon, fmtAgo, fmtDate, fmtDateTime, fmtMoney } from "./stripe-ui"

/*
 * The health checks on the Panel: one row per check with its verdict, what
 * was found and how to fix it. Problems open their details; passing checks
 * stay on one line.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string

const METHOD_PARAM = /^[a-z_]+(,[a-z_]+)*$/

/** Params as the sentence needs them: method keys become names, dates are formatted, modes translated. */
export function formatParams(t: Translate, params: Record<string, string | number>, lang: string): Record<string, string | number> {
  const out: Record<string, string | number> = { ...params }
  if (typeof params.methods === "string" && METHOD_PARAM.test(params.methods)) {
    out.methods = params.methods
      .split(",")
      .map((m) => t(`methods.${m}`))
      .join(", ")
  }
  if (typeof params.deadline === "string" && params.deadline) out.deadline = fmtDate(params.deadline, lang)
  if (typeof params.state === "string") out.state = t(`checks.state.${params.state}`, { defaultValue: params.state })
  for (const k of ["key", "store", "mode"]) {
    if (params[k] === "live" || params[k] === "test") out[k] = t(`options.keyMode.${params[k]}`)
  }
  if (params.reason === "") out.reason = "?"
  return out
}

export function checkMessage(t: Translate, r: CheckResultDto, lang: string): string {
  if (r.code === "notRead") return t("checks.common.notRead")
  if (r.code === "off") return t("checks.common.off")
  return t(`checks.${r.key}.${r.code}`, formatParams(t, r.params, lang))
}

export function checkHint(t: Translate, r: CheckResultDto, lang: string): string | null {
  if (!r.hint) return null
  const params = formatParams(t, r.params, lang)
  if (r.hint === "permission" || r.hint === "auth") return t(`checks.common.hint.${r.hint}`, params)
  return t(`checks.${r.key}.hint.${r.hint}`, params)
}

const TONE_DOT: Record<NonNullable<CheckItemDto["tone"]>, string> = {
  green: "bg-ui-tag-green-icon",
  orange: "bg-ui-tag-orange-icon",
  red: "bg-ui-tag-red-icon",
  grey: "bg-ui-fg-muted",
  blue: "bg-ui-tag-blue-icon",
}

const METHOD_LIST = /^(blik|p24|card|apple_pay|google_pay|link|other)(,(blik|p24|card|apple_pay|google_pay|link|other))*$/

function ItemLine({ item, lang }: { item: CheckItemDto; lang: string }) {
  const { t } = useTranslation("stripe")
  const label = item.method ? t(`methods.${item.method as MethodKey}`) : (item.label ?? "")
  const state = item.state ? t(`checks.state.${item.state}`, { defaultValue: item.state }) : null
  const note = item.note ? t(`checks.note.${item.note.key}`, item.note.params) : null
  /* A list of method keys (the methods a region lacks) reads as their names; anything else is shown as it is. */
  const methods = item.value && METHOD_LIST.test(item.value)
  const value = methods ? (item.value as string).split(",").map((m) => t(`methods.${m}`)).join(", ") : item.value
  const code = !item.method && /[_/]|^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(label)
  const body = (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className={clx("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[item.tone ?? "grey"])} />
      {item.term ? <span className="txt-compact-small text-ui-fg-subtle">{t(`checks.term.${item.term}`, { defaultValue: item.term })}:</span> : null}
      {label ? <span className={clx("txt-compact-small min-w-0 break-all text-ui-fg-base", code && "font-mono txt-compact-xsmall")}>{label}</span> : null}
      {state ? <span className="txt-compact-xsmall text-ui-fg-subtle">{state}</span> : null}
      {note ? <span className="txt-compact-xsmall text-ui-fg-muted">{note}</span> : null}
      {value ? <span className={clx("txt-compact-xsmall break-all text-ui-fg-muted", !methods && "font-mono")}>{value}</span> : null}
      {item.money ? <span className="txt-compact-small-plus tabular-nums text-ui-fg-base">{fmtMoney(item.money, lang)}</span> : null}
      {item.at ? <span className="txt-compact-xsmall text-ui-fg-muted">{fmtDateTime(item.at, lang)}</span> : null}
      {item.order ? (
        <Link to={`/orders/${item.order.id}`} className="txt-compact-xsmall-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {item.order.displayId ? `#${item.order.displayId}` : item.order.id}
        </Link>
      ) : null}
    </span>
  )
  if (!item.url) return <li className="flex">{body}</li>
  return (
    <li className="flex items-center gap-x-2">
      {body}
      {item.url.startsWith("/") ? (
        <Link to={item.url} className="txt-compact-xsmall-plus inline-flex shrink-0 items-center gap-x-0.5 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {t("health.open")}
          <ArrowUpRightMini />
        </Link>
      ) : (
        <ExternalLink href={item.url} className="txt-compact-xsmall-plus shrink-0">
          {t("actions.openStripe")}
        </ExternalLink>
      )}
    </li>
  )
}

function CheckRow({ result: r, lang }: { result: CheckResultDto; lang: string }) {
  const { t } = useTranslation("stripe")
  const problem = r.verdict === "fail" || r.verdict === "warn" || r.verdict === "unknown"
  const hint = checkHint(t, r, lang)
  const showItems = r.items.length > 0 && (problem || r.verdict === "info" || r.verdict === "pass")
  return (
    <li className="flex gap-x-3 px-6 py-3">
      <VerdictIcon verdict={r.verdict} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {t(`checks.${r.key}.title`)}
          </Text>
          <VerdictBadge verdict={r.verdict} />
        </div>
        <Text size="small" className={problem ? "text-ui-fg-base" : "text-ui-fg-subtle"}>
          {checkMessage(t, r, lang)}
        </Text>
        {r.error ? (
          <Text size="xsmall" className="break-words font-mono text-ui-fg-muted">
            {r.error}
          </Text>
        ) : null}
        {showItems ? <ul className={clx("flex flex-col gap-y-1", !problem && "opacity-90")}>{r.items.map((item, i) => <ItemLine key={`${item.label ?? item.method ?? ""}-${i}`} item={item} lang={lang} />)}</ul> : null}
        {hint ? (
          <div className="flex max-w-3xl flex-col gap-y-1 rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
            <Text size="xsmall" className="text-ui-fg-subtle">
              <span className="font-medium text-ui-fg-base">{t("health.fix")}</span> {hint}
            </Text>
            {r.link ? (
              r.link.kind === "admin" ? (
                <Link to={r.link.url} className="txt-compact-xsmall-plus inline-flex w-fit items-center gap-x-0.5 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                  {t("health.open")}
                  <ArrowUpRightMini />
                </Link>
              ) : (
                <ExternalLink href={r.link.url} className="txt-compact-xsmall-plus w-fit">
                  {r.link.kind === "stripe" ? t("actions.openStripe") : t("health.open")}
                </ExternalLink>
              )
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  )
}

export function HealthSection({ checks, loading, lang }: { checks: StripeChecksResponse | undefined; loading: boolean; lang: string }) {
  const { t } = useTranslation("stripe")
  const s = checks?.summary
  return (
    <Container className="divide-y p-0" id="stripe-health">
      <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Heading level="h2">{t("health.title")}</Heading>
            {checks?.mode === "demo" ? <SampleBadge /> : null}
          </div>
          <Text size="small" className="max-w-3xl text-ui-fg-subtle">
            {t("health.subtitle")}
          </Text>
        </div>
        {s ? (
          <div className="flex shrink-0 flex-col items-start gap-1 md:items-end">
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge size="2xsmall" color="green">
                <span className="tabular-nums">{s.pass}</span>&nbsp;{t("health.verdict.pass")}
              </Badge>
              {s.warn > 0 ? (
                <Badge size="2xsmall" color="orange">
                  <span className="tabular-nums">{s.warn}</span>&nbsp;{t("health.verdict.warn")}
                </Badge>
              ) : null}
              {s.fail > 0 ? (
                <Badge size="2xsmall" color="red">
                  <span className="tabular-nums">{s.fail}</span>&nbsp;{t("health.verdict.fail")}
                </Badge>
              ) : null}
              {s.unknown > 0 ? (
                <Badge size="2xsmall" color="grey">
                  <span className="tabular-nums">{s.unknown}</span>&nbsp;{t("health.verdict.unknown")}
                </Badge>
              ) : null}
            </span>
            {checks?.checkedAt ? (
              <Text size="xsmall" className="text-ui-fg-muted">
                {t("health.checkedAt", { when: fmtAgo(checks.checkedAt, lang) })}
              </Text>
            ) : null}
          </div>
        ) : null}
      </div>
      {loading && !checks ? <div className="px-6 py-6" /> : null}
      {checks ? (
        <ul className="flex flex-col divide-y divide-ui-border-base">
          {checks.results.map((r) => (
            <CheckRow key={r.key} result={r} lang={lang} />
          ))}
        </ul>
      ) : null}
    </Container>
  )
}

/** One line for the page header: the worst verdict and the counts, a click away from the section. */
export function HealthStrip({ checks, onOpen }: { checks: StripeChecksResponse | undefined; onOpen: () => void }) {
  const { t } = useTranslation("stripe")
  if (!checks) return null
  const s = checks.summary
  const allGood = s.fail === 0 && s.warn === 0 && s.unknown === 0
  return (
    <button type="button" onClick={onOpen} className="flex w-fit items-center gap-x-2 rounded-md px-1 py-0.5 text-left outline-none transition-fg hover:bg-ui-bg-base-hover focus-visible:shadow-borders-focus">
      <VerdictIcon verdict={s.worst} />
      <Text size="small" className="text-ui-fg-subtle">
        <span className="font-medium text-ui-fg-base">{t("health.title")}:</span> {allGood ? t("health.allGood") : t("health.summary", { pass: s.pass, warn: s.warn, fail: s.fail })}
      </Text>
    </button>
  )
}
