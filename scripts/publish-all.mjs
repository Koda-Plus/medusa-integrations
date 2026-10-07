#!/usr/bin/env node
/**
 * Releases the packages to npm.
 *
 *   npm run release -- --dry-run              what would go out; preflight of all of it; nothing published
 *   npm run release -- --dry-run --only olx   the same for some packages
 *   npm run release -- --stamp                writes today's date into the CHANGELOG headings of the
 *                                             versions about to go out (commit and push that first)
 *   npm run release                           the release
 *   npm run release -- --only olx,allegro     a part of it
 *
 * A real release needs: a clean working tree, branch main equal to
 * origin/main, `npm whoami` = koda-plus, every package to release preflighted
 * (tests, types, build, tarball contents) BEFORE the first publish, and a
 * CHANGELOG heading with a date for its version. A package whose version is
 * already on npm is skipped, unless its code changed since that version was
 * tagged (then the version must be bumped first). After each publish the
 * script tags `<name>@<version>`, waits until `latest` points at it (the
 * first publish of a new package shows the 0.0.0-stage placeholder for a few
 * minutes) and in the end pushes the tags, never a branch.
 *
 * Every `npm publish` waits for the 2FA confirmation in the browser (the link
 * npm prints). A run stopped halfway can simply be started again.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { listPackages, root, selectPackages } from "./lib/packages.mjs"

const NPM_USER = "koda-plus"
const RELEASE_ORDER = ["olx", "allegro", "baselinker", "subiekt", "fakturownia", "negotiations", "emails", "inpost", "stripe", "tasks"]

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const dryRun = flag("--dry-run")
const stamp = flag("--stamp")
const onlyAt = argv.indexOf("--only")
const only = onlyAt >= 0 ? new Set(String(argv[onlyAt + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)) : null

/* Every argument below is a fixed token or a validated package name and version (lib/packages.mjs). */
const run = (cmd, cwd = root, quiet = true) => spawnSync(cmd, { cwd, shell: true, stdio: quiet ? "pipe" : "inherit", encoding: "utf8" })
const out = (cmd, cwd = root) => {
  const r = run(cmd, cwd)
  return r.status === 0 ? String(r.stdout ?? "").trim() : null
}

const packages = selectPackages(listPackages(), only).sort((a, b) => {
  const ia = RELEASE_ORDER.indexOf(a.ns)
  const ib = RELEASE_ORDER.indexOf(b.ns)
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.ns.localeCompare(b.ns)
})

const tagOf = (p) => `${p.name}@${p.version}`
const today = new Date().toISOString().slice(0, 10)

/* ------------------------------------------------------------------ */
/* What is on npm, what changed                                        */
/* ------------------------------------------------------------------ */

function onNpm(p) {
  return out(`npm view ${p.name}@${p.version} version`) === p.version
}

function changedSincePublished(p) {
  const tag = tagOf(p)
  if (out(`git rev-parse -q --verify "refs/tags/${tag}"`)) {
    return run(`git diff --quiet "${tag}" HEAD -- "packages/${p.dir}"`).status !== 0
  }
  const head = out(`npm view ${p.name}@${p.version} gitHead`)
  if (head && /^[0-9a-f]{7,40}$/.test(head) && out(`git cat-file -t ${head}`) === "commit") {
    return run(`git diff --quiet ${head} HEAD -- "packages/${p.dir}"`).status !== 0
  }
  return null
}

function changelogState(p) {
  const file = path.join(p.path, "CHANGELOG.md")
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  const v = p.version.replace(/\./g, "\\.")
  if (new RegExp(`^## ${v} \\(\\d{4}-\\d{2}-\\d{2}\\)`, "m").test(text)) return "dated"
  if (new RegExp(`^## ${v} \\(unreleased\\)`, "m").test(text)) return "unreleased"
  return "missing"
}

/* ------------------------------------------------------------------ */
/* Preflight                                                           */
/* ------------------------------------------------------------------ */

