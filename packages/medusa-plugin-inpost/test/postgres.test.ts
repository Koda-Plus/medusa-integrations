/**
 * THE SQL AGAINST A REAL POSTGRES, when one is given. Skipped otherwise, so
 * `npm test` needs no database.
 *
 *   INPOST_TEST_PG_URL=postgres://user:pass@localhost:5432/scratch npm test
 *
 * Everything happens in a schema of its own (`inpost_test_<random>`, dropped
 * at the end), never in the tables of the database it connects to. The
 * scenario is in `pg-scenario.ts`.
 */
import { test } from "node:test"
import { createRequire } from "node:module"
import { pgScenario } from "./pg-scenario.ts"

const url = process.env.INPOST_TEST_PG_URL

test("the migration and every statement of the store on a real Postgres", { skip: url ? false : "set INPOST_TEST_PG_URL to run it" }, async () => {
  const require = createRequire(import.meta.url)
  const knexFactory = require("knex")
  const schema = `inpost_test_${Math.random().toString(36).slice(2, 10)}`
  const admin = knexFactory({ client: "pg", connection: url })
  const db = knexFactory({ client: "pg", connection: url, searchPath: [schema] })
  try {
    await pgScenario({
      sql: db,
      async reset() {
        await admin.raw(`drop schema if exists "${schema}" cascade`)
        await admin.raw(`create schema "${schema}"`)
      },
    })
  } finally {
    await db.destroy()
    await admin.raw(`drop schema if exists "${schema}" cascade`)
    await admin.destroy()
  }
})
