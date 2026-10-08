/**
 * Lets `node --experimental-strip-types --test` load the plugin sources as
 * they are. The sources import each other without extensions (TypeScript
 * style, required by the Medusa build); this hook tries `<specifier>.ts`
 * and `<specifier>/index.ts` for relative imports Node cannot resolve.
 */
import { register } from "node:module"

register("./ts-resolve-hooks.mjs", import.meta.url)