const FORBIDDEN_IN_TARBALL = [/^test\//, /^docs\//, /(^|\/)\.env/, /\.map$/, /medusa-plugin-options\.json$/, /^src\//]

function preflight(p) {
  const problems = []
  for (const script of ["test", "typecheck", "build"]) {
    console.log(`  ${p.dir}: npm run ${script}`)
    const r = run(`npm run ${script}`, p.path)
    if (r.status !== 0) {
      problems.push(`npm run ${script} failed:\n${String(r.stdout ?? "").slice(-1500)}${String(r.stderr ?? "").slice(-800)}`)
      return problems
    }
  }
  const packed = run("npm pack --dry-run --json --ignore-scripts", p.path)
  let files = []
  try {
    files = JSON.parse(packed.stdout)[0].files.map((f) => f.path)
  } catch {
    problems.push("npm pack --dry-run did not answer JSON")
    return problems
  }
  for (const need of [".medusa/server/src/admin/index.mjs", ".medusa/server/src/admin/index.js", "README.md", "CHANGELOG.md", "LICENSE", "package.json"]) {
    if (!files.includes(need)) problems.push(`the tarball lacks ${need}`)
  }
  if (!files.some((f) => f.endsWith(".d.ts"))) problems.push("the tarball has no type declarations (.d.ts)")
  const bad = files.filter((f) => FORBIDDEN_IN_TARBALL.some((re) => re.test(f)))
  if (bad.length) problems.push(`the tarball must not carry: ${bad.slice(0, 10).join(", ")}`)
  const readme = fs.readFileSync(path.join(p.path, "README.md"), "utf8").replace(/^```[\s\S]*?^```/gm, "")
  const relative = [...readme.matchAll(/\]\((?!https?:\/\/|#|mailto:)[^)\s]+\)/g)].map((m) => m[0])
  if (relative.length) problems.push(`README links must be absolute (npm and medusajs.com show it outside the repo): ${relative.slice(0, 3).join(" ")}`)
  return problems
}

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

const blockers = []
const status = out("git status --porcelain")
if (status) blockers.push("the working tree is not clean (commit or stash first)")
const branch = out("git rev-parse --abbrev-ref HEAD")
if (branch !== "main") blockers.push(`the branch is ${branch}, not main`)
run("git fetch -q origin main")
const head = out("git rev-parse HEAD")
const remote = out("git rev-parse origin/main")
if (!remote || head !== remote) blockers.push("HEAD is not origin/main (push first, or pull)")
/* In GitHub Actions with an OIDC token, npm publishes through the trusted publisher: no login, provenance on. */
const trusted = process.env.GITHUB_ACTIONS === "true" && Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL)
const user = trusted ? NPM_USER : out("npm whoami")
if (user !== NPM_USER) blockers.push(user ? `npm user is ${user}, not ${NPM_USER}` : `not logged in to npm (npm login as ${NPM_USER})`)

const toRelease = []
const refused = []
console.log(`Packages (${packages.length}):`)
for (const p of packages) {
  if (onNpm(p)) {
    const changed = changedSincePublished(p)
    if (changed === true) {
      refused.push(`${tagOf(p)} is on npm but packages/${p.dir} changed since: bump the version and add a CHANGELOG entry`)
      console.log(`  ${tagOf(p)}: on npm, CODE CHANGED SINCE (needs a new version)`)
    } else {
      console.log(`  ${tagOf(p)}: on npm${changed === null ? " (no tag or gitHead to compare)" : ""}, skipped`)
    }
    continue
  }
  const log = changelogState(p)
  console.log(`  ${tagOf(p)}: to publish (CHANGELOG ${log})`)
  if (log === "missing") refused.push(`${tagOf(p)}: CHANGELOG.md has no "## ${p.version}" heading`)
  toRelease.push({ p, log })
}

if (stamp) {
  for (const { p, log } of toRelease) {
    if (log !== "unreleased") continue
    const file = path.join(p.path, "CHANGELOG.md")
    const text = fs.readFileSync(file, "utf8").replace(`## ${p.version} (unreleased)`, `## ${p.version} (${today})`)
    fs.writeFileSync(file, text)
    console.log(`stamped ${p.dir}/CHANGELOG.md: ## ${p.version} (${today})`)
  }
  console.log("\nCommit and push the dated CHANGELOGs, then run npm run release.")
  process.exit(0)
}

for (const { p, log } of toRelease) if (log === "unreleased") (dryRun ? blockers : refused).push(`${tagOf(p)}: CHANGELOG says "(unreleased)": run npm run release -- --stamp, commit, push`)

console.log(`\nPreflight of ${toRelease.length} package(s):`)
for (const { p } of toRelease) {
  const problems = preflight(p)
  if (problems.length) refused.push(...problems.map((x) => `${p.dir}: ${x}`))
  else console.log(`  ${p.dir}: ok`)
}

if (dryRun) {
  console.log("\nDRY RUN: nothing published.")
  if (blockers.length) console.log(`A real release would stop here:\n- ${blockers.join("\n- ")}`)
  if (refused.length) {
    console.error(`\nTo fix before releasing:\n- ${refused.join("\n- ")}`)
    process.exit(1)
  }
  console.log(toRelease.length ? `\nReady: ${toRelease.map(({ p }) => tagOf(p)).join(", ")}` : "\nNothing new to publish.")
  process.exit(0)
}

if (blockers.length || refused.length) {
  console.error(`\nNot released:\n- ${[...blockers, ...refused].join("\n- ")}`)
  process.exit(1)
}

/* ------------------------------------------------------------------ */
/* Release                                                             */
/* ------------------------------------------------------------------ */

const tags = []
for (const { p } of toRelease) {
  console.log(`\n= publishing ${tagOf(p)} (confirm in the browser when npm asks)`)
  const r = run(`npm publish --access public${trusted ? " --provenance" : ""}`, p.path, false)
  if (r.status !== 0) {
    console.error(`\n${tagOf(p)} was not published (exit ${r.status}). Fix the cause and run npm run release again: published versions are skipped.`)
    break
  }
  const tag = tagOf(p)
  if (run(`git tag "${tag}"`).status === 0) tags.push(tag)
  let latest = null
  for (let i = 0; i < 30; i++) {
    latest = out(`npm view ${p.name} dist-tags.latest`)
    if (latest === p.version) break
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 20000)"])
  }
  if (latest !== p.version) console.warn(`  ! ${p.name}: latest is ${latest ?? "unknown"} after 10 minutes, not ${p.version}. Check npm view ${p.name} dist-tags.`)
  else console.log(`  ${p.name}: latest = ${p.version}`)
}

if (tags.length) {
  const pushed = run(`git push origin ${tags.map((t) => `"refs/tags/${t}"`).join(" ")}`, root, false)
  if (pushed.status !== 0) console.warn(`Tags not pushed; push them by hand: git push origin ${tags.join(" ")}`)
}
console.log(`\nPublished: ${tags.length ? tags.join(", ") : "nothing"}`)
