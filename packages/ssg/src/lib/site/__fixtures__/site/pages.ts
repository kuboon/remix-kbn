/**
 * The fixture site's pages, as HTML.
 *
 * Hand-written strings rather than a renderer: what is under test is the crawl, the output paths
 * and the deploy prefix, none of which care what produced the markup. A real site renders with
 * `@remix-run/ui` through `@remix-run/render-middleware`, and this package never sees either.
 */

/** Wraps a body in a document that links the stylesheet, so every page has an asset reference. */
function document(base: string, title: string, body: string): string {
  return `<!DOCTYPE html><html><head><title>${title}</title>` +
    `<link rel="stylesheet" href="${base}/static/styles.css">` +
    `</head><body>${body}</body></html>`
}

/** An HTML response, which is what makes the crawler read a page for links. */
export function html(markup: string): Response {
  return new Response(markup, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

/**
 * The home page — the only entry point that is a page, and where every link starts.
 *
 * `/orphan` is deliberately not linked: it is built because `router.ts` names it an entry point.
 * `/hidden` is neither linked nor named, so it is served but never built.
 */
export function home(base: string): string {
  return document(
    base,
    'Home',
    `<h1>Home</h1>
     <a href="${base || '/'}">home</a>
     <a href="${base}/about">about</a>
     <a href="${base}/blog/hello">hello</a>
     <a href="${base}/release%20notes%20%232">release notes</a>
     <a href="https://example.com/elsewhere">off-site</a>
     <script type="module" src="${base}/static/app.js"></script>`,
  )
}

export function about(base: string): string {
  return document(base, 'About', `<h1>About</h1><a href="${base || '/'}">back</a>`)
}

export function hello(base: string): string {
  return document(base, 'Hello', `<h1>Hello</h1><a href="${base || '/'}">back</a>`)
}

export function releaseNotes(base: string): string {
  return document(base, 'Release notes #2', `<h1>Release notes #2</h1>`)
}

export function orphan(base: string): string {
  return document(base, 'Orphan', `<h1>Orphan</h1><a href="${base || '/'}">back</a>`)
}

export function hidden(base: string): string {
  return document(base, 'Hidden', `<h1>Hidden</h1>`)
}
