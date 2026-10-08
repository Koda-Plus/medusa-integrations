#!/usr/bin/env node
/**
 * THE SMOKE TEST: the packages as npm will ship them, in a fresh Medusa app.
 *
 *   node scripts/smoke.mjs                                  latest Medusa and the newest 2.12.x
 *   node scripts/smoke.mjs --medusa 2.21.2 --medusa 2.12.6  given versions
 *   node scripts/smoke.mjs --only inpost,stripe             some packages
 *   node scripts/smoke.mjs --from-tree                      pack the working tree instead of HEAD
 *   node scripts/smoke.mjs --ref origin/main                pack that commit instead of HEAD
 *   node scripts/smoke.mjs --no-browser                     skip the admin pages
 *   node scripts/smoke.mjs --keep                           keep the work folder
 *
 * For each Medusa version: packs every package (from a clean worktree of
 * HEAD unless --from-tree, so uncommitted files never leak in), creates an
 * app with the packages installed from their tarballs and registered in
 * demo mode (the fulfillment provider of InPost and the notification
 * provider of E-mails too), runs the migrations on a throwaway Postgres,
 * checks that every plugin's tables exist, builds the app with its admin,
 * starts it, signs in, reads every plugin's koda.integration/1 routes and
 * opens every plugin page in a headless Chromium (no page errors allowed).
 * The report goes to <work>/report.json, the page shots to <work>/screens.
 *
 * Postgres: SMOKE_PG_URL (a server URL whose user may create databases, as
 * in CI), else a temporary cluster from the local initdb (Linux:
 * /usr/lib/postgresql/<n>/bin, Windows: C:\Program Files\PostgreSQL\<n>\bin)
 * on port 5544, in the work folder.
 */
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { listPackages, root, selectPackages } from "./lib/packages.mjs"

const argv = process.argv.slice(2)
const values = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []))
const flag = (name) => argv.includes(name)
const onlyArg = values("--only")[0]
const only = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim()).filter(Boolean)) : null
const fromTree = flag("--from-tree")
/* A commit to pack instead of HEAD (the release candidate on main while work goes on in the branch). */
const ref = values("--ref")[0] ?? "HEAD"
if (!/^(HEAD|[0-9a-f]{7,40}|[A-Za-z0-9._/-]+)$/.test(ref) || ref.startsWith("-")) {
  console.error(`--ref: not a commit or branch name: ${ref}`)
  process.exit(1)
}
const browser = !flag("--no-browser")
const keep = flag("--keep")
const isWin = process.platform === "win32"

const work = path.resolve(values("--workdir")[0] ?? fs.mkdtempSync(path.join(os.tmpdir(), "koda-smoke-")))
fs.mkdirSync(work, { recursive: true })
const report = { started: new Date().toISOString(), work, runs: [] }
const log = (m) => console.log(`[smoke] ${m}`)

function sh(cmd, opts = {}) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", stdio: opts.quiet === false ? "inherit" : "pipe", maxBuffer: 64 * 1024 * 1024, ...opts })
  return { ok: r.status === 0, status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}
function must(cmd, opts = {}, what = cmd) {
  const r = sh(cmd, opts)
  if (!r.ok) throw new Error(`${what} failed (exit ${r.status}):\n${r.out.slice(-4000)}`)
  return r.out
}

/* ------------------------------------------------------------------ */
/* Versions                                                            */
/* ------------------------------------------------------------------ */

function resolveVersions() {
  const asked = values("--medusa")
  const all = JSON.parse(must("npm view @medusajs/medusa versions --json"))
  const stable = all.filter((v) => /^2\.\d+\.\d+$/.test(v))
  const latest = must("npm view @medusajs/medusa dist-tags.latest").trim()
  const pick = (v) => {
    if (v === "latest") return latest
    if (/^2\.\d+$/.test(v)) return stable.filter((x) => x.startsWith(`${v}.`)).pop()
    return v
  }
  const list = (asked.length ? asked : ["latest", "2.12"]).map(pick).filter(Boolean)
  return [...new Set(list)]
}

/* ------------------------------------------------------------------ */
/* Tarballs                                                            */
/* ------------------------------------------------------------------ */

