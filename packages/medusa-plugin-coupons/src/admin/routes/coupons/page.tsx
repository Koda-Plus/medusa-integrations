import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, ArrowUpRightOnBox, BarsArrowDown, Bolt, Calendar, ChartBar, ChatBubbleLeftRight, CheckCircle, Clock, CogSixTooth, CursorArrowRays, ExclamationCircle, ListBullet, PauseSolid, PencilSquare, PlaySolid, Plus, Receipt, Sparkles, SquareTwoStack, Tag, Users, XCircle } from "@medusajs/icons"
import { Button, Container, Drawer, Heading, InlineTip, Table, Text, clx, toast } from "@medusajs/ui"
import type { CouponDto, ListResponse, NameMaps } from "../../../modules/coupons/lib/contract"
import { errorMessage, useCoupon, useCoupons, useSetStatus } from "../../lib/coupons-api"
import { GuideIntro, GuideSteps, HelpButtons, IntegrationHeader, ModeBadge, communityLabels, usePageNav, type GuideStep } from "../../lib/coupons-guide"
import { EmptyState, EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, StatTile, StatTiles, ToneBadge } from "../../lib/coupons-blocks"
import { CouponsIcon } from "../../lib/coupons-icon"
import { KitFetchingBar, KitLoading, KitSkeletonRows, announce } from "../../lib/coupons-kit"
import { couponSentence } from "../../lib/coupons-sentence"
import { StatusBadge, useFormat } from "../../lib/coupons-ui"
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
 * Deep links from the board and the cards: `?status=` (or `?filter=`:
 * active, scheduled, ended, paused, automatic, expiring) and `?q=` (a code).
 */

