import type { SVGProps } from "react"

/**
 * InPost Von Halsky: InPost's crescent with its five rays in yellow (#FFCC05),
 * the mark of the "InPost Von Halsky" logo, on the violet of Von Halsky's own
 * graphics on inpost.pl (#A200BB to #560064, sampled from the launch banner of
 * https://inpost.pl/en/news-inpost-von-halsky-new-sales-channel-your-online-shop),
 * so it reads as InPost and still differs from the InPost plugin's yellow
 * tile. The crescent paths are those of InPost's logo
 * (https://inpostpay.pl/themes/custom/inpost_pay/public/build/images/icons/InPostPay_logo.svg),
 * unchanged, centred in the frame of the other Koda Plus icons (a rounded
 * square, rx 40 on a 192 viewBox). Since 2026-10-28; before, the plugin had a
 * generic shopping-bag mark.
 *
 * InPost, Von Halsky and their logos are trademarks of their owner, used here
 * only to identify the marketplace this integration connects to.
 */
export const VONHALSKY_COLOR = "#A200BB"

export function VonHalskyIcon({ width = 15, height = 15, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="kp-vonhalsky-tile" x1="0" y1="0" x2="192" y2="192" gradientUnits="userSpaceOnUse">
          <stop stopColor={VONHALSKY_COLOR} />
          <stop offset="1" stopColor="#560064" />
        </linearGradient>
      </defs>
      <rect width="192" height="192" rx="40" fill="url(#kp-vonhalsky-tile)" />
      <g fill="#FFCC05" transform="translate(59.11 38.83) scale(1.9546)">
        <path d="M13.7342 29.3001C13.7342 29.3001 10.6587 30.4953 6.8671 30.4953C3.07551 30.4953 0 29.3001 0 29.3001C0 29.3001 3.07551 28.1049 6.8671 28.1049C10.6587 28.1152 13.7342 29.3001 13.7342 29.3001Z" />
        <path d="M23.2331 11.7794C23.2331 11.7794 20.5027 9.9403 18.3854 6.85448C16.2629 3.76867 15.5469 0.595276 15.5469 0.595276C15.5469 0.595276 18.2772 2.4344 20.3945 5.52022C22.5119 8.61634 23.2331 11.7794 23.2331 11.7794Z" />
        <path d="M16.2791 19.3471C16.2791 19.3471 12.9975 18.9762 9.63864 17.2298C6.29009 15.4782 4.13672 13.0106 4.13672 13.0106C4.13672 13.0106 7.4183 13.3815 10.7771 15.1279C14.136 16.8743 16.2791 19.3471 16.2791 19.3471Z" />
        <path d="M23.2331 46.7486C23.2331 46.7486 20.5027 48.5877 18.3854 51.6735C16.2681 54.7594 15.5469 57.9327 15.5469 57.9327C15.5469 57.9327 18.2772 56.0936 20.3945 53.0078C22.5119 49.922 23.2331 46.7486 23.2331 46.7486Z" />
        <path d="M16.2791 39.1912C16.2791 39.1912 12.9975 39.5621 9.63864 41.3085C6.29009 43.06 4.13672 45.5276 4.13672 45.5276C4.13672 45.5276 7.4183 45.1567 10.7771 43.4103C14.136 41.6639 16.2791 39.1912 16.2791 39.1912Z" />
        <path d="M24.2533 35.0389C26.7312 41.3754 30.6979 45.9191 37.8072 46.9958C37.0035 47.104 36.1792 47.171 35.3292 47.1813C25.263 47.2225 17.0668 39.2478 17.0255 29.367C16.9843 19.4862 25.1033 11.4342 35.1644 11.3879C36.0659 11.3879 36.9468 11.4445 37.8072 11.563C29.6676 12.5727 24.243 18.8886 23.1663 26.9303C22.816 31.8346 28.5239 33.4831 28.5239 33.4831C28.5239 33.4831 26.1954 35.0029 24.2533 35.0389Z" />
      </g>
    </svg>
  )
}
