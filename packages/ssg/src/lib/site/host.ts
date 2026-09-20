/**
 * How the *host* turns a URL into a file.
 *
 * A static host is the last piece of routing in the stack and the one this package does not
 * control: GitHub Pages serves `/about` from `about.html`, falls back to `about/index.html` with a
 * redirect, and 404s `/about/` when only the former exists. Vercel, Netlify and S3 each answer
 * differently. Where the build writes each page depends on getting it right, so the rule is one
 * swappable object a site names in `router.ts` rather than a convention buried in the build.
 *
 * The shape follows [`@kuboon/file-server-behavior`](https://jsr.io/@kuboon/file-server-behavior),
 * which derives these rules from
 * [trailing-slash-guide](https://github.com/slorber/trailing-slash-guide). It is small enough to
 * state here rather than depend on, and a structural match, so that package's implementations can
 * be passed in directly.
 */

/** A redirect the host would issue, conditional on `path` existing when it is given. */
export interface Redirect {
  /** URL path to redirect to, as it sits in the deployed artifact. */
  target: string
  /** File whose existence the redirect depends on. Unconditional when omitted. */
  path?: string
}

/** A host's URL-to-file rule. */
export interface FileServerBehavior {
  /**
   * The files that could answer a URL, in the order the host tries them.
   *
   * @param urlPath The request path within the deployed artifact, starting with `/`
   * @returns Candidates: a string is a file to serve if it exists, a {@link Redirect} is a redirect
   *   to issue if its `path` exists
   */
  toLocalPaths(urlPath: string): (string | Redirect)[]
}

function hasExtension(urlPath: string): boolean {
  return urlPath.slice(urlPath.lastIndexOf('/') + 1).includes('.')
}

/**
 * GitHub Pages' rule, and this package's default.
 *
 * - `/dir/` serves `/dir/index.html`
 * - `/file.html`, or anything with an extension, is served as it is
 * - `/file` serves `/file.html`, or redirects to `/file/` when `/file/index.html` exists instead
 *
 * The last line is why the build writes `about.html` rather than `about/index.html`: a site whose
 * links say `/about` then costs no redirect.
 *
 * @returns The behavior
 */
export function githubPages(): FileServerBehavior {
  return {
    toLocalPaths(urlPath: string): (string | Redirect)[] {
      if (urlPath.endsWith('/')) return [`${urlPath}index.html`]
      if (hasExtension(urlPath)) return [urlPath]
      return [`${urlPath}.html`, { target: `${urlPath}/`, path: `${urlPath}/index.html` }]
    },
  }
}

/**
 * The file a URL is written to: the first candidate the host would actually serve.
 *
 * @param behavior The host's rule
 * @param urlPath The path within the artifact, starting with `/`
 * @returns The file path, starting with `/`
 */
export function outputPathFor(behavior: FileServerBehavior, urlPath: string): string {
  for (let candidate of behavior.toLocalPaths(urlPath)) {
    if (typeof candidate === 'string') return candidate
  }

  return urlPath
}
