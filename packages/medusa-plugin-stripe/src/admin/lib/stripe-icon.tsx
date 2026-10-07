import type { SVGProps } from "react"

/**
 * The Stripe mark: the white "S" on Stripe's blurple (#635BFF), in the same
 * frame as the other Koda Plus integration icons (a 192 square with 40 of
 * corner radius). Shown in the admin sidebar, in the page header and in the
 * order widget.
 *
 * The "S" is Stripe's own glyph, not a redrawing: the path of the `stripe`
 * icon of Simple Icons 16.34.0, whose source is Stripe's press page,
 *   https://cdn.jsdelivr.net/npm/simple-icons@16.34.0/icons/stripe.svg
 *   (source: https://stripe.com/newsroom/information, colour 635BFF)
 * placed unchanged in its 24 unit box, centred and scaled by 4.4.
 *
 * Stripe and the Stripe logo are trademarks of Stripe, Inc., used here only
 * to identify the service this integration reads from.
 */
export function StripeIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <rect width="192" height="192" rx="40" fill="#635BFF" />
      <path
        transform="translate(43.2 43.2) scale(4.4)"
        fill="#FFFFFF"
        d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"
      />
    </svg>
  )
}
