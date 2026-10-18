import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ArrowUpRightOnBox, PencilSquare, Plus } from "@medusajs/icons"
import { Badge, Button, Container, Drawer, Heading, InlineTip, Input, Table, Text, clx, toast } from "@medusajs/ui"
import type { CouponDto, ListResponse, NameMaps } from "../../../modules/coupons/lib/contract"
import { errorMessage, useCoupon, useCoupons, useSetStatus } from "../../lib/coupons-api"
import { CodeBlock, HelpButtons, IntegrationHeader, ModeBadge, communityLabels, usePageNav } from "../../lib/coupons-guide"
import { CouponsIcon } from "../../lib/coupons-icon"
import { KitFetchingBar, KitLoading, KitSkeletonRows, announce } from "../../lib/coupons-kit"
import { couponSentence } from "../../lib/coupons-sentence"
import { Segment, StatTile, StatusBadge, useFormat } from "../../lib/coupons-ui"
import { CreateCouponModal } from "../../lib/coupons-wizard"
import { EditCouponModal } from "../../lib/coupons-edit"
import { KIT_META } from "../../lib/coupons-kit-meta"

/* The host of the koda.integration/1 cards learns about this plugin. */
announce({ ns: "coupons", name: "Coupons", adminPath: "/coupons", Icon: CouponsIcon })

/**
 * Coupons by Koda Plus. Panel: the tiles, the list (every promotion in one
 * plain sentence, its uses and what it brought), a coupon's detail with its
 * orders, and the creator. Setup guide and Settings behind the tabs.
 *
 * Deep links from the board and the cards: `?status=` (active, scheduled,
 * ended, paused, automatic, expiring) and `?q=` (a code).
 */

type Filter = "all" | "active" | "scheduled" | "ended" | "paused" | "automatic" | "expiring"
const FILTERS: Filter[] = ["all", "active", "scheduled", "ended", "paused", "automatic", "expiring"]
const WEEK = 7 * 24 * 3600 * 1000

function matches(c: CouponDto, f: Filter, now: number): boolean {
  switch (f) {
    case "active":
      return c.status === "active"
    case "scheduled":
      return c.status === "scheduled"
    case "ended":
      return c.status === "expired" || c.status === "used_up"
    case "paused":
      return c.status === "paused" || c.status === "draft"
    case "automatic":
      return c.automatic && c.status === "active"
    case "expiring":
      return c.status === "active" && Boolean(c.endsAt) && new Date(c.endsAt as string).getTime() <= now + WEEK
    default:
      return true
  }
}

