import { defineMiddlewares } from "@medusajs/framework/http"

/**
 * The bridge webhook needs the exact bytes of the body to check the HMAC,
 * so the JSON parser keeps the raw body for this one route.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/hooks/subiekt",
      method: ["POST"],
      bodyParser: { preserveRawBody: true },
    },
  ],
})
