import type { SVGProps } from "react"

/**
 * The E-mails mark of Koda Plus: a white envelope on pink, on the 192 grid of
 * the other integration icons. The same mark the Koda Plus demo admin and
 * koda.plus show for this module. Our own mark, not the logo of Resend.
 */
export const EMAILS_COLOR = "#DB2777"

export function EmailsIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill={EMAILS_COLOR} />
      <rect x="38" y="54" width="116" height="84" rx="14" fill="#FFFFFF" />
      <path d="M50 68L96 102L142 68" stroke={EMAILS_COLOR} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
