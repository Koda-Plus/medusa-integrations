/**
 * Documentation screenshots for the Koda Plus plugins: the admin panel and
 * the setup guide of every plugin page in the live demo store
 * (medusa.koda.plus, signed in by the demo link itself), and the storefront
 * shots of the demo store. The PNGs land in packages/*\/docs, referenced by
 * the READMEs, at the same size as the other screenshots (2160x1350).
 *
 * Uses the globally installed playwright, headless, so no window is needed:
 *   npm i -g playwright@1.56.1 && npx playwright install chromium
 *   node scripts/shots.mjs
 *
 * The demo links open the admin in English, so the shots are the English
 * pages; the storefront shots are the Polish storefront of the demo.
 */

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { execSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const log = (line) => console.log(`[shots] ${line}`)

async function loadPlaywright() {
  const global = execSync("npm root -g").toString().trim()
  try {
    return await import(pathToFileURL(path.join(global, "playwright", "index.mjs")).href)
  } catch (e) {
    log(`playwright not found globally: ${e.message}`)
    return null
  }
}

const PLUGINS = [
  { ns: "compliance", pkg: "medusa-plugin-compliance" },
  { ns: "whitelist", pkg: "medusa-plugin-vat-whitelist" },
  { ns: "credit", pkg: "medusa-plugin-trade-credit" },
  { ns: "packaging", pkg: "medusa-plugin-packaging" },
  { ns: "loyalty", pkg: "medusa-plugin-loyalty" },
]

async function main() {
  const pw = await loadPlaywright()
  if (!pw) process.exit(1)
  const browser = await pw.chromium.launch({ headless: true })
  const shots = []
  try {
    /* 2160x1350 like the existing screenshots: 1080x675 at device scale 2. */
    const page = await browser.newPage({ viewport: { width: 1080, height: 675 }, deviceScaleFactor: 2 })

    /* --- The admin pages --- */
    for (const p of PLUGINS) {
      const docs = path.join(root, "packages", p.pkg, "docs")
      fs.mkdirSync(docs, { recursive: true })

      await page.goto(`https://medusa.koda.plus/app/${p.ns}?demo=en`, { waitUntil: "networkidle", timeout: 120_000 })
      await page.getByText("Setup guide", { exact: false }).first().waitFor({ timeout: 60_000 }).catch(() => {})
      await page.waitForTimeout(1200)
      const panel = path.join(docs, `admin-${p.ns}.png`)
      await page.screenshot({ path: panel })
      shots.push(panel)

      await page.goto(`https://medusa.koda.plus/app/${p.ns}?view=guide`, { waitUntil: "networkidle", timeout: 120_000 })
      await page.getByText("Install the plugin", { exact: false }).first().waitFor({ timeout: 60_000 }).catch(() => {})
      await page.waitForTimeout(2000)
      const guide = path.join(docs, `admin-${p.ns}-guide.png`)
      await page.screenshot({ path: guide })
      shots.push(guide)
      log(`${p.ns}: panel + guide${fs.statSync(guide).size === fs.statSync(panel).size ? "  (WARN: same size as the panel shot)" : ""}`)
    }

    /* --- The storefront: one product with a GPSR record and a ladder --- */
    /* The Store API wants the publishable key: the product pages carry it in
     * their own requests. First find a product link on the homepage (it is
     * pre-rendered), then open it and take the key from its API requests. */
    await page.goto("https://demo.koda.plus/pl-pl", { waitUntil: "networkidle", timeout: 120_000 })
    const productHref = await page.evaluate(async () => {
      const m = document.documentElement.outerHTML.match(/href="(\/pl-pl\/store\/[^"]+)"/)
      return m ? `https://demo.koda.plus${m[1]}` : null
    })
    let publishable = null
    if (productHref) {
      publishable = await new Promise((resolve) => {
        const done = (v) => resolve(v)
        page.on("request", function handler(req) {
          if (req.url().startsWith("https://medusa.koda.plus")) {
            const key = req.headers()["x-publishable-api-key"]
            if (key) {
              page.off("request", handler)
              done(key)
            }
          }
        })
        page.goto(productHref, { waitUntil: "networkidle", timeout: 120_000 }).catch(() => done(null))
        setTimeout(() => done(null), 15_000)
      })
    }
    if (!publishable) log("no publishable key seen; storefront shots skipped")
    const productId = publishable
      ? await page.evaluate(async ({ base, key }) => {
          const head = { "x-publishable-api-key": key }
          const list = await (await fetch(`${base}/store/products?limit=20`, { headers: head })).json()
          const ids = (list.products ?? []).map((p) => p.id).filter(Boolean)
          for (const id of ids) {
            const pkg = await fetch(`${base}/store/packaging/products/${id}`, { headers: head })
            const pkgBody = await pkg.json().catch(() => ({}))
            const gpsr = await fetch(`${base}/store/compliance/products/${id}`, { headers: head })
            const gpsrBody = await gpsr.json().catch(() => ({}))
            if ((pkgBody.packaging?.units?.length ?? 0) > 0 && (gpsrBody.product || gpsrBody.safety)) return id
          }
          return null
        }, { base: "https://medusa.koda.plus", key: publishable })
      : null
    if (productId) {
      log(`storefront product: ${productId}`)
      await page.goto(`https://demo.koda.plus/pl-pl/store/${productId}`, { waitUntil: "networkidle", timeout: 120_000 })
      await page.waitForTimeout(1200)

      const gpsrBlock = page.locator(".gpsr")
      if (await gpsrBlock.count()) {
        const target = path.join(root, "packages", "medusa-plugin-compliance", "docs", "store-gpsr.png")
        await gpsrBlock.first().screenshot({ path: target })
        shots.push(target)
        log("compliance: store-gpsr")
      }
      const pkgBlock = page.locator(".pkg")
      if (await pkgBlock.count()) {
        const target = path.join(root, "packages", "medusa-plugin-packaging", "docs", "store-ladder.png")
        await pkgBlock.first().screenshot({ path: target })
        shots.push(target)
        log("packaging: store-ladder")
      }
    } else {
      log("no product with both a GPSR record and a ladder; storefront shots skipped")
    }

    /* --- The B2B zone: the NIP step of the registration --- */
    await page.goto("https://demo.koda.plus/pl-pl", { waitUntil: "networkidle", timeout: 120_000 })
    const nipStep = page.locator("#b2b-01")
    await nipStep.scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(800)
    if (await nipStep.count()) {
      const target = path.join(root, "packages", "medusa-plugin-vat-whitelist", "docs", "store-b2b-nip.png")
      await nipStep.first().screenshot({ path: target })
      shots.push(target)
      log("whitelist: store-b2b-nip")
    }
  } finally {
    await browser.close()
  }
  log(`${shots.length} shots written:`)
  for (const s of shots) log(`  ${path.relative(root, s)} (${fs.statSync(s).size} bytes)`)
}

main().catch((e) => {
  console.error(`[shots] ${e?.stack ?? e}`)
  process.exit(1)
})