function packAll(packages) {
  const tarDir = path.join(work, "tarballs")
  fs.mkdirSync(tarDir, { recursive: true })
  let srcRoot = root
  let worktree = null
  if (!fromTree) {
    worktree = path.join(work, "head")
    must(`git worktree add --detach "${worktree}" ${ref}`, { cwd: root }, "git worktree add")
    srcRoot = worktree
    /* node_modules of the main checkout, linked (never copied, never deleted through the link). */
    for (const p of packages) {
      const from = path.join(p.path, "node_modules")
      const to = path.join(worktree, "packages", p.dir, "node_modules")
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.symlinkSync(from, to, isWin ? "junction" : "dir")
    }
  }
  const tarballs = {}
  /* What each packed package offers, read from the same tree it was packed from. */
  const routes = {}
  for (const p of packages) {
    const dir = path.join(srcRoot, "packages", p.dir)
    const admin = path.join(dir, "src", "api", "admin", p.ns)
    /* The tables its migrations create (some plugins name them in the singular: negotiation, negotiation_message). */
    const tables = new Set()
    const migrations = path.join(dir, "src", "modules", p.moduleDir, "migrations")
    if (fs.existsSync(migrations)) {
      /* In migration order: created, dropped, renamed. */
      const sql = /(create table if not exists|drop table if exists|alter table)\s+\\?"([a-z0-9_]+)\\?"(?:\s+rename to\s+\\?"([a-z0-9_]+)\\?")?/gi
      for (const f of fs.readdirSync(migrations).filter((x) => x.endsWith(".ts")).sort()) {
        /* Only up(): down() drops what up() created. */
        const up = fs.readFileSync(path.join(migrations, f), "utf8").split(/async\s+down\s*\(/)[0]
        for (const m of up.matchAll(sql)) {
          const verb = m[1].toLowerCase()
          if (verb.startsWith("create")) tables.add(m[2])
          else if (verb.startsWith("drop")) tables.delete(m[2])
          else if (m[3]) {
            tables.delete(m[2])
            tables.add(m[3])
          }
        }
      }
    }
    routes[p.ns] = { contract: fs.existsSync(path.join(admin, "integration", "route.ts")), status: fs.existsSync(path.join(admin, "route.ts")), tables: [...tables] }
    log(`build and pack ${p.dir}`)
    must("npm run build", { cwd: dir }, `${p.dir}: npm run build`)
    const out = must(`npm pack --json --ignore-scripts --pack-destination "${tarDir}"`, { cwd: dir }, `${p.dir}: npm pack`)
    const file = JSON.parse(out.slice(out.indexOf("[")))[0].filename
    tarballs[p.name] = path.join(tarDir, path.basename(file))
  }
  return { tarballs, worktree, routes }
}

function removeWorktree(worktree, packages) {
  if (!worktree) return
  /* Links first: a recursive delete must never walk into the main checkout's node_modules. */
  for (const p of packages) {
    const link = path.join(worktree, "packages", p.dir, "node_modules")
    try {
      if (fs.lstatSync(link).isSymbolicLink() || isWin) fs.rmSync(link, { force: true, recursive: false })
    } catch {
      /* not there */
    }
  }
  sh(`git worktree remove --force "${worktree}"`, { cwd: root })
}

/* ------------------------------------------------------------------ */
/* Postgres                                                            */
/* ------------------------------------------------------------------ */

function findPgBin() {
  const candidates = []
  if (process.env.PG_BIN) candidates.push(process.env.PG_BIN)
  for (const base of isWin ? ["C:\\Program Files\\PostgreSQL"] : ["/usr/lib/postgresql", "/usr/local/opt/postgresql@16/bin"]) {
    if (!fs.existsSync(base)) continue
    if (fs.existsSync(path.join(base, isWin ? "initdb.exe" : "initdb"))) candidates.push(base)
    for (const v of fs.readdirSync(base).sort().reverse()) candidates.push(path.join(base, v, "bin"))
  }
  return candidates.find((c) => fs.existsSync(path.join(c, isWin ? "initdb.exe" : "initdb"))) ?? null
}

function startPostgres() {
  if (process.env.SMOKE_PG_URL) return { url: process.env.SMOKE_PG_URL.replace(/\/+$/, ""), stop: () => {} }
  const bin = findPgBin()
  if (!bin) throw new Error("no Postgres: set SMOKE_PG_URL or install PostgreSQL (initdb)")
  const port = 5544
  const exe = (n) => `"${path.join(bin, isWin ? `${n}.exe` : n)}"`
  /* As root (containers), the cluster runs as "postgres" in a folder of its own under the system temp. */
  const runAs = !isWin && process.getuid && process.getuid() === 0 ? "postgres" : null
  const pgDir = runAs ? fs.mkdtempSync(path.join("/tmp", "koda-smoke-pg-")) : work
  const data = path.join(pgDir, "data")
  if (runAs) {
    must(`chown -R postgres "${pgDir}"`, {}, "chown the Postgres folder")
    fs.chmodSync(pgDir, 0o755)
  }
  const as = (cmd) => (runAs ? `su ${runAs} -s /bin/sh -c '${cmd.replace(/'/g, "'\\''")}'` : cmd)
  must(as(`${exe("initdb")} -D "${data}" -U smoke -A trust -E UTF8 --no-locale`), {}, "initdb")
  must(as(`${exe("pg_ctl")} -D "${data}" -o "-p ${port}${isWin ? "" : ` -k /tmp`} -c listen_addresses=localhost" -l "${path.join(pgDir, "pg.log")}" -w start`), {}, "pg_ctl start")
  return {
    url: `postgres://smoke@localhost:${port}`,
    stop: () => {
      sh(as(`${exe("pg_ctl")} -D "${data}" -m fast -w stop`))
      if (runAs) fs.rmSync(pgDir, { recursive: true, force: true })
    },
  }
}

/* ------------------------------------------------------------------ */
/* The app                                                             */
/* ------------------------------------------------------------------ */

/*
 * The dependencies of the official Medusa starter, nothing more. The admin
 * libraries (@medusajs/ui, @tanstack/react-query, react-router-dom,
 * react-i18next) come with Medusa's dashboard at the exact versions it pins;
 * the plugins import those same copies. An app that installs other versions
 * of them splits the admin into two React contexts, and plugin pages fail.
 */
const PEERS = (v) => ({
  "@medusajs/admin-sdk": v,
  "@medusajs/cli": v,
  "@medusajs/framework": v,
  "@medusajs/medusa": v,
})

function writeApp(dir, version, packages, tarballs, dbUrl) {
  fs.mkdirSync(path.join(dir, "src"), { recursive: true })
  const deps = { ...PEERS(version) }
  for (const p of packages) deps[p.name] = `file:${tarballs[p.name].split(path.sep).join("/")}`
  const pkg = {
    name: `koda-smoke-${version.replace(/\./g, "-")}`,
    private: true,
    version: "0.0.0",
    scripts: { build: "medusa build", start: "medusa start" },
    dependencies: deps,
    devDependencies: {
      "@medusajs/test-utils": version,
      "@swc/core": "^1.15.0",
      "@types/node": "^22.5.4",
      "@types/react": "^18.3.1",
      "@types/react-dom": "^18.3.1",
      "prop-types": "^15.8.1",
      react: "^18.3.1",
      "react-dom": "^18.3.1",
      "ts-node": "^10.9.2",
      typescript: "^5.6.2",
      vite: "^5.4.0",
    },
    engines: { node: ">=20" },
  }
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2))
  const has = (ns) => packages.some((p) => p.ns === ns)
  const plugin = (name) => `    { resolve: "${name}", options: { demo: true } },`
  const config = [
    'import { defineConfig, loadEnv } from "@medusajs/framework/utils"',
    "",
    "loadEnv(process.env.NODE_ENV || \"development\", process.cwd())",
    "",
    "export default defineConfig({",
    "  projectConfig: {",
    "    databaseUrl: process.env.DATABASE_URL,",
    "    http: {",
    '      storeCors: process.env.SMOKE_ORIGIN || "http://localhost:9000",',
    '      adminCors: process.env.SMOKE_ORIGIN || "http://localhost:9000",',
    '      authCors: process.env.SMOKE_ORIGIN || "http://localhost:9000",',
    '      jwtSecret: "smoke-jwt-secret",',
    '      cookieSecret: "smoke-cookie-secret",',
    "    },",
    "  },",
    "  plugins: [",
    ...packages.map((p) => plugin(p.name)),
    "  ],",
    "  modules: [",
    ...(has("inpost")
      ? [
          '    { resolve: "@medusajs/medusa/fulfillment", options: { providers: [',
          '      { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },',
          '      { resolve: "@koda-plus/medusa-plugin-inpost/providers/inpost", id: "inpost", options: { demo: true } },',
          "    ] } },",
        ]
      : []),
    ...(has("emails")
      ? [
          '    { resolve: "@medusajs/medusa/notification", options: { providers: [',
          '      { resolve: "@koda-plus/medusa-plugin-emails/providers/emails", id: "emails", options: { channels: ["email"], demo: true } },',
          "    ] } },",
        ]
      : []),
    "  ],",
    "})",
    "",
  ].join("\n")
  fs.writeFileSync(path.join(dir, "medusa-config.ts"), config)
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: { target: "ES2021", esModuleInterop: true, module: "Node16", moduleResolution: "Node16", emitDecoratorMetadata: true, experimentalDecorators: true, skipLibCheck: true, declaration: false, sourceMap: false, inlineSourceMap: true, outDir: "./.medusa/server", rootDir: "./", jsx: "react-jsx", resolveJsonModule: true, strict: false },
        "ts-node": { swc: true },
        include: ["**/*", ".medusa/types/*"],
        exclude: ["node_modules", ".medusa/server", ".medusa/admin", ".cache"],
      },
      null,
      2,
    ),
  )
  fs.writeFileSync(path.join(dir, ".env"), `DATABASE_URL=${dbUrl}\nNODE_ENV=development\n`)
}

