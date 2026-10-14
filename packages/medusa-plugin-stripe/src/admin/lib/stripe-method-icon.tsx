import type { MethodKey } from "../../modules/stripe/lib/contract"
import { METHOD_LOGOS } from "./stripe-method-logos"

/**
 * The payment method's own logo (stripe-method-logos.ts: the logos Stripe
 * shows for its methods, from @exisia/medusa-payment-icons), in a box of one
 * size so a list lines up. Next to the name, never instead of it. A method
 * with no logo ("other") gets the plain card mark, greyed.
 */
export function MethodIcon({ method, title }: { method: MethodKey | null | undefined; title?: string }) {
  const src = (method && METHOD_LOGOS[method]) || METHOD_LOGOS.card
  const plain = !method || !METHOD_LOGOS[method]
  return (
    <span className="inline-flex h-5 w-9 shrink-0 items-center justify-center" title={title}>
      <img src={src} alt={title ?? method ?? ""} className={`max-h-5 max-w-9 object-contain ${plain ? "opacity-50 grayscale" : ""}`} draggable={false} />
    </span>
  )
}

/** The logo and the name together, the way every list in the plugin shows a method. */
export function MethodName({ method, label, className }: { method: MethodKey | null | undefined; label: string; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-x-2 ${className ?? ""}`}>
      <MethodIcon method={method} title={label} />
      <span className="truncate">{label}</span>
    </span>
  )
}
