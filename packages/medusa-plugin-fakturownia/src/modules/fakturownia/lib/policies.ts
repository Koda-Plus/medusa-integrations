/**
 * RBAC POLICIES OF THE FAKTUROWNIA ROUTES. Zero imports: `src/api/middlewares.ts`
 * puts them on the routes, `src/policies/fakturownia-policies.ts` defines them
 * for the roles screen. Medusa checks them only with its `rbac` feature flag
 * on (2.15 and newer); older versions and stores without the flag ignore
 * them, and the admin works as before.
 *
 *   read     every page and card of the plugin (documents, corrections, e-mails, runs)
 *   update   issue, retry, check and mark documents, run the background passes,
 *            plan or close corrections, check the connection, the demo data
 *   approve  approve a correction plan: a correction invoice is an accounting
 *            document that goes to KSeF
 *   send     e-mail a document or a reminder to any address, send a document
 *            to KSeF again
 *   manage   turn the writers (corrections, e-mails, KSeF) on and off
 *
 * A write needs `update` and, for the four routes above, its own operation too.
 */

export const POLICY_RESOURCE = "fakturownia"

export type PolicyOperationName = "read" | "update" | "approve" | "send" | "manage"

export const POLICY: Record<PolicyOperationName, { resource: string; operation: PolicyOperationName }> = {
  read: { resource: POLICY_RESOURCE, operation: "read" },
  update: { resource: POLICY_RESOURCE, operation: "update" },
  approve: { resource: POLICY_RESOURCE, operation: "approve" },
  send: { resource: POLICY_RESOURCE, operation: "send" },
  manage: { resource: POLICY_RESOURCE, operation: "manage" },
}

/** The definitions for `definePolicies`: name, resource, operation and what it allows. */
export const POLICY_DEFINITIONS: ReadonlyArray<{ name: string; resource: string; operation: PolicyOperationName; description: string }> = [
  { name: "ReadFakturownia", resource: POLICY_RESOURCE, operation: "read", description: "See Fakturownia documents, corrections, e-mails and background runs" },
  { name: "UpdateFakturownia", resource: POLICY_RESOURCE, operation: "update", description: "Issue, retry, check and mark Fakturownia documents; run the background passes" },
  { name: "ApproveFakturowniaCorrections", resource: POLICY_RESOURCE, operation: "approve", description: "Approve correction invoices (accounting documents that go to KSeF)" },
  { name: "SendFakturowniaDocuments", resource: POLICY_RESOURCE, operation: "send", description: "E-mail documents and payment reminders, send documents to KSeF again" },
  { name: "ManageFakturowniaWriters", resource: POLICY_RESOURCE, operation: "manage", description: "Turn the Fakturownia writers (corrections, e-mails, KSeF) on and off" },
]