/** A port nobody listens on, from the system. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

/** Stops the server and everything it started (npx runs medusa as a child); SIGKILL when it does not go in 5 s. */
async function stopTree(child) {
  if (!child || child.exitCode !== null) return
  const signal = (sig) => {
    try {
      if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"])
      else process.kill(-child.pid, sig)
    } catch {
      /* gone */
    }
  }
  signal("SIGTERM")
  for (let i = 0; i < 10 && child.exitCode === null; i++) await new Promise((r) => setTimeout(r, 500))
  if (child.exitCode === null) signal("SIGKILL")
}

async function waitFor(url, ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      const r = await fetch(url)
      if (r.ok) return true
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return false
}

async function api(base, token, p, init = {}) {
  const r = await fetch(`${base}${p}`, { ...init, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init.headers ?? {}) } })
  let body = null
  try {
    body = await r.json()
  } catch {
    body = null
  }
  return { status: r.status, body }
}

async function loadPlaywright() {
  const tries = ["playwright", "/opt/node-tools/node_modules/playwright/index.mjs", path.join(process.env.npm_config_prefix ?? "", "lib/node_modules/playwright/index.mjs")]
  for (const t of tries) {
    try {
      return await import(t)
    } catch {
      /* next */
    }
  }
  const global = sh("npm root -g").out.trim()
  try {
    return await import(path.join(global, "playwright", "index.mjs"))
  } catch {
    return null
  }
}

