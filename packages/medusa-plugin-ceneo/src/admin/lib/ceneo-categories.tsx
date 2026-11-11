import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowDownTray, ArrowPath, CheckCircle, FolderOpen, Link as LinkIcon, PencilSquare, Trash, TriangleRightMini } from "@medusajs/icons"
import { Button, Drawer, InlineTip, Table, Text, clx, toast } from "@medusajs/ui"
import type { CategoryMapRow, CeneoCategoryDto } from "../../modules/ceneo/lib/contract"
import { errorMessage, useCategoryMap, useCeneoCategorySearch, useSetCategoryMap, useSyncCategories } from "./ceneo-api"
import { EmptyTableRow, FilterBar, FilterButton, RowActions, SearchInput, Section, ToneBadge, useDebouncedValue } from "./ceneo-blocks"
import { KitLoading, KitSkeletonRows } from "./ceneo-kit"

type Filter = "all" | "unmapped" | "mapped"

/* Static classes (Tailwind sees them), one step per tree level. */
const INDENT = ["", "pl-3", "pl-6", "pl-9", "pl-12", "pl-[60px]", "pl-[72px]"]

/** The Ceneo path, the last part strong: the leaf is what the merchant looks for. */
export function CeneoPath({ category, muted = false }: { category: Pick<CeneoCategoryDto, "path" | "active" | "ceneoId">; muted?: boolean }) {
  const { t } = useTranslation("ceneo")
  const parts = category.path.split("/")
  const leaf = parts.pop() ?? category.path
  return (
    <span className={clx("flex min-w-0 flex-wrap items-center gap-x-1 txt-compact-xsmall", muted ? "text-ui-fg-muted" : "text-ui-fg-subtle")}>
      {parts.length > 0 ? <span className="truncate">{parts.join(" / ")} /</span> : null}
      <span className={clx("txt-compact-xsmall-plus", muted ? "text-ui-fg-subtle" : "text-ui-fg-base")}>{leaf}</span>
      <span className="font-mono text-ui-fg-muted">#{category.ceneoId}</span>
      {!category.active ? <ToneBadge tone="red">{t("categories.removed")}</ToneBadge> : null}
    </span>
  )
}

