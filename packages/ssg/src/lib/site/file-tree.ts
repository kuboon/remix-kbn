/**
 * A directory, served — with transforms for the files that are not served verbatim.
 *
 * A site's `router.ts` mounts one of these wherever it wants a directory answered from: the static
 * files it ships as they sit, and anything a transform claims rendered on the way out. A transform
 * arrives from the site, which is what keeps a content format and its dependencies out of this
 * package — this module knows how to *find* a file, never how to render one.
 */

import * as path from 'node:path'

import { joinBase, normalizeBase } from './base.ts'

/** A directory, ready to answer requests under its mount point. */
export interface FileTree {
  /** Public mount point, without a trailing slash. `''` mounts at the root. */
  readonly basePath: string
  /**
   * Answers one request.
   *
   * @param request The incoming request
   * @returns The response, or a `404` when the tree serves nothing there
   */
  fetch(request: Request): Promise<Response>
  /**
   * Every path this tree can serve.
   *
   * Informational — the build is seeded with entry points and finds the rest by following links,
   * so a page listed here that nothing links to is not part of the site. Useful for diagnostics,
   * and for a caller that wants to seed something deliberately.
   */
  paths(): Iterable<string>
  /** Rescans the directory. */
  reload(): Promise<void>
}

/** A file in the tree, as a transform sees it. */
export interface SourceFile {
  /**
   * Path under the tree's root, with `/` separators — the file's identity here.
   *
   * This is what `match` and `path` are given, so a transform naming something after the file
   * (a slug, a title fallback, an error message) uses the same string they did.
   */
  readonly path: string
  /**
   * Where to read it from.
   *
   * A `file:` URL rather than a path, because both things a transform does with it take one:
   * `Deno.readTextFile(url)` and `import(url.href)` — and neither has to get the escaping right
   * on its own.
   */
  readonly url: URL
}

/** Renders the files it claims. */
export interface FileTransform {
  /**
   * Whether this transform handles a file.
   *
   * @param relativePath Path under the tree's root, with `/` separators
   */
  match(relativePath: string): boolean
  /**
   * The URL path the file is served at, relative to the mount point.
   *
   * Derived from the path alone, and cheaply: the tree needs every route before anything is
   * rendered, so this may not read the file. That is also why this and {@link match} are handed a
   * plain string — they answer questions about the name, and {@link render} is the only one that
   * opens anything.
   *
   * @param relativePath Path under the tree's root
   * @returns A path starting with `/`
   */
  path(relativePath: string): string
  /**
   * Renders one file.
   *
   * A `Response`, so a transform says what it means in the vocabulary it is already holding —
   * whatever its renderer returns — instead of unwrapping one into a body and a content type for
   * the tree to wrap up again. Status and headers are carried through; the tree reads the body
   * once, keeps the bytes, and answers from those.
   *
   * @param file The file: its path in the tree, and where to read it
   * @returns The response to serve at this file's path
   */
  render(file: SourceFile): Promise<Response>
}

/** Options for {@link createFileTree}. */
export interface FileTreeOptions {
  /** Directory to serve. */
  rootDir: string
  /** Public mount point, without a trailing slash. Defaults to `''`. */
  basePath?: string
  /** Transforms, in priority order. Files no transform claims are served verbatim. */
  transforms?: readonly FileTransform[]
  /** `Cache-Control` for served files. Defaults to `'no-cache'`. */
  cacheControl?: string
}

interface Entry {
  file: SourceFile
  transform?: FileTransform
}

/** One path's response, read into bytes so it can be hashed and served more than once. */
interface Rendered {
  body: Uint8Array<ArrayBuffer>
  status: number
  headers: Headers
  etag: string
}

/**
 * Serves a directory as part of a site.
 *
 * @param options Where the directory is, where it mounts, and how to render it
 * @returns The tree, for a route to hand requests to
 *
 * @example
 * ```ts
 * let staticFiles = await createFileTree({
 *   rootDir: `${import.meta.dirname}/../client/static`,
 *   basePath: `${base}/static`,
 * })
 *
 * router.map(`${base}/static/*path`, ({ request }) => staticFiles.fetch(request))
 * ```
 */