type Filter = "all" | "active" | "scheduled" | "ended" | "paused" | "automatic" | "expiring"
const FILTERS: Filter[] = ["all", "active", "scheduled", "ended", "paused", "automatic", "expiring"]
/* The filter buttons above the list: the states, then the two that need a look. */
const STATE_FILTERS: Array<{ f: Filter; icon: ReactNode }> = [
  { f: "active", icon: <CheckCircle /> },
  { f: "scheduled", icon: <Calendar /> },
  { f: "paused", icon: <PauseSolid /> },
  { f: "ended", icon: <XCircle /> },
]
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
  const [editing, setEditing] = useState<{ coupon: CouponDto; names: NameMaps; back?: boolean; mode?: "edit" | "copy" } | null>(null)
  const setStatus = useSetStatus()
  const toggle = async (c: CouponDto) => {
    const next = c.medusaStatus === "inactive" || c.medusaStatus === "draft" ? "active" : "inactive"
    try {
      await setStatus.mutateAsync({ id: c.id, status: next })
      toast.success(next === "active" ? t("detail.activatedCode", { code: c.code }) : t("detail.pausedCode", { code: c.code }))
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const asked = params.get("status") ?? params.get("filter") ?? ""
  const filter = (FILTERS as string[]).includes(asked) ? (asked as Filter) : "all"
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
    p.delete("filter")
    if (f === "all") p.delete("status")
    else p.set("status", f)
    setParams(p, { replace: true })
    /* A tile shows what it counts: the list below, scrolled into view. */
    requestAnimationFrame(() => document.getElementById("coupons-list")?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }

  /* A second click on the active filter clears it. */
  const pick = (f: Filter) => setFilter(filter === f ? "all" : f)
  const now = Date.now()
  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>
    for (const f of FILTERS) out[f] = (data?.coupons ?? []).filter((c) => matches(c, f, now)).length
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])
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
          badges={
            <ModeBadge color="green" label={t("mode.live")} title={t("mode.label")}>
              <Text size="small">{t("mode.text")}</Text>
            </ModeBadge>
          }
          description={t("subtitle")}
          points={[
            { icon: <Sparkles />, text: t("points.creator") },
            { icon: <ChatBubbleLeftRight />, text: t("points.sentence") },
            { icon: <ExclamationCircle />, text: t("points.warnings"), tone: "orange" },
            { icon: <ChartBar />, text: t("points.results") },
            { icon: <Users />, text: t("points.customers") },
            { icon: <CheckCircle />, text: t("points.usual"), tone: "green" },
          ]}
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
        <Section
          id="coupons-list"
          icon={<Receipt />}
          title={t("list.title")}
          pointsLabel={t("list.subtitle")}
          points={[
            { icon: <BarsArrowDown />, text: t("list.points.newest") },
            { icon: <CursorArrowRays />, text: t("list.points.orders") },
            { icon: <PauseSolid />, text: t("list.points.pause") },
          ]}
          actions={<SearchInput className="font-mono uppercase" placeholder={t("list.search")} value={q} onChange={setQ} />}
        >
          <FilterBar>
            <FilterButton icon={<ListBullet />} label={t("list.filter.all")} count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
            <FilterDivider />
            {STATE_FILTERS.map(({ f, icon }) => (
              <FilterButton key={f} icon={icon} label={t(`list.filter.${f}`)} count={counts[f]} active={filter === f} onClick={() => pick(f)} />
            ))}
            <FilterDivider />
            <FilterButton icon={<Clock />} label={t("list.filter.expiring")} count={counts.expiring} attention active={filter === "expiring"} onClick={() => pick("expiring")} />
            <FilterButton icon={<Bolt />} label={t("list.filter.automatic")} count={counts.automatic} active={filter === "automatic"} onClick={() => pick("automatic")} />
          </FilterBar>
          <KitFetchingBar active={list.isFetching && !list.isLoading} />
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
                        {c.automatic ? <ToneBadge tone="blue">{t("list.automatic")}</ToneBadge> : null}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-[34rem] whitespace-normal">
                    <Text size="small" className="leading-relaxed">{couponSentence(c, data?.names as NameMaps, t, fmt, currency)}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" className="tabular-nums">
                      {c.automatic && !c.limit ? (
                        <ToneBadge tone="blue" title={t("list.automaticUsesHint")}>
                          {t("list.automaticUses")}
                        </ToneBadge>
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
                    <RowActions
                      actions={[
                        { key: "edit", label: t("edit.title"), icon: <PencilSquare />, onClick: () => setEditing({ coupon: c, names: (data?.names ?? {}) as NameMaps }) },
                        {
                          key: "toggle",
                          label: c.medusaStatus === "active" ? t("detail.pause") : t("detail.activate"),
                          icon: c.medusaStatus === "active" ? <PauseSolid /> : <PlaySolid />,
                          hidden: c.status === "expired",
                          loading: setStatus.isPending && setStatus.variables?.id === c.id,
                          onClick: () => void toggle(c),
                        },
                        { key: "copy", label: t("copy.action"), icon: <SquareTwoStack />, onClick: () => setEditing({ coupon: c, names: (data?.names ?? {}) as NameMaps, mode: "copy" }) },
                        { key: "open", label: t("detail.openInMedusa"), icon: <ArrowUpRightOnBox />, href: `/app/promotions/${c.id}` },
                      ]}
                    />
                  </Table.Cell>
                </Table.Row>
              ))}
              {!list.isLoading && data && shown.length === 0 ? (
                <EmptyTableRow
                  cols={6}
                  icon={<Receipt />}
                  title={data.coupons.length ? t("list.empty") : t("list.emptyAll")}
                  action={
                    data.coupons.length ? (
                      filter !== "all" || q ? (
                        <Button size="small" variant="secondary" onClick={() => (setQ(""), setFilter("all"))}>
                          {t("list.clear")}
                        </Button>
                      ) : null
                    ) : (
                      <Button size="small" variant="secondary" onClick={() => setCreating(true)}>
                        <Plus />
                        {t("actions.create")}
                      </Button>
                    )
                  }
                />
              ) : null}
            </Table.Body>
          </Table>
        </Section>
      ) : null}

      {nav.view === "guide" ? <Guide count={data?.coupons.length ?? 0} /> : null}
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
        onEdit={(coupon, names, mode) => {
          /* One window at a time: the drawer closes, and opens again on the saved coupon. */
          setOpenId(null)
          setEditing({ coupon, names, back: true, mode })
        }}
      />
      <EditCouponModal
        coupon={editing?.coupon ?? null}
        names={editing?.names ?? ((data?.names ?? {}) as NameMaps)}
        currency={currency}
        existing={data?.coupons ?? []}
        memberGroupIds={data?.memberGroupIds ?? []}
        mode={editing?.mode ?? "edit"}
        onOpenChange={(v) => (!v ? setEditing(null) : null)}
        onSaved={(c) => (editing?.back || editing?.mode === "copy" ? setOpenId(c.id) : null)}
        onDuplicate={(c) => setEditing((e) => (e ? { ...e, coupon: c, mode: "copy" } : e))}
      />
    </div>
  )
}

function Tiles({ data, filter, onFilter }: { data: ListResponse; filter: Filter; onFilter: (f: Filter) => void }) {
  const { t } = useTranslation("coupons")
  const fmt = useFormat()
  const x = data.tiles
  return (
    <StatTiles columns={6}>
      <StatTile icon={<ListBullet />} label={t("stats.all")} value={fmt.number(data.coupons.length)} active={filter === "all"} onClick={() => onFilter("all")} />
      <StatTile icon={<CheckCircle />} label={t("stats.active")} value={fmt.number(x.active)} tone="green" active={filter === "active"} onClick={() => onFilter(filter === "active" ? "all" : "active")} />
      <StatTile icon={<Calendar />} label={t("stats.scheduled")} value={fmt.number(x.scheduled)} tone="blue" active={filter === "scheduled"} onClick={() => onFilter(filter === "scheduled" ? "all" : "scheduled")} />
      <StatTile icon={<ChartBar />} label={t("stats.orders30d")} value={fmt.number(x.orders30d)} hint={t("stats.discountHint", { amount: fmt.money(x.discount30d, data.currencyCode) })} />
      <StatTile icon={<Clock />} label={t("stats.expiring")} value={fmt.number(x.expiringSoon)} tone={x.expiringSoon ? "orange" : "grey"} active={filter === "expiring"} onClick={() => onFilter(filter === "expiring" ? "all" : "expiring")} />
      <StatTile icon={<Bolt />} label={t("stats.automatic")} value={fmt.number(x.automaticForEveryone)} tone={x.automaticForEveryone ? "orange" : "grey"} active={filter === "automatic"} onClick={() => onFilter(filter === "automatic" ? "all" : "automatic")} />
    </StatTiles>
  )
}

