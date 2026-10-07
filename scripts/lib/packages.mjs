/**
 * The one list of packages: every packages/<dir>/package.json with a `koda`
 * block. Scripts read it from here instead of keeping their own lists.
 *
 *   "koda": { "ns": "inpost", "moduleDir": "inpost", "brand": "InPost",
 *             "title": "InPost by Koda Plus", "kind": "integration",
 *             "catalog": "shipping" }
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
export const packagesDir = path.join(root, "packages")

const NAME = /^@koda-plus\/medusa-plugin-[a-z][a-z-]*$/
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
const NS = /^[a-z][a-z0-9]*$/

/** @returns {Array<{ dir: string, path: string, name: string, version: string, ns: string, moduleDir: string, brand: string, title: string, kind: "integration"|"module", catalog: string|null, json: any }>} */
export function listPackages() {
  return fs
    .readdirSync(packagesDir)
    .filter((d) => fs.existsSync(path.join(packagesDir, d, "package.json")))
    .sort()
    .map((dir) => {
      const file = path.join(packagesDir, dir, "package.json")
      const json = JSON.parse(fs.readFileSync(file, "utf8"))
      const k = json.koda ?? {}
      if (!NAME.test(json.name ?? "")) throw new Error(`${dir}: package name "${json.name}" is not @koda-plus/medusa-plugin-<name>`)
      if (!VERSION.test(json.version ?? "")) throw new Error(`${dir}: version "${json.version}" is not semver`)
      if (!NS.test(k.ns ?? "") || !NS.test(k.moduleDir ?? "")) throw new Error(`${dir}: package.json needs koda.ns and koda.moduleDir (lowercase letters and digits)`)
      return {
        dir,
        path: path.join(packagesDir, dir),
        name: json.name,
        version: json.version,
        ns: k.ns,
        moduleDir: k.moduleDir,
        brand: k.brand ?? k.ns,
        title: k.title ?? json.name,
        kind: k.kind === "module" ? "module" : "integration",
        catalog: k.catalog ?? null,
        json,
      }
    })
}

/** `--only olx,allegro` (namespaces or directory names) narrows the list. */
export function selectPackages(all, only) {
  if (!only || only.size === 0) return all
  const picked = all.filter((p) => only.has(p.ns) || only.has(p.dir) || only.has(p.dir.replace(/^medusa-plugin-/, "")))
  const known = new Set(all.flatMap((p) => [p.ns, p.dir, p.dir.replace(/^medusa-plugin-/, "")]))
  const unknown = [...only].filter((x) => !known.has(x))
  if (unknown.length) throw new Error(`unknown package(s): ${unknown.join(", ")}`)
  return picked
}
