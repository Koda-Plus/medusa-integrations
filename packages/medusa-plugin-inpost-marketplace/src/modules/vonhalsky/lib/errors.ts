/** A refusal of a flow with its HTTP status and a stable code the admin can translate. */
export class VonHalskyFlowError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "VonHalskyFlowError"
    this.status = status
    this.code = code
  }
}
