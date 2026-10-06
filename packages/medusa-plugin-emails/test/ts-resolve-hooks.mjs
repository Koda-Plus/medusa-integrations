const RELATIVE = /^\.{1,2}\//
const HAS_EXTENSION = /\.[cm]?[jt]sx?$|\.json$/

export async function resolve(specifier, context, next) {
  if (RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier)) {
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        return await next(candidate, context)
      } catch {
        /* try the next candidate */
      }
    }
  }
  return next(specifier, context)
}
