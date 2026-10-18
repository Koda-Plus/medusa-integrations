/** A refusal of a flow with its HTTP status and a stable code (InPost's `error_code`, the store's `code`). */
export class InpostPayFlowError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "InpostPayFlowError"
    this.status = status
    this.code = code
  }
}