const CouponsPage = () => {
  const { t } = useTranslation("coupons")
  const fmt = useFormat()
  const nav = usePageNav(["options"] as const)
  const [params, setParams] = useSearchParams()
  const list = useCoupons()
  const data = list.data
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  /* The edit form: from a row of the list or from the detail (which knows the names of its own customers). */
  const [editing, setEditing] = useState<{ coupon: CouponDto; names: NameMaps; back?: boolean } | null>(null)
  const filter = (FILTERS as string[]).includes(params.get("status") ?? "") ? (params.get("status") as Filter) : "all"
  const [q, setQ] = useState(params.get("q") ?? "")

  useEffect(() => {
    const p = new URLSearchParams(params)
    if (q) p.set("q", q)
    else p.delete("q")
    if (p.toString() !== params.toString()) setParams(p, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const setFilter = (f: Filter) => {
    const p = new URLSearchParams(params)
    if (f === "all") p.delete("status")
    else p.set("status", f)
    setParams(p, { replace: true })
    /* A tile shows what it counts: the list below, scrolled into view. */
    requestAnimationFrame(() => document.getElementById("coupons-list")?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }

  const now = Date.now()
  const shown = useMemo(() => {
    const term = q.trim().toUpperCase()
    return (data?.coupons ?? []).filter((c) => matches(c, filter, now) && (!term || c.code.toUpperCase().includes(term)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filter, q])

  const currency = data?.currencyCode ?? "pln"
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)
  const promptSpec = {
    service: "Coupons",
    pkg: KIT_META.pkg,
    route: "/app/coupons",
    summary: t("subtitle"),
    needs: [t("guide.needs")],
    config: CONFIG,
    demo: "",
    migrations: false,
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <IntegrationHeader
          icon={<CouponsIcon width={28} height={28} />}
          title={t("title")}
          by={t("by")}
          badges={
            <ModeBadge color="green" label={t("mode.live")} title={t("mode.label")}>
              <Text size="small">{t("mode.text")}</Text>
            </ModeBadge>
          }
          description={t("subtitle")}
          help={<HelpButtons spec={promptSpec} lang={fmt.lang} labels={community} />}
          view={nav.view}
          onView={(v) => nav.go(v)}
          labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("settings.title"), more: t("actions.moreActions") }}
          primary={nav.view === "panel" ? { key: "create", label: t("actions.create"), icon: <Plus />, onClick: () => setCreating(true) } : null}
          actions={
            nav.view === "panel"
              ? [
                  { key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, loading: list.isFetching, onClick: () => void list.refetch() },
                  { key: "promotions", label: t("actions.promotions"), icon: <ArrowUpRightOnBox />, onClick: () => window.location.assign("/app/promotions") },
                ]
              : []
          }
        />
        {nav.view === "panel" && data ? <Tiles data={data} filter={filter} onFilter={setFilter} /> : null}
        {nav.view === "panel" && !data && list.isLoading ? <KitLoading label={t("loading.page")} /> : null}
        {list.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(list.error) })}
            </InlineTip>
          </div>
        ) : null}
      </Container>

      {nav.view === "panel" ? (
        <Container id="coupons-list" className="scroll-mt-4 divide-y p-0">
          <KitFetchingBar active={list.isFetching && !list.isLoading} />
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
            <div>
              <Heading level="h2">{t("list.title")}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {t("list.subtitle")}
              </Text>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Segment value={filter} options={FILTERS.map((f) => ({ value: f, label: t(`list.filter.${f}`) }))} onChange={setFilter} />
              <Input size="small" className="w-40 font-mono uppercase" placeholder={t("list.search")} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("wizard.code")}</Table.HeaderCell>
                <Table.HeaderCell>{t("wizard.summary")}</Table.HeaderCell>
                <Table.HeaderCell>{t("list.uses")}</Table.HeaderCell>
                <Table.HeaderCell className="text-right">{t("list.discount")}</Table.HeaderCell>
                <Table.HeaderCell className="text-right">{t("list.revenue")}</Table.HeaderCell>
                <Table.HeaderCell className="w-px" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {list.isLoading && shown.length === 0 ? <KitSkeletonRows cols={6} /> : null}
              {shown.map((c) => (
                <Table.Row key={c.id} className="cursor-pointer align-top [&_td]:h-auto [&_td]:py-4" onClick={() => setOpenId(c.id)}>
                  <Table.Cell>
                    <div className="flex flex-col gap-y-1.5">
                      <span className="font-mono txt-compact-small-plus">{c.code || t("list.noCode")}</span>
                      <span className="flex items-center gap-1">
                        <StatusBadge status={c.status} />
                        {c.automatic ? (
                          <Badge size="2xsmall" color="blue">
                            {t("list.automatic")}
                          </Badge>
                        ) : null}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-[34rem] whitespace-normal">
                    <Text size="small" className="leading-relaxed">{couponSentence(c, data?.names as NameMaps, t, fmt, currency)}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className="tabular-nums">
                      {c.automatic && !c.limit ? (
                        <span title={t("list.automaticUsesHint")}>
                          <Badge size="2xsmall" color="blue">
                            {t("list.automaticUses")}
                          </Badge>
                        </span>
                      ) : c.limit ? (
                        t("detail.usesOf", { used: c.used, limit: c.limit })
                      ) : (
                        fmt.number(c.used)
                      )}
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{fmt.money(c.stats.discount, currency)}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    <div className="flex flex-col items-end">
                      <span>{fmt.number(c.stats.orders)}</span>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {fmt.money(c.stats.revenue, currency)}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <Button
                      size="small"
                      variant="secondary"
                      title={t("edit.title")}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing({ coupon: c, names: (data?.names ?? {}) as NameMaps })
                      }}
                    >
                      <PencilSquare />
                      {t("edit.action")}
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
              {!list.isLoading && shown.length === 0 ? (
                <Table.Row>
                  <td colSpan={6} className="px-6">
                    <Text size="small" className="py-6 text-center text-ui-fg-subtle">
                      {t("list.empty")}
                    </Text>
                  </td>
                </Table.Row>
              ) : null}
            </Table.Body>
          </Table>
        </Container>
      ) : null}

      {nav.view === "guide" ? <Guide /> : null}
      {nav.view === "settings" && data ? <Settings data={data} /> : null}

      <CreateCouponModal
        open={creating}
        onOpenChange={setCreating}
        existing={data?.coupons ?? []}
        memberGroupIds={data?.memberGroupIds ?? []}
        codePrefix={data?.codePrefix ?? null}
        onCreated={(c) => setOpenId(c.id)}
      />
      <CouponDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        currency={currency}
        onEdit={(coupon, names) => {
          /* One window at a time: the drawer closes, and opens again on the saved coupon. */
          setOpenId(null)
          setEditing({ coupon, names, back: true })
        }}
      />
      <EditCouponModal
        coupon={editing?.coupon ?? null}
        names={editing?.names ?? ((data?.names ?? {}) as NameMaps)}
        currency={currency}
        onOpenChange={(v) => (!v ? setEditing(null) : null)}
        onSaved={(c) => (editing?.back ? setOpenId(c.id) : null)}
      />
    </div>
  )
}