function Picker({ row, onClose }: { row: CategoryMapRow; onClose: () => void }) {
  const { t } = useTranslation("ceneo")
  const [search, setSearch] = useState(row.name)
  const q = useDebouncedValue(search.trim(), 300)
  const results = useCeneoCategorySearch(q)
  const set = useSetCategoryMap()
  const choose = (c: CeneoCategoryDto) =>
    set.mutate(
      { category_id: row.id, ceneo_id: c.ceneoId },
      {
        onSuccess: () => {
          toast.success(t("categories.mapped", { name: row.name, ceneo: c.name }))
          onClose()
        },
        onError: (e) => toast.error(t("toast.error", { error: errorMessage(e) })),
      },
    )
  const list = results.data?.categories ?? []
  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Drawer.Content className="max-w-xl">
        <Drawer.Header>
          <Drawer.Title>{t("categories.pickTitle", { name: row.name })}</Drawer.Title>
          <Drawer.Description>{t("categories.pickSubtitle")}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-3 overflow-y-auto">
          <SearchInput value={search} onChange={setSearch} placeholder={t("categories.searchCeneo")} className="sm:w-full" autoFocus />
          {q.length < 2 ? (
            <Text size="small" className="text-ui-fg-subtle">
              {t("categories.searchHint")}
            </Text>
          ) : results.isLoading ? (
            <KitLoading className="min-h-0 py-4" />
          ) : list.length === 0 ? (
            <Text size="small" className="text-ui-fg-subtle">
              {t("categories.noResults")}
            </Text>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border">
              {list.map((c) => (
                <li key={c.ceneoId}>
                  <button
                    type="button"
                    disabled={set.isPending}
                    onClick={() => choose(c)}
                    className="flex w-full items-center justify-between gap-x-3 px-3 py-2 text-left hover:bg-ui-bg-base-hover disabled:opacity-50"
                  >
                    <CeneoPath category={c} />
                    {c.leaf ? null : <ToneBadge>{t("categories.branch")}</ToneBadge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button size="small" variant="secondary">
              {t("categories.cancel")}
            </Button>
          </Drawer.Close>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/** Medusa categories next to the Ceneo categories they map to; a mapping covers the subtree. */
export function CategoriesSection({ lang }: { lang: string }) {
  const { t } = useTranslation("ceneo")
  const map = useCategoryMap()
  const sync = useSyncCategories()
  const set = useSetCategoryMap()
  const [filter, setFilter] = useState<Filter>("all")
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<CategoryMapRow | null>(null)
  const q = useDebouncedValue(search.trim().toLowerCase(), 200)
  const rows = map.data?.categories ?? []
  const stats = map.data?.stats
  const names = useMemo(() => new Map(rows.map((r) => [r.id, r.name])), [rows])
  const unmapped = rows.filter((r) => !r.effective).length
  const visible = rows.filter((r) => (filter === "unmapped" ? !r.effective : filter === "mapped" ? Boolean(r.effective) : true) && (!q || r.path.toLowerCase().includes(q)))

  const onSync = () =>
    sync.mutate(undefined, {
      onSuccess: (r) => {
        if (r.status === "synced") toast.success(t("categories.synced", { count: r.categories, created: r.created, removed: r.removed }))
        else if (r.status === "failed") toast.error(t("categories.syncFailed", { error: r.error }))
        else toast.info(t("categories.syncRunning"))
      },
      onError: (e) => toast.error(t("toast.error", { error: errorMessage(e) })),
    })
  const onRemove = (r: CategoryMapRow) =>
    set.mutate(
      { category_id: r.id, ceneo_id: null },
      { onSuccess: () => toast.success(t("categories.unmapped", { name: r.name })), onError: (e) => toast.error(t("toast.error", { error: errorMessage(e) })) },
    )

  const treeEmpty = stats ? stats.tree === 0 : false
  return (
    <Section
      id="ceneo-categories"
      icon={<FolderOpen />}
      title={t("categories.title")}
      badges={unmapped > 0 && rows.length > 0 ? <ToneBadge tone="orange" dot>{t("categories.unmappedCount", { count: unmapped })}</ToneBadge> : null}
      points={[
        { icon: <LinkIcon />, text: t("categories.points.subtree") },
        { icon: <ArrowDownTray />, text: stats?.syncedAt ? t("categories.points.synced", { date: new Date(stats.syncedAt).toLocaleDateString(lang), count: stats.tree }) : t("categories.points.never") },
      ]}
      actions={
        <Button size="small" variant="secondary" onClick={onSync} isLoading={sync.isPending}>
          <ArrowPath />
          {t("categories.sync")}
        </Button>
      }
    >
      {treeEmpty ? (
        <div className="px-6 py-4">
          <InlineTip variant="info" label={t("categories.title")}>
            {t("categories.treeEmpty")}
          </InlineTip>
        </div>
      ) : null}
      <FilterBar>
        <FilterButton icon={<FolderOpen />} label={t("categories.filter.all")} count={rows.length} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterButton icon={<TriangleRightMini />} label={t("categories.filter.unmapped")} count={unmapped} attention active={filter === "unmapped"} onClick={() => setFilter(filter === "unmapped" ? "all" : "unmapped")} />
        <FilterButton icon={<CheckCircle />} label={t("categories.filter.mapped")} count={rows.length - unmapped} active={filter === "mapped"} onClick={() => setFilter(filter === "mapped" ? "all" : "mapped")} />
        <SearchInput value={search} onChange={setSearch} placeholder={t("categories.search")} />
      </FilterBar>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>{t("categories.col.medusa")}</Table.HeaderCell>
            <Table.HeaderCell>{t("categories.col.ceneo")}</Table.HeaderCell>
            <Table.HeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {map.isLoading ? (
            <KitSkeletonRows cols={3} rows={4} />
          ) : visible.length === 0 ? (
            <EmptyTableRow cols={3} compact icon={<FolderOpen />} title={t(rows.length === 0 ? "categories.emptyMedusa" : "categories.emptyFilter")} />
          ) : (
            visible.map((r) => (
              <Table.Row key={r.id} className="[&_td]:py-2.5 [&_td]:align-top">
                <Table.Cell className="max-w-[320px]">
                  <div className={clx("flex min-w-0 flex-col gap-y-0.5", INDENT[Math.min(r.depth, INDENT.length - 1)])}>
                    <span className="txt-compact-small-plus truncate text-ui-fg-base" title={r.path}>
                      {r.name}
                    </span>
                    {r.hidden ? <ToneBadge>{t("categories.hidden")}</ToneBadge> : null}
                  </div>
                </Table.Cell>
                <Table.Cell className="max-w-[420px]">
                  {r.own ? (
                    <CeneoPath category={r.own} />
                  ) : r.effective?.ceneo ? (
                    <div className="flex flex-col gap-y-0.5">
                      <CeneoPath category={r.effective.ceneo} muted />
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {t("categories.inherited", { name: names.get(r.effective.fromCategoryId) ?? r.effective.fromCategoryId })}
                      </Text>
                    </div>
                  ) : (
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {t("categories.none")}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell className="text-right">
                  <RowActions
                    actions={[
                      { key: "edit", label: t(r.own ? "categories.change" : "categories.map"), icon: <PencilSquare />, onClick: () => setEditing(r), disabled: treeEmpty },
                      { key: "remove", label: t("categories.remove"), icon: <Trash />, onClick: () => onRemove(r), hidden: !r.own, danger: true },
                    ]}
                  />
                </Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table>
      {editing ? <Picker row={editing} onClose={() => setEditing(null)} /> : null}
    </Section>
  )
}