async function smokeVersion(version, packages, tarballs, routes = {}) {
  const run = { medusa: version, steps: [], plugins: {}, ok: false }
  report.runs.push(run)
  const step = (name, ok, detail) => {
    run.steps.push({ name, ok, ...(detail ? { detail: String(detail).slice(0, 2000) } : {}) })
    log(`${version} ${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? `\n${String(detail).slice(0, 1500)}` : ""}`)
    if (!ok) throw new Error(`${name} failed`)
  }
  const dir = path.join(work, `app-${version}`)
  const pg = startPostgres()
  const db = `smoke_${version.replace(/\./g, "_")}`
  let server = null
  try {
    if (process.env.SMOKE_PG_URL) sh(`psql "${pg.url}/postgres" -c "drop database if exists ${db}" -c "create database ${db}"`)
    else must(`"${path.join(findPgBin(), isWin ? "createdb.exe" : "createdb")}" -h localhost -p 5544 -U smoke ${db}`, {}, "createdb")
    const dbUrl = `${pg.url}/${db}`
    writeApp(dir, version, packages, tarballs, dbUrl)
    let r = sh("npm install --no-audit --no-fund --loglevel=error", { cwd: dir })
    step("npm install (Medusa and the tarballs)", r.ok, r.out.slice(-3000))
    const env = { ...process.env, DATABASE_URL: dbUrl, NODE_ENV: "development" }
    r = sh("npx medusa db:migrate", { cwd: dir, env })
    step("medusa db:migrate", r.ok, r.out.slice(-3000))
    const tables = sh(`node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query(\\"select table_name from information_schema.tables where table_schema='public'\\")).then(r=>{console.log(JSON.stringify(r.rows.map(x=>x.table_name)));return c.end()})"`, { cwd: dir, env })
    const names = tables.ok ? JSON.parse(tables.out.trim().split("\n").pop()) : []
    for (const p of packages) {
      const want = routes[p.ns]?.tables ?? []
      if (want.length) {
        const missing = want.filter((t) => !names.includes(t))
        run.plugins[p.ns] = { tables: want.length - missing.length }
        step(`${p.ns}: its tables exist`, missing.length === 0, `missing: ${missing.join(", ")}`)
        continue
      }
      const own = names.filter((t) => t.startsWith(`${p.moduleDir}_`) || t.startsWith(`${p.ns}_`) || (p.ns === "subiekt" && t.startsWith("subiekt")))
      run.plugins[p.ns] = { tables: own.length }
      if (p.ns !== "stripe") step(`${p.ns}: its tables exist`, own.length > 0, `tables: ${own.join(", ") || "none"}`)
    }
    r = sh("npx medusa user -e smoke@example.com -p smoke-password-123", { cwd: dir, env })
    step("medusa user (admin)", r.ok, r.out.slice(-1500))
    r = sh("npx medusa build", { cwd: dir, env })
    step("medusa build (server and admin with every plugin)", r.ok, r.out.slice(-4000))
    const port = await freePort()
    /* Its own process group, so stopping it stops medusa too (npx starts it as a child). */
    server = spawn(isWin ? "npx.cmd" : "npx", ["medusa", "start"], { cwd: dir, env: { ...env, PORT: String(port), SMOKE_ORIGIN: `http://localhost:${port}` }, shell: isWin, detached: !isWin, stdio: ["ignore", "pipe", "pipe"] })
    let serverLog = ""
    server.stdout.on("data", (d) => (serverLog += d))
    server.stderr.on("data", (d) => (serverLog += d))
    const base = `http://localhost:${port}`
    step("medusa start, /health", await waitFor(`${base}/health`, 180_000), serverLog.slice(-3000))
    const login = await fetch(`${base}/auth/user/emailpass`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "smoke@example.com", password: "smoke-password-123" }) })
    const token = (await login.json().catch(() => ({}))).token
    step("admin sign in", Boolean(token), `HTTP ${login.status}`)
    for (const p of packages) {
      /* A plugin not on koda.integration/1 yet: its own status route answers, nothing more is asked of it. */
      if (routes[p.ns] && !routes[p.ns].contract) {
        run.plugins[p.ns].contract = false
        if (routes[p.ns].status) {
          const st = await api(base, token, `/admin/${p.ns}`)
          step(`${p.ns}: GET /admin/${p.ns} (not on the contract yet)`, st.status === 200, `HTTP ${st.status} ${JSON.stringify(st.body).slice(0, 300)}`)
        }
        continue
      }
      const m = await api(base, token, `/admin/${p.ns}/integration`)
      const ok = m.status === 200 && m.body?.contract === "koda.integration/1" && m.body?.ns === p.ns
      run.plugins[p.ns].manifest = { status: m.status, mode: m.body?.mode ?? null, version: m.body?.version ?? null }
      step(`${p.ns}: GET /admin/${p.ns}/integration`, ok, JSON.stringify(m.body).slice(0, 500))
      const a = await api(base, token, `/admin/${p.ns}/integration/attention`)
      step(`${p.ns}: GET /admin/${p.ns}/integration/attention`, a.status === 200 && Array.isArray(a.body?.items), JSON.stringify(a.body).slice(0, 500))
      const entity = m.body?.entities?.[0]
      if (entity) {
        const s = await api(base, token, `/admin/${p.ns}/integration/summary?entity=${entity}&id=smoke_unknown_1`)
        step(`${p.ns}: summary of an unknown ${entity} is "none"`, s.status === 200 && s.body?.state === "none", JSON.stringify(s.body).slice(0, 500))
      }
      const guard = await fetch(`${base}/admin/${p.ns}/integration`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" }, body: "x" })
      step(`${p.ns}: a form-like write to /admin/${p.ns} is refused`, guard.status === 415 || guard.status === 404, `HTTP ${guard.status}`)
    }
    if (browser) {
      const pw = await loadPlaywright()
      if (!pw) step("playwright available", false, "install playwright or pass --no-browser")
      const shots = path.join(work, "screens")
      fs.mkdirSync(shots, { recursive: true })
      const b = await pw.chromium.launch({ headless: true })
      try {
        const page = await b.newPage({ viewport: { width: 1440, height: 1000 } })
        const errors = []
        page.on("pageerror", (e) => errors.push(String(e?.message ?? e)))
        await page.goto(`${base}/app/login`, { waitUntil: "networkidle", timeout: 120_000 })
        await page.fill('input[name="email"]', "smoke@example.com")
        await page.fill('input[name="password"]', "smoke-password-123")
        await page.click('button[type="submit"]')
        await page.waitForURL(/\/app\/(orders|products|$)/, { timeout: 60_000 }).catch(() => {})
        for (const p of packages) {
          errors.length = 0
          await page.goto(`${base}/app/${p.ns}`, { waitUntil: "networkidle", timeout: 120_000 })
          await page.waitForTimeout(1500)
          const text = await page.locator("body").innerText()
          await page.screenshot({ path: path.join(shots, `${version}-${p.ns}.png`), fullPage: false })
          const shown = text.includes(p.brand) || text.toLowerCase().includes(p.ns)
          run.plugins[p.ns].page = { errors: [...errors], shown }
          step(`${p.ns}: admin page /app/${p.ns}`, shown && errors.length === 0, errors.join("\n") || "the page does not name the plugin")
        }
      } finally {
        await b.close()
      }
    }
    run.ok = true
  } catch (e) {
    run.error = String(e?.message ?? e).slice(0, 4000)
  } finally {
    if (server) await stopTree(server)
    pg.stop()
  }
  return run.ok
}