function Tiles({ data, filter, onFilter }: { data: ListResponse; filter: Filter; onFilter: (f: Filter) => void }) {
  const { t } = useTranslation("coupons")
  const fmt = useFormat()
  const x = data.tiles
  return (
    <div className="grid grid-cols-2 gap-3 px-6 py-4 md:grid-cols-3 xl:grid-cols-6">
      <StatTile label={t("stats.all")} value={fmt.number(data.coupons.length)} tone="blue" active={filter === "all"} onClick={() => onFilter("all")} />
      <StatTile label={t("stats.active")} value={fmt.number(x.active)} tone="green" active={filter === "active"} onClick={() => onFilter(filter === "active" ? "all" : "active")} />
      <StatTile label={t("stats.scheduled")} value={fmt.number(x.scheduled)} tone="blue" active={filter === "scheduled"} onClick={() => onFilter(filter === "scheduled" ? "all" : "scheduled")} />
      <StatTile label={t("stats.orders30d")} value={fmt.number(x.orders30d)} hint={t("stats.discountHint", { amount: fmt.money(x.discount30d, data.currencyCode) })} tone="grey" />
      <StatTile label={t("stats.expiring")} value={fmt.number(x.expiringSoon)} tone={x.expiringSoon ? "orange" : "grey"} active={filter === "expiring"} onClick={() => onFilter(filter === "expiring" ? "all" : "expiring")} />
      <StatTile label={t("stats.automatic")} value={fmt.number(x.automaticForEveryone)} tone={x.automaticForEveryone ? "orange" : "grey"} active={filter === "automatic"} onClick={() => onFilter(filter === "automatic" ? "all" : "automatic")} />
    </div>
  )
}

