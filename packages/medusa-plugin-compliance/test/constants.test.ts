import { test } from "node:test"
import assert from "node:assert/strict"
import { isConsentPurpose, isDsrStatus, isDsrType, isOperatorKind } from "../src/modules/compliance/lib/constants.ts"

test("constants: the operator kinds take only the known values", () => {
  assert.equal(isOperatorKind("manufacturer"), true)
  assert.equal(isOperatorKind("responsible_person"), true)
  assert.equal(isOperatorKind("importer"), true)
  assert.equal(isOperatorKind("authorized_representative"), true)
  assert.equal(isOperatorKind("seller"), false)
  assert.equal(isOperatorKind(""), false)
  assert.equal(isOperatorKind(42), false)
  assert.equal(isOperatorKind(null), false)
})

test("constants: consent purposes, DSR types and statuses are a closed list", () => {
  for (const p of ["necessary", "functional", "analytics", "marketing"]) assert.equal(isConsentPurpose(p), true)
  assert.equal(isConsentPurpose("ads"), false)
  assert.equal(isConsentPurpose(undefined), false)
  for (const t of ["access", "erasure", "portability", "restriction", "objection", "rectification"]) assert.equal(isDsrType(t), true)
  assert.equal(isDsrType("delete"), false)
  for (const s of ["pending", "in_progress", "completed", "rejected"]) assert.equal(isDsrStatus(s), true)
  assert.equal(isDsrStatus("done"), false)
})
