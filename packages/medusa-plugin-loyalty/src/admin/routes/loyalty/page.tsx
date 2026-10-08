import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Plus, XMark } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Input, Label, Table, Text, toast } from "@medusajs/ui"
import { announce } from "../../lib/loyalty-kit"
import { useAdjust, useCustomerSearch, useLoyaltyStatus, type FoundCustomer } from "../../lib/loyalty-api"
import { LoyaltyIcon } from "../../lib/loyalty-icon"
import { EmptyLine, SampleBadge, StatTile } from "../../lib/loyalty-ui"

/* The host of the koda.integration/1 cards learns about this plugin. */
announce({ ns: "loyalty", name: "Loyalty", adminPath: "/loyalty", Icon: LoyaltyIcon })

/**
 * Loyalty by Koda Plus. One page: the points accounts, the manual
 * adjustment, the reward ladder and the latest transactions.
 */

const LoyaltyPage = () => {
  const { t } = useTranslation("loyalty")
  const status = useLoyaltyStatus()
  const s = status.data
  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-x-3">
            <span className="flex items-center">
              <LoyaltyIcon width={28} height={28} />
            </span>
            <div>
              <div className="flex items-center gap-x-2">
                <Heading>{t("title")}</Heading>
                {s?.demo ? <SampleBadge /> : null}
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                {t("by")} / {t("subtitle", { pointsPerPln: s?.pointsPerPln ?? 1, redeemRate: s?.redeemRate ?? 0.05 })}
              </Text>
            </div>
          </div>
        </div>
      </Container>

      {status.isError ? (
        <Container className="p-0">
          <Text size="small" className="px-6 py-4 text-ui-fg-error">
            {t("error", { message: String(status.error) })}
          </Text>
        </Container>
      ) : null}

      <Container className="p-0">
        <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-4">
          <StatTile label={t("stats.accounts")} value={s?.counts.accounts ?? "-"} />
          <StatTile label={t("stats.points")} value={s?.counts.points_total ?? "-"} tone="blue" />
          <StatTile label={t("stats.redeemed")} value={s?.counts.redeemed_total ?? "-"} tone="purple" />
          <StatTile label={t("stats.ready")} value={s?.counts.ready ?? "-"} tone={(s?.counts.ready ?? 0) > 0 ? "green" : "default"} />
        </div>
      </Container>

      <AdjustCard />

      {s && s.rewards.length > 0 ? (
        <Container className="p-0">
          <div className="flex flex-col gap-1 px-6 py-4">
            <Heading level="h2">{t("rewards.title")}</Heading>
          </div>
          <div className="flex flex-wrap gap-2 px-6 pb-4">
            {s.rewards.map((r, i) => (
              <Badge key={i} size="small" color="purple">
                {r.at} pkt / {r.name.pl}
              </Badge>
            ))}
          </div>
        </Container>
      ) : null}

      <Container className="divide-y p-0">
        <div className="flex flex-col gap-1 px-6 py-4">
          <Heading level="h2">{t("accounts.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("accounts.subtitle")}
          </Text>
        </div>
        {!s || s.accounts.length === 0 ? (
          <EmptyLine>{t("accounts.empty")}</EmptyLine>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{t("accounts.customer")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("accounts.balance")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("accounts.earned")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("accounts.redeemed")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("accounts.tier")}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {s.accounts.map((a) => (
                  <Table.Row key={a.id}>
                    <Table.Cell>
                      <Link to={`/customers/${a.customer_id}`} className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                        {a.customer_name ?? a.customer_email ?? a.customer_id}
                      </Link>
                      {a.demo ? (
                        <span className="ml-2">
                          <SampleBadge />
                        </span>
                      ) : null}
                    </Table.Cell>
                    <Table.Cell className="tabular-nums">{a.balance}</Table.Cell>
                    <Table.Cell className="tabular-nums text-ui-fg-subtle">{a.total_earned}</Table.Cell>
                    <Table.Cell className="tabular-nums text-ui-fg-subtle">{a.total_redeemed}</Table.Cell>
                    <Table.Cell className="tabular-nums text-ui-fg-subtle">x{a.tier_multiplier}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </Container>

      <Container className="divide-y p-0">
        <div className="flex flex-col gap-1 px-6 py-4">
          <Heading level="h2">{t("transactions.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("transactions.subtitle")}
          </Text>
        </div>
        {!s || s.transactions.length === 0 ? (
          <EmptyLine>{t("transactions.empty")}</EmptyLine>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>{t("transactions.when")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("transactions.kind")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("transactions.delta")}</Table.HeaderCell>
                  <Table.HeaderCell>{t("transactions.reason")}</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {s.transactions.map((x) => (
                  <Table.Row key={x.id}>
                    <Table.Cell className="text-ui-fg-subtle">{new Date(x.created_at).toLocaleString()}</Table.Cell>
                    <Table.Cell>
                      <Badge size="2xsmall" color={x.delta >= 0 ? "green" : "purple"}>
                        {t(`kind.${x.kind}`)}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell className={x.delta >= 0 ? "tabular-nums text-ui-tag-green-text" : "tabular-nums text-ui-fg-subtle"}>
                      {x.delta >= 0 ? `+${x.delta}` : x.delta}
                    </Table.Cell>
                    <Table.Cell className="text-ui-fg-subtle">{x.reason ?? "-"}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        )}
      </Container>
    </div>
  )
}

function AdjustCard() {
  const { t } = useTranslation("loyalty")
  const adjust = useAdjust()
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<FoundCustomer | null>(null)
  const [delta, setDelta] = useState("")
  const [reason, setReason] = useState("")
  const search = useCustomerSearch(q, !picked)

  const submit = () => {
    const value = Math.trunc(Number(delta.replace(",", ".")))
    if (!picked || !Number.isFinite(value) || value === 0 || !reason.trim()) return
    adjust.mutate(
      { customer_id: picked.id, delta: value, reason: reason.trim() },
      {
        onSuccess: () => {
          setPicked(null)
          setQ("")
          setDelta("")
          setReason("")
          toast.success(t("toast.saved"))
        },
        onError: (e) => toast.error(t("toast.error", { error: e.message })),
      },
    )
  }

  return (
    <Container className="p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("adjust.title")}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {t("adjust.subtitle")}
        </Text>
      </div>
      <div className="grid grid-cols-1 gap-3 px-6 pb-4 md:grid-cols-4">
        <div>
          <Label size="xsmall">{t("adjust.customer")}</Label>
          {picked ? (
            <div className="flex h-8 items-center justify-between gap-x-2 rounded-md border border-ui-border-base bg-ui-bg-subtle px-3">
              <span className="txt-compact-small truncate text-ui-fg-base">{picked.label}</span>
              <button type="button" onClick={() => setPicked(null)} className="text-ui-fg-muted hover:text-ui-fg-base">
                <XMark />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Input size="small" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("adjust.customerPlaceholder")} />
              {q && (search.data ?? []).length > 0 ? (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-ui-border-base bg-ui-bg-base shadow-elevation-card-rest">
                  {search.data!.map((c) => (
                    <button key={c.id} type="button" onClick={() => { setPicked(c); setQ("") }} className="flex w-full flex-col gap-y-0.5 px-3 py-2 text-left transition-fg hover:bg-ui-bg-base-hover">
                      <span className="txt-compact-small text-ui-fg-base">{c.label}</span>
                      {c.sub ? <span className="txt-compact-xsmall text-ui-fg-muted">{c.sub}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div>
          <Label size="xsmall">{t("adjust.delta")}</Label>
          <Input size="small" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+500 albo -100" />
        </div>
        <div>
          <Label size="xsmall">{t("adjust.reason")}</Label>
          <Input size="small" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("adjust.reasonPlaceholder")} />
        </div>
        <div className="flex items-end">
          <Button size="small" variant="primary" onClick={submit} disabled={adjust.isPending || !picked || !delta.trim() || !reason.trim()}>
            <Plus />
            {t("adjust.save")}
          </Button>
        </div>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "loyalty",
  icon: LoyaltyIcon,
})

export default LoyaltyPage