function CouponDrawer({ id, onClose, currency, onEdit }: { id: string | null; onClose: () => void; currency: string; onEdit: (c: CouponDto, names: NameMaps) => void }) {
  const { t } = useTranslation("coupons")
  const fmt = useFormat()
  const detail = useCoupon(id)
  const setStatus = useSetStatus()
  const c = detail.data?.coupon
  const toggle = async () => {
    if (!c) return
    const next = c.medusaStatus === "inactive" || c.medusaStatus === "draft" ? "active" : "inactive"
    try {
      await setStatus.mutateAsync({ id: c.id, status: next })
      toast.success(next === "active" ? t("detail.activated") : t("detail.paused"))
      void detail.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  return (
    <Drawer open={Boolean(id)} onOpenChange={(v) => (!v ? onClose() : null)}>
      <Drawer.Content className="max-w-2xl">
        <Drawer.Header>
          <Drawer.Title className="flex items-center gap-2">
            <span className="font-mono">{c ? c.code || t("list.noCode") : ""}</span>
            {c ? <StatusBadge status={c.status} /> : null}
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-5 overflow-y-auto">
          {!detail.data && detail.isLoading ? <KitLoading label={t("loading.detail")} /> : null}
          {c && detail.data ? (
            <>
              <Text weight="plus">{couponSentence(c, detail.data.names, t, fmt, currency)}</Text>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <StatTile label={t("detail.uses")} value={c.automatic && !c.limit ? t("list.automaticUses") : c.limit ? t("detail.usesOf", { used: c.used, limit: c.limit }) : fmt.number(c.used)} />
                <StatTile label={t("detail.orders")} value={fmt.number(c.stats.orders)} />
                <StatTile label={t("detail.discount")} value={fmt.money(c.stats.discount, currency)} />
                <StatTile label={t("detail.revenue")} value={fmt.money(c.stats.revenue, currency)} />
                <StatTile label={t("detail.newCustomers")} value={fmt.number(c.stats.newCustomers)} />
                <StatTile label={t("detail.lastUsed")} value={c.stats.lastUsedAt ? fmt.date(c.stats.lastUsedAt) : t("detail.never")} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Heading level="h3">{t("detail.ordersTitle")}</Heading>
                {detail.data.orders.length === 0 ? (
                  <Text size="small" className="text-ui-fg-subtle">
                    {t("detail.noOrders")}
                  </Text>
                ) : (
                  <div className="flex flex-col divide-y rounded-md border border-ui-border-base">
                    {detail.data.orders.map((o) => (
                      <a key={o.id} href={`/app/orders/${o.id}`} className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-ui-bg-base-hover">
                        <span className="flex flex-col">
                          <Text size="small" weight="plus">
                            #{o.displayId ?? "?"} <span className="font-normal text-ui-fg-subtle">{fmt.date(o.createdAt)}</span>
                          </Text>
                          <Text size="xsmall" className="text-ui-fg-subtle">
                            {o.customer ?? ""}
                          </Text>
                        </span>
                        <span className="flex items-center gap-2">
                          {o.firstOrder ? (
                            <Badge size="2xsmall" color="green">
                              {t("detail.firstOrder")}
                            </Badge>
                          ) : null}
                          <Text size="small" className="tabular-nums">
                            -{fmt.money(o.discount, o.currency || currency)}
                          </Text>
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">
              ...
            </Text>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          {c ? (
            <div className="flex w-full items-center justify-between gap-2">
              <a href={`/app/promotions/${c.id}`}>
                <Button size="small" variant="secondary">
                  <ArrowUpRightOnBox />
                  {t("detail.openInMedusa")}
                </Button>
              </a>
              <div className="flex items-center gap-2">
                <Button size="small" variant="secondary" onClick={() => onEdit(c, detail.data?.names ?? ({} as NameMaps))}>
                  <PencilSquare />
                  {t("edit.action")}
                </Button>
                {c.status !== "expired" ? (
                  <Button size="small" variant={c.medusaStatus === "active" ? "secondary" : "primary"} isLoading={setStatus.isPending} onClick={() => void toggle()}>
                    {c.medusaStatus === "active" ? t("detail.pause") : t("detail.activate")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

const CONFIG = `module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@koda-plus/medusa-plugin-coupons",
      options: {
        // Everything is optional.
        currencyCode: "pln",
        // Groups with their own prices: the creator warns when an automatic coupon reaches them.
        memberGroupIds: ["cusgroup_..."],
        codePrefix: "SHOP",
      },
    },
  ],
})`

function Guide() {
  const { t } = useTranslation("coupons")
  const steps = [
    { title: t("guide.s1Title"), code: "npm install @koda-plus/medusa-plugin-coupons" },
    { title: t("guide.s2Title"), text: t("guide.s2Text"), code: CONFIG },
    { title: t("guide.s3Title"), text: t("guide.s3Text") },
    { title: t("guide.s4Title"), text: t("guide.s4Text") },
  ]
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <Heading level="h2">{t("guide.introTitle")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("guide.introText")}
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("guide.time")} / {t("guide.needs")}
        </Text>
      </div>
      {steps.map((s, i) => (
        <div key={s.title} className="flex flex-col gap-y-2 px-6 py-4">
          <Text weight="plus">
            {i + 1}. {s.title}
          </Text>
          {s.text ? (
            <Text size="small" className="max-w-3xl text-ui-fg-subtle">
              {s.text}
            </Text>
          ) : null}
          {s.code ? <CodeBlock code={s.code} copyLabel="Copy" copiedLabel="Copied" /> : null}
        </div>
      ))}
    </Container>
  )
}

function Settings({ data }: { data: ListResponse }) {
  const { t } = useTranslation("coupons")
  const fact = (label: string, value: string) => (
    <div className="flex flex-col gap-y-0.5">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <Text size="small" className={clx(value === t("options.none") && "text-ui-fg-subtle")}>
        {value}
      </Text>
    </div>
  )
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{t("options.title")}</Heading>
      </div>
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
        {fact(t("options.currency"), data.currencyCode.toUpperCase())}
        {fact(t("options.memberGroups"), data.memberGroupIds.length ? data.memberGroupIds.join(", ") : t("options.none"))}
        {fact(t("options.codePrefix"), data.codePrefix ?? t("options.none"))}
        {fact(t("options.version"), data.version)}
      </div>
      {data.problems.length ? (
        <div className="px-6 py-4">
          <InlineTip variant="warning" label={t("options.problems")}>
            {data.problems.join("; ")}
          </InlineTip>
        </div>
      ) : null}
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "coupons",
  rank: 3,
  icon: CouponsIcon,
})

export default CouponsPage
