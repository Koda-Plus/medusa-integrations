import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { FolderOpen, XMark } from "@medusajs/icons"
import { Button, Popover, Text, clx } from "@medusajs/ui"
import type { CategoryDto } from "../../modules/vonhalsky/lib/contract"
import { useVonHalskyCategories } from "./vonhalsky-api"
import { SearchInput, ToneBadge, useDebouncedValue } from "./vonhalsky-blocks"

/** Search results of the category tree: leaves only (an offer needs the lowest level), the path in full. */
export function CategoryResults({ onPick, active = true }: { onPick: (c: CategoryDto) => void; active?: boolean }) {
  const { t } = useTranslation("vonhalsky")
  const [input, setInput] = useState("")
  const q = useDebouncedValue(input.trim())
  const list = useVonHalskyCategories(q, true, active)
  const rows = list.data?.categories ?? []
  return (
    <div className="flex flex-col gap-y-2">
      <SearchInput value={input} onChange={setInput} placeholder={t("categories.search")} className="sm:w-full" autoFocus />
      <div className="flex max-h-72 flex-col overflow-y-auto rounded-md border border-ui-border-base">
        {list.isLoading ? (
          <Text size="xsmall" className="px-3 py-2 text-ui-fg-muted">
            {t("categories.loading")}
          </Text>
        ) : null}
        {!list.isLoading && rows.length === 0 ? (
          <Text size="xsmall" className="px-3 py-2 text-ui-fg-muted">
            {list.data && list.data.count === 0 && !q ? t("categories.noTree") : t("categories.none")}
          </Text>
        ) : null}
        {rows.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c)}
            className="flex flex-col items-start gap-y-0.5 border-b border-ui-border-base px-3 py-2 text-left last:border-b-0 hover:bg-ui-bg-base-hover focus-visible:bg-ui-bg-base-hover focus-visible:outline-none"
          >
            <span className="txt-compact-small-plus text-ui-fg-base">{c.name}</span>
            <span className="txt-compact-xsmall text-ui-fg-muted">{c.path}</span>
            {c.gpsr_free ? <ToneBadge tone="blue">{t("categories.gpsrFree")}</ToneBadge> : null}
          </button>
        ))}
      </div>
      {list.data && list.data.count > rows.length ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("categories.more", { shown: rows.length, count: list.data.count })}
        </Text>
      ) : null}
    </div>
  )
}

/**
 * A button that opens a search of marketplace leaf categories. Shows the
 * chosen path (or `placeholder`); `onClear` adds the remove button.
 */
export function CategoryPicker({
  value,
  placeholder,
  onPick,
  onClear,
  disabled,
  icon,
}: {
  value: string | null
  placeholder: string
  onPick: (c: CategoryDto) => void
  onClear?: () => void
  disabled?: boolean
  icon?: ReactNode
}) {
  const { t } = useTranslation("vonhalsky")
  const [open, setOpen] = useState(false)
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button size="small" variant="secondary" disabled={disabled} className="max-w-full justify-start">
            {icon ?? <FolderOpen />}
            <span className={clx("truncate", !value && "text-ui-fg-muted")}>{value ?? placeholder}</span>
          </Button>
        </Popover.Trigger>
        <Popover.Content align="start" sideOffset={6} className="w-[min(480px,calc(100vw-32px))] p-3">
          {open ? (
            <CategoryResults
              onPick={(c) => {
                setOpen(false)
                onPick(c)
              }}
            />
          ) : null}
        </Popover.Content>
      </Popover>
      {onClear && value ? (
        <Button size="small" variant="transparent" title={t("categories.clear")} aria-label={t("categories.clear")} disabled={disabled} onClick={onClear}>
          <XMark />
        </Button>
      ) : null}
    </span>
  )
}