function CouponDrawer({ id, onClose, currency, onEdit }: { id: string | null; onClose: () => void; currency: string; onEdit: (c: CouponDto, names: NameMaps, mode?: "edit" | "copy") => void }) {
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
              {c.terms?.note ? (
                <InlineTip variant="info" label={t("fields.note")}>
                  {c.terms.note}
                </InlineTip>
              ) : null}
              <StatTiles columns={3} className="px-0 py-0">
                <StatTile label={t("detail.uses")} value={c.automatic && !c.limit ? t("list.automaticUses") : c.limit ? t("detail.usesOf", { used: c.used, limit: c.limit }) : fmt.number(c.used)} />
                <StatTile label={t("detail.orders")} value={fmt.number(c.stats.orders)} />
                <StatTile label={t("detail.discount")} value={fmt.money(c.stats.discount, currency)} />
                <StatTile label={t("detail.revenue")} value={fmt.money(c.stats.revenue, currency)} />
                <StatTile label={t("detail.newCustomers")} value={fmt.number(c.stats.newCustomers)} tone={c.stats.newCustomers ? "green" : "grey"} />
                <StatTile label={t("detail.lastUsed")} value={c.stats.lastUsedAt ? fmt.date(c.stats.lastUsedAt) : t("detail.never")} />
              </StatTiles>
              <div className="flex flex-col gap-y-2">
                <Heading level="h3">{t("detail.ordersTitle")}</Heading>
                {detail.data.orders.length === 0 ? (
                  <EmptyState compact icon={<Receipt />} title={t("detail.noOrders")} className="rounded-md border border-dashed border-ui-border-base" />
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
                            <ToneBadge tone="green">{t("detail.firstOrder")}</ToneBadge>
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
          ) : null}
        </Drawer.Body>
        <Drawer.Footer>
          {c ? (
            <div className="flex w-full items-center justify-between gap-2">
              <Button size="small" variant="secondary" asChild>
                <a href={`/app/promotions/${c.id}`}>
                  <ArrowUpRightOnBox />
                  {t("detail.openInMedusa")}
                </a>
              </Button>
              <div className="flex items-center gap-2">
                <Button size="small" variant="secondary" onClick={() => onEdit(c, detail.data?.names ?? ({} as NameMaps), "copy")}>
                  <SquareTwoStack />
                  {t("copy.action")}
                </Button>
                <Button size="small" variant="secondary" onClick={() => onEdit(c, detail.data?.names ?? ({} as NameMaps))}>
                  <PencilSquare />
                  {t("edit.action")}
                </Button>
                {c.status !== "expired" ? (
                  <Button size="small" variant={c.medusaStatus === "active" ? "secondary" : "primary"} isLoading={setStatus.isPending} onClick={() => void toggle()}>
                    {c.medusaStatus === "active" ? <PauseSolid /> : <PlaySolid />}
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

function Guide({ count }: { count: number }) {
  const { t } = useTranslation("coupons")
  const steps: GuideStep[] = [
    { id: "install", title: t("guide.s1Title"), state: "done", body: null, code: "npm install @koda-plus/medusa-plugin-coupons" },
    { id: "config", title: t("guide.s2Title"), state: "done", body: <p>{t("guide.s2Text")}</p>, code: CONFIG },
    { id: "first", title: t("guide.s3Title"), state: count > 0 ? "done" : "todo", body: <p>{t("guide.s3Text")}</p>, check: t("guide.s3Check") },
    { id: "cart", title: t("guide.s4Title"), state: "optional", body: <p>{t("guide.s4Text")}</p>, check: t("guide.s4Check") },
  ]
  return (
    <>
      <GuideIntro title={t("guide.introTitle")} text={t("guide.introText")} time={t("guide.time")} needs={[t("guide.needs")]} timeLabel={t("guide.timeLabel")} needsLabel={t("guide.needsLabel")} />
      <GuideSteps
        title={t("guide.stepsTitle")}
        steps={steps}
        stateLabels={{ done: t("guide.state.done"), todo: t("guide.state.todo"), optional: t("guide.state.optional"), later: t("guide.state.later") }}
        checkLabel={t("guide.checkLabel")}
        copyLabel={t("guide.copy")}
        copiedLabel={t("guide.copied")}
      />
    </>
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
    <Section
      icon={<CogSixTooth />}
      title={t("options.title")}
      points={[
        { icon: <Tag />, text: t("options.points.config") },
        { icon: <ArrowPath />, text: t("options.points.restart") },
        { icon: <Sparkles />, text: t("options.points.noTables"), tone: "blue" },
      ]}
    >
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
    </Section>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  translationNs: "coupons",
  rank: 3,
  icon: CouponsIcon,
})

export default CouponsPage
