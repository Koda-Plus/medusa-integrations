export { sendEmailWorkflow, sendEmailStep, sendAbandonedCartsWorkflow } from "./emails/workflows"
export type { SendEmailWorkflowInput } from "./emails/workflows"
export { sendTemplate } from "./emails/send-template"
export type { SendTemplateInput, SendOutcome } from "./emails/send-template"
/* koda.integration/1: the three handlers and their builders, for a host that answers in-process. */
export { emailsIntegration } from "./emails/integration"
export type { EntitySummary, EntitySummaryBatch, AttentionResponse, IntegrationManifest } from "../modules/emails/lib/kit-contract"
