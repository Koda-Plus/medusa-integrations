import { useTranslation } from "react-i18next"
import { Beaker, BuildingStorefront, CheckCircle, ExclamationCircle, Eye, Key, LockClosedSolid, ShieldCheck, User } from "@medusajs/icons"
import { InlineTip, Switch, Text, toast } from "@medusajs/ui"
import { DPDSERVICES_HOSTS } from "../../modules/dpd/lib/constants"
import type { SecretState, StatusResponse, WriterDto, WriterKey } from "../../modules/dpd/lib/contract"
import { WRITERS, WRITER_OPTION } from "../../modules/dpd/lib/writers"
import { errorMessage, useDpdWriter } from "./dpd-api"
import { EmptyState, Section, ToneBadge } from "./dpd-blocks"
import { nb } from "./dpd-guide"
import { isLaterWriter } from "./dpd-logic"
import { Fact, fmtDateTime, modeOf, useSenderProblemText } from "./dpd-ui"

/** The tabs of Settings, in the URL as `?view=settings&tab=`. */
export const SETTINGS_TABS = ["account", "sender", "writers"] as const
export type SettingsTabId = (typeof SETTINGS_TABS)[number]

/** Set or missing, never the value: the admin learns nothing more of a secret. */
function Secret({ state }: { state: SecretState }) {
  const { t } = useTranslation("dpd")
  return state === "set" ? <ToneBadge tone="green">{t("account.set")}</ToneBadge> : <ToneBadge>{t("account.notSet")}</ToneBadge>
}

/* ------------------------------------------------------------------ */
/* The DPD account: mode, credentials, what the options say            */
/* ------------------------------------------------------------------ */