export async function createFileTree(options: FileTreeOptions): Promise<FileTree> {
  let rootDir = path.resolve(options.rootDir)
  let basePath = normalizeBase(options.basePath)
  let cacheControl = options.cacheControl ?? 'no-cache'
  let transforms = options.transforms ?? []

  let entries = new Map<string, Entry>()
  let rendered = new Map<string, Rendered>()

  async function scan(): Promise<void> {
    entries.clear()
    rendered.clear()

    for (let relativePath of await walk(rootDir, rootDir)) {
      let transform = transforms.find((candidate) => candidate.match(relativePath))
      let servedAt = transform
        ? joinBase(basePath, transform.path(relativePath))
        : joinBase(basePath, `/${relativePath}`)

      let existing = entries.get(servedAt)
      if (existing !== undefined) {
        throw new Error(
          `Two files in "${rootDir}" are served at "${servedAt}": ` +
            `"${existing.file.path}" and "${relativePath}".`,
        )
      }

      entries.set(servedAt, {
        file: { path: relativePath, url: fileUrl(path.join(rootDir, relativePath)) },
        transform,
      })
    }
  }

  await scan()

  return {
    basePath,

    async fetch(request: Request): Promise<Response> {
      let pathname = decodeURIComponent(new URL(request.url).pathname)
      let entry = entries.get(pathname) ?? entries.get(pathname.replace(/\/$/, ''))
      if (entry === undefined) return notFound()

      let cached = rendered.get(pathname)
      if (cached === undefined) {
        // A response body is read once, so the tree reads it here and keeps the bytes: an etag
        // has to hash them, and every later request for this path is answered from them.
        let produced = entry.transform
          ? await entry.transform.render(entry.file)
          : new Response(await Deno.readFile(entry.file.url), {
            headers: { 'content-type': contentTypeFor(entry.file.path) },
          })

        let body = new Uint8Array(await produced.arrayBuffer())
        cached = {
          body,
          status: produced.status,
          headers: produced.headers,
          etag: await etagFor(body),
        }
        rendered.set(pathname, cached)
      }

      if (request.headers.get('if-none-match') === cached.etag) {
        return new Response(null, {
          status: 304,
          headers: { etag: cached.etag, 'cache-control': cacheControl },
        })
      }

      let headers = new Headers(cached.headers)
      headers.set('etag', cached.etag)
      headers.set('cache-control', cacheControl)

      return new Response(request.method === 'HEAD' ? null : cached.body, {
        status: cached.status,
        headers,
      })
    },

    paths(): Iterable<string> {
      return entries.keys()
    },

    reload: scan,
  }
}

/** A `file:` URL for an absolute path, with every segment escaped. */
function fileUrl(absolutePath: string): URL {
  let url = new URL('file://')
  url.pathname = absolutePath.split('/').map(encodeURIComponent).join('/')
  return url
}

function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

/** Every file under a directory, as paths relative to it. Dotfiles are skipped. */
async function walk(directory: string, root: string): Promise<string[]> {
  let found: string[] = []

  let entries: Deno.DirEntry[]
  try {
    entries = await Array.fromAsync(Deno.readDir(directory))
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return []
    throw error
  }

  for (let entry of entries) {
    if (entry.name.startsWith('.')) continue

    let entryPath = path.join(directory, entry.name)
    if (entry.isDirectory) found.push(...await walk(entryPath, root))
    else found.push(path.relative(root, entryPath))
  }

  return found.sort()
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
}

function contentTypeFor(relativePath: string): string {
  return CONTENT_TYPES[path.extname(relativePath).toLowerCase()] ?? 'application/octet-stream'
}

async function etagFor(bytes: Uint8Array): Promise<string> {
  let digest = await crypto.subtle.digest('SHA-1', bytes as BufferSource)
  let hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `"${hex}"`
}
