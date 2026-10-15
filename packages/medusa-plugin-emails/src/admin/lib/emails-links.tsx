import { ArrowUpRightMini, ArrowUpRightOnBox } from "@medusajs/icons"
import { clx } from "@medusajs/ui"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"

/**
 * Links of the E-mails page, the same as everywhere in the Koda Plus
 * integrations: in the admin (an order) the Medusa mark on a tile with the
 * order and "Open the order"; outside it (Resend) the service mark, the text
 * and the new-window icon. Pages only: react-router's Link breaks in widgets.
 */

/** The Medusa mark, in the text colour. */
export function MedusaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 38" fill="none" aria-hidden className={className}>
      <path d="M30.85 6.16832L22.2453 1.21782C19.4299 -0.405941 15.9801 -0.405941 13.1648 1.21782L4.52043 6.16832C1.74473 7.79208 0 10.802 0 14.0099V23.9505C0 27.198 1.74473 30.1683 4.52043 31.7921L13.1251 36.7822C15.9405 38.4059 19.3903 38.4059 22.2056 36.7822L30.8103 31.7921C33.6257 30.1683 35.3307 27.198 35.3307 23.9505V14.0099C35.41 10.802 33.6653 7.79208 30.85 6.16832ZM17.6852 27.8317C12.8079 27.8317 8.8426 23.8713 8.8426 19C8.8426 14.1287 12.8079 10.1683 17.6852 10.1683C22.5625 10.1683 26.5674 14.1287 26.5674 19C26.5674 23.8713 22.6022 27.8317 17.6852 27.8317Z" fill="currentColor" />
    </svg>
  )
}

/** The Resend mark (Simple Icons, CC0), in the text colour. */
export function ResendMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path d="M14.679 0c4.648 0 7.413 2.765 7.413 6.434s-2.765 6.434-7.413 6.434H12.33L24 24h-8.245l-8.88-8.44c-.636-.588-.93-1.273-.93-1.86 0-.831.587-1.565 1.713-1.883l4.574-1.224c1.737-.465 2.936-1.81 2.936-3.572 0-2.153-1.761-3.4-3.939-3.4H0V0z" fill="currentColor" />
    </svg>
  )
}

/** An order of the store: the Medusa mark, its number when known, "Open the order". */
export function OrderLink({ id, label, open }: { id: string; label?: string | null; open: string }) {
  return (
    <Link to={`/orders/${id}`} className="group flex min-w-0 items-center gap-x-2" title={open}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ui-bg-component shadow-borders-base transition-fg group-hover:bg-ui-bg-component-hover">
        <MedusaMark className="h-3.5 w-3.5 text-ui-fg-base" />
      </span>
      <span className="flex min-w-0 flex-col">
        {label ? <span className="txt-compact-small-plus truncate tabular-nums text-ui-fg-base group-hover:text-ui-fg-interactive">{label}</span> : null}
        <span className="txt-compact-xsmall-plus inline-flex shrink-0 items-center gap-x-0.5 text-ui-fg-interactive">
          {open}
          <ArrowUpRightMini />
        </span>
      </span>
    </Link>
  )
}

/** The message in Resend's dashboard, in a new tab. */
export function ResendLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={clx("txt-compact-small inline-flex items-center gap-x-1.5 text-ui-fg-interactive hover:text-ui-fg-interactive-hover", className)}>
      <ResendMark className="h-3.5 w-3.5 shrink-0 text-ui-fg-base" />
      <span className="truncate">{children}</span>
      <ArrowUpRightOnBox className="shrink-0" />
    </a>
  )
}
