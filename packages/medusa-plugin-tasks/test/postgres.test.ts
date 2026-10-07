/**
 * THE SQL AGAINST A REAL POSTGRES, when one is given. Skipped otherwise, so
 * `npm test` needs no database.
 *
 *   TASKS_TEST_PG_URL=postgres://user:pass@localhost:5432/scratch npm test
 *
 * Everything happens in a schema of its own (`tasks_test_<random>`, dropped
 * at the end), never in the tables of the database it connects to. The
 * scenario is in `pg-scenario.ts`: the adoption of two copies of the KODA
 * Panel module (twice), a foreign `task` table, a fresh database, every
 * statement of the stores and the sandbox.
 */
import { test } from "node:test"
import { createRequire } from "node:module"
import { pgScenario } from "./pg-scenario.ts"

const url = process.env.TASKS_TEST_PG_URL

test("the migration and every statement on a real Postgres", { skip: url ? false : "set TASKS_TEST_PG_URL to run it" }, async () => {
  const require = createRequire(import.meta.url)
  const knexFactory = require("knex")
  const schema = `tasks_test_${Math.random().toString(36).slice(2, 10)}`
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
