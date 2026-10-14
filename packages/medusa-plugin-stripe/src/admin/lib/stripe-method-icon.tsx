import type { MethodKey } from "../../modules/stripe/lib/contract"

/**
 * The payment methods as small colored marks (30 by 20, the size of a card
 * mark in a checkout), drawn in the methods' own colors so a list reads at a
 * glance: BLIK black, Przelewy24 red, Apple Pay black, Google Pay white,
 * Link green, a card in Stripe's indigo. Simple shapes and words, no
 * copied artwork. Next to the name, never instead of it.
 */
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif"

function Frame({ fill, stroke, children, title }: { fill: string; stroke?: string; children: React.ReactNode; title: string }) {
  return (
    <svg width={30} height={20} viewBox="0 0 30 20" role="img" aria-label={title} className="shrink-0">
      <rect x={0.5} y={0.5} width={29} height={19} rx={4} fill={fill} stroke={stroke ?? fill} />
      {children}
    </svg>
  )
}

export function MethodIcon({ method, title }: { method: MethodKey | null | undefined; title?: string }) {
  const name = title ?? method ?? ""
  switch (method) {
    case "card":
      return (
        <Frame fill="#635BFF" title={name}>
          <rect x={5} y={6} width={6} height={4.5} rx={1} fill="#F8D477" />
          <rect x={5} y={13} width={20} height={1.6} rx={0.8} fill="#ffffff" opacity={0.85} />
        </Frame>
      )
    case "blik":
      return (
        <Frame fill="#000000" title={name}>
          <text x={14} y={14} textAnchor="middle" fontFamily={FONT} fontSize={9} fontWeight={800} fill="#ffffff">
            blik
          </text>
          <circle cx={24.5} cy={6} r={2} fill="#E5004C" />
        </Frame>
      )
    case "p24":
      return (
        <Frame fill="#ffffff" stroke="#E4E4E7" title={name}>
          <text x={15} y={13.6} textAnchor="middle" fontFamily={FONT} fontSize={8.5} fontWeight={800} fill="#D13239">
            P24
          </text>
        </Frame>
      )
    case "apple_pay":
      return (
        <Frame fill="#000000" title={name}>
          <path d="M9.3 7.2c.4-.5.7-1.2.6-1.9-.6 0-1.3.4-1.7.9-.4.4-.7 1.1-.6 1.8.6 0 1.3-.3 1.7-.8zm.6 1c-.9-.1-1.7.5-2.1.5-.4 0-1.1-.5-1.8-.5-.9 0-1.8.6-2.3 1.4-1 1.7-.3 4.3.7 5.7.5.7 1 1.4 1.8 1.4.7 0 1-.5 1.8-.5s1.1.5 1.8.5c.8 0 1.3-.7 1.7-1.4.5-.8.7-1.6.8-1.6 0 0-1.5-.6-1.5-2.3 0-1.4 1.2-2.1 1.2-2.2-.6-1-1.7-1.1-2.1-1z" fill="#ffffff" />
          <text x={20.5} y={13.6} textAnchor="middle" fontFamily={FONT} fontSize={7.5} fontWeight={600} fill="#ffffff">
            Pay
          </text>
        </Frame>
      )
    case "google_pay":
      return (
        <Frame fill="#ffffff" stroke="#DADCE0" title={name}>
          <text x={4.5} y={13.8} fontFamily={FONT} fontSize={9} fontWeight={700} fill="#4285F4">
            G
          </text>
          <text x={12} y={13.6} fontFamily={FONT} fontSize={7.5} fontWeight={600} fill="#5F6368">
            Pay
          </text>
        </Frame>
      )
    case "link":
      return (
        <Frame fill="#00D66F" title={name}>
          <text x={15} y={13.6} textAnchor="middle" fontFamily={FONT} fontSize={8} fontWeight={800} fill="#011E0F">
            link
          </text>
        </Frame>
      )
    default:
      return (
        <Frame fill="#F4F4F5" stroke="#E4E4E7" title={name}>
          <circle cx={10} cy={10} r={1.4} fill="#71717A" />
          <circle cx={15} cy={10} r={1.4} fill="#71717A" />
          <circle cx={20} cy={10} r={1.4} fill="#71717A" />
        </Frame>
      )
  }
}

/** The mark and the name together, the way every list in the plugin shows a method. */
export function MethodName({ method, label, className }: { method: MethodKey | null | undefined; label: string; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-x-2 ${className ?? ""}`}>
      <MethodIcon method={method} title={label} />
      <span className="truncate">{label}</span>
    </span>
  )
}