export function AccountSection({ status: s }: { status: StatusResponse }) {
  const { t } = useTranslation("dpd")
  const demo = s.mode === "demo"
  const mode = modeOf(s)
  const o = s.options
  const host = s.mode === "demo" ? null : DPDSERVICES_HOSTS[s.mode].replace(/^https:\/\//, "")
  const cod = Object.entries(o.codCountries).map(([country, currencies]) => `${country} (${currencies.join(", ")})`)

  return (
    <div className="flex flex-col gap-y-3">
      <Section
        icon={<Key />}
        title={t("account.title")}
        pointsLabel={demo ? t("account.demoNote") : t("account.subtitle")}
        points={[
          demo && { icon: <Beaker />, text: t("account.points.demo"), tone: "blue" },
          { icon: <LockClosedSolid />, text: t("account.points.env"), tone: "green" },
          { icon: <Eye />, text: t("account.points.masked") },
        ]}
      >
        {!demo && s.missing.length > 0 ? (
          <div className="px-6 py-4">
            <InlineTip variant="warning" label={t("missing.label")}>
              {t("missing.text", { missing: s.missing.join(", ") })}
            </InlineTip>
          </div>
        ) : null}
        {s.optionProblems.length > 0 ? (
          <div className="flex flex-col gap-y-2 px-6 py-4">
            <Text size="small" weight="plus" className="flex items-center gap-x-1.5">
              <ExclamationCircle className="text-ui-tag-orange-icon" />
              {t("account.optionProblems")}
            </Text>
            <ul className="flex flex-col gap-y-1">
              {s.optionProblems.map((p) => (
                <li key={p} className="txt-small font-mono text-ui-fg-subtle">
                  {nb(p)}
                </li>
              ))}
            </ul>
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("account.optionProblemsHint")}
            </Text>
          </div>
        ) : null}
        {/* Live without MyPudo credentials: every Pickup point passes the checkout unchecked. Not an option problem (a store without Pickup needs none). */}
        {o.pickupCheck === "not_configured" ? (
          <div className="px-6 py-4">
            <InlineTip variant="warning" label={t("account.services")}>
              {t("account.pickupNotConfigured")}
            </InlineTip>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label={t("account.mode")}>
            <ToneBadge tone={mode.tone}>{t(`mode.${mode.key}`)}</ToneBadge>
          </Fact>
          <Fact label={t("account.connection")}>
            {demo ? t("account.connectionDemo") : s.configured ? t("account.connectionReady") : <span className="text-ui-tag-orange-text">{t("account.connectionMissing")}</span>}
          </Fact>
          <Fact label={t("account.host")} mono>
            {host ?? "-"}
          </Fact>
          <Fact label={t("account.version")} mono>
            {s.version}
          </Fact>
        </div>
        <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label={t("account.login")}>
            <Secret state={o.credentials.login} />
          </Fact>
          <Fact label={t("account.password")}>
            <Secret state={o.credentials.password} />
          </Fact>
          <Fact label={t("account.masterFid")} mono>
            {o.masterFid ?? <span className="font-sans text-ui-fg-muted">{t("account.notSet")}</span>}
          </Fact>
          <Fact label={t("account.payerFid")} mono>
            {o.payerFid ?? <span className="font-sans text-ui-fg-muted">{t("account.notSet")}</span>}
          </Fact>
        </div>
      </Section>

      <Section
        icon={<CheckCircle />}
        title={t("account.services")}
        pointsLabel={t("account.servicesSubtitle")}
        points={[{ icon: <Eye />, text: t("account.points.later") }]}
      >
        <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label={t("account.infoLogin")}>
            <Secret state={o.credentials.infoLogin} />
          </Fact>
          <Fact label={t("account.infoPassword")}>
            <Secret state={o.credentials.infoPassword} />
          </Fact>
          <Fact label={t("account.infoChannel")}>
            <Secret state={o.credentials.infoChannel} />
          </Fact>
          <Fact label={t("account.trackingMode")}>{t(`account.tracking.${o.trackingMode}`)}</Fact>
          <Fact label={t("account.pickupLogin")}>
            <Secret state={o.credentials.pickupLogin} />
          </Fact>
          <Fact label={t("account.pickupPassword")}>
            <Secret state={o.credentials.pickupPassword} />
          </Fact>
          <Fact label={t("account.pickupApiKey")}>
            <Secret state={o.credentials.pickupApiKey} />
          </Fact>
        </div>
      </Section>

      <Section icon={<ShieldCheck />} title={t("account.shipping")} pointsLabel={t("account.shippingSubtitle")} points={[{ icon: <LockClosedSolid />, text: t("account.points.env"), tone: "green" }]}>
        <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label={t("account.labelPage")}>
            {t(`account.labelPages.${s.settings.labelPage}`)}
            <span className="block text-ui-fg-muted txt-compact-xsmall">{t(`account.source.${s.settings.source.labelPage}`)}</span>
          </Fact>
          <Fact label={t("account.countries")}>{t("account.countriesCount", { count: o.countries.length })}</Fact>
          <Fact label={t("account.cod")}>{cod.length > 0 ? cod.join("; ") : t("account.none")}</Fact>
          <Fact label={t("account.codProviders")} mono>
            {o.codPaymentProviders.length > 0 ? o.codPaymentProviders.join(", ") : "-"}
          </Fact>
          <Fact label={t("account.weightUnit")}>{t(`account.units.${o.weightUnit}`)}</Fact>
          <Fact label={t("account.defaultBox")}>
            {o.defaultBox ? t("account.box", { weight: o.defaultBox.weightKg }) : t("account.none")}
          </Fact>
          <Fact label={t("account.retention")}>{t("account.days", { count: o.documentRetentionDays })}</Fact>
          <Fact label={t("account.internationalReturns")}>{o.internationalReturns ? t("account.on") : t("account.off")}</Fact>
        </div>
      </Section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The sender and the orderer, from the options                         */
/* ------------------------------------------------------------------ */

export function SenderSection({ status: s }: { status: StatusResponse }) {
  const { t } = useTranslation("dpd")
  const text = useSenderProblemText()
  const demo = s.mode === "demo"
  const problems = s.senderProblems
  return (
    <Section
      icon={<BuildingStorefront />}
      title={t("sender.title")}
      badges={problems.length > 0 ? <ToneBadge tone="orange">{t("sender.problemsBadge", { count: problems.length })}</ToneBadge> : <ToneBadge tone="green">{t("sender.ok")}</ToneBadge>}
      pointsLabel={t("sender.subtitle")}
      points={[
        demo && { icon: <Beaker />, text: t("sender.points.demo"), tone: "blue" },
        { icon: <LockClosedSolid />, text: t("account.points.env"), tone: "green" },
        { icon: <BuildingStorefront />, text: t("sender.points.locations") },
      ]}
    >
      {problems.length === 0 ? (
        <EmptyState compact icon={<CheckCircle />} title={demo ? t("sender.okDemo") : t("sender.okText")} />
      ) : (
        <ul className="flex flex-col gap-y-2 px-6 py-4">
          {problems.map((p, i) => (
            <li key={`${p.path}-${p.code}-${i}`} className="flex gap-x-2">
              <ExclamationCircle className="mt-0.5 shrink-0 text-ui-tag-orange-icon" />
              <span className="flex flex-col">
                <Text size="small" className="text-ui-fg-base">
                  {text(p)}
                </Text>
                <Text size="xsmall" className="font-mono text-ui-fg-muted">
                  {p.path}
                </Text>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("sender.hint")}
        </Text>
        {s.options.senderLocations.length > 0 ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("sender.locations", { list: s.options.senderLocations.join(", ") })}
          </Text>
        ) : null}
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Writers                                                             */
/* ------------------------------------------------------------------ */

function WriterRow({ writer, lang, busy, onFlip }: { writer: WriterDto; lang: string; busy: boolean; onFlip: (armed: boolean) => void }) {
  const { t } = useTranslation("dpd")
  /* Still armed here while the options turn it off: it does not write, and the switch stays to disarm it
     (the server always allows that), so it cannot come back armed when the option returns. */
  const stale = writer.on && !writer.allowed
  const badge = writer.armed ? t("writers.armed") : stale ? t("writers.armedBlocked") : writer.allowed ? t("writers.disarmed") : t("writers.blocked")
  return (
    <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
      <div className="flex max-w-3xl flex-col gap-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {t(`writers.names.${writer.key}`)}
          </Text>
          <ToneBadge tone={writer.armed || stale ? "orange" : "grey"}>{badge}</ToneBadge>
        </span>
        <Text size="small" className="text-ui-fg-subtle">
          {t(`writers.descriptions.${writer.key}`)}
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          {stale
            ? t("writers.armedBlockedHint", { option: `${WRITER_OPTION[writer.key]}: true` })
            : !writer.allowed
              ? t("writers.blockedHint", { option: `${WRITER_OPTION[writer.key]}: true` })
              : writer.updatedAt
                ? t(writer.on ? "writers.onBy" : "writers.offBy", { who: writer.updatedBy ?? "-", time: fmtDateTime(writer.updatedAt, lang) })
                : t("writers.never")}
        </Text>
        {/* Only the writers this version does not use yet; the shipment writer creates shipments now. */}
        {isLaterWriter(writer.key) ? (
          <Text size="xsmall" className={writer.armed ? "text-ui-tag-orange-text" : "text-ui-fg-muted"}>
            {t("writers.later")}
          </Text>
        ) : null}
      </div>
      {/* Arming needs the option; disarming never does. */}
      <Switch
        checked={writer.on}
        disabled={busy || (!writer.allowed && !writer.on)}
        onCheckedChange={(v) => {
          if (v === true && !writer.allowed) return
          onFlip(v === true)
        }}
        aria-label={t(`writers.names.${writer.key}`)}
      />
    </div>
  )
}

export function WritersSection({ status: s, lang }: { status: StatusResponse; lang: string }) {
  const { t } = useTranslation("dpd")
  const toggle = useDpdWriter()
  const flip = async (writer: WriterKey, armed: boolean) => {
    try {
      await toggle.mutateAsync({ writer, armed })
      toast.success(t(armed ? "toast.armed" : "toast.disarmed", { name: t(`writers.names.${writer}`) }))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <Section
      icon={<ShieldCheck />}
      title={t("writers.title")}
      pointsLabel={s.mode === "demo" ? `${t("writers.subtitle")} ${t("writers.demo")}` : t("writers.subtitle")}
      points={[
        s.mode === "demo" && { icon: <Beaker />, text: t("writers.points.demo"), tone: "blue" },
        { icon: <LockClosedSolid />, text: t("writers.points.off"), tone: "green" },
        { icon: <Key />, text: t("writers.points.two") },
        { icon: <User />, text: t("writers.points.who") },
      ]}
    >
      {WRITERS.map((key) => (
        <WriterRow key={key} writer={s.writers[key]} lang={lang} busy={toggle.isPending && toggle.variables?.writer === key} onFlip={(armed) => void flip(key, armed)} />
      ))}
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <span className="flex flex-wrap items-center gap-2">
          <Text size="small" weight="plus">
            {t("writers.autoTitle")}
          </Text>
          <ToneBadge tone={s.options.autoCreate ? "orange" : "grey"}>{s.options.autoCreate ? t("writers.autoOnBadge") : t("writers.autoOffBadge")}</ToneBadge>
        </span>
        <Text size="xsmall" className="text-ui-fg-muted">
          {s.options.autoCreate ? t("writers.autoOn") : t("writers.autoOff")}
        </Text>
      </div>
    </Section>
  )
}