/* ------------------------------------------------------------------ */

const packages = selectPackages(listPackages(), only)
let worktree = null
let failed = false
try {
  const versions = resolveVersions()
  log(`work folder ${work}; Medusa ${versions.join(", ")}; ${packages.length} packages${fromTree ? " (working tree)" : ` (${ref})`}`)
  const packed = packAll(packages)
  worktree = packed.worktree
  for (const v of versions) if (!(await smokeVersion(v, packages, packed.tarballs, packed.routes))) failed = true
} catch (e) {
  failed = true
  report.error = String(e?.message ?? e).slice(0, 4000)
  console.error(`[smoke] ${report.error}`)
} finally {
  removeWorktree(worktree, packages)
  report.finished = new Date().toISOString()
  fs.writeFileSync(path.join(work, "report.json"), JSON.stringify(report, null, 2))
  log(`report: ${path.join(work, "report.json")}`)
  for (const r of report.runs) log(`Medusa ${r.medusa}: ${r.ok ? "PASSED" : `FAILED (${r.error?.split("\n")[0] ?? "see the report"})`}`)
  if (!keep && !failed) {
    for (const r of report.runs) fs.rmSync(path.join(work, `app-${r.medusa}`), { recursive: true, force: true })
  }
}
process.exit(failed ? 1 : 0)
