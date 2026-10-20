/** An error of a coupon write that the route answers in words, with the admin's error keys. */
export class CouponInputError extends Error {
  readonly status: number
  readonly errors: string[]
  constructor(status: number, errors: string[], message: string) {
    super(message)
    this.name = "CouponInputError"
    this.status = status
    this.errors = errors
  }
}
