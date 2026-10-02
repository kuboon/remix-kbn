/**
 * Public URL assignment.
 *
 * The singleton guarantee lives here. A module is shared across client entries only if every
 * importer names it by the *same URL* — that is what makes the browser's module registry evaluate
 * it once. So the registry enforces a bijection: one resolved specifier gets exactly one public
 * path, and no two specifiers may collide onto one path.
 */

/**
 * Source extensions rewritten to `.js`, since that is what the server emits.
 *
 * `.cjs` and `.cts` are in here for a reason beyond tidiness: a CommonJS module is served *wrapped
 * as an ES module*, so a URL still ending in `.cjs` would advertise a format the body no longer has,
 * and a client that trusts the extension rejects it.
 */
const COMPILED_EXTENSIONS = ['.tsx', '.ts', '.mts', '.cts', '.jsx', '.mjs', '.cjs']

/**
 * A two-way map between resolved specifiers and the public paths they are served at.
 *
 * Paths are readable by construction (`/assets/app/session.js`, `/assets/jsr/@kuboon/dpop/0.1.2/
 * client/mod.js`) so a browser stack trace points at something recognizable, and a short hash is
 * appended only when two different specifiers want the same path.
 */
export class PathRegistry {
  #basePath: string
  #pathByKey = new Map<string, string>()
  #keyByPath = new Map<string, string>()

  /**
   * @param basePath Public mount point, e.g. `'/assets'`. A trailing slash is ignored.
   */
  constructor(basePath: string) {
    this.#basePath = normalizeBasePath(basePath)
  }

  /** The normalized mount point, without a trailing slash. */
  get basePath(): string {
    return this.#basePath
  }

  /**
   * Assigns a public path to a key, or returns the one already assigned.
   *
   * @param key The resolved specifier (or absolute disk path) being served
   * @param candidate Preferred path relative to the base path, from {@link candidatePathFor}
   * @returns The public path, including the base path
   */
  register(key: string, candidate: string): string {
    let existing = this.#pathByKey.get(key)
    if (existing !== undefined) return existing

    let relative = uniqueRelativePath(candidate, key, (path) => this.#keyByPath.has(path))
    let publicPath = `${this.#basePath}/${relative}`

    this.#pathByKey.set(key, publicPath)
    this.#keyByPath.set(relative, key)

    return publicPath
  }

  /** The public path assigned to a key, or `undefined` when it was never registered. */
  pathFor(key: string): string | undefined {
    return this.#pathByKey.get(key)
  }

  /**
   * The key served at a public path.
   *
   * @param publicPath A URL pathname, with or without the base path prefix
   * @returns The key, or `undefined` when nothing is served there
   */
  keyFor(publicPath: string): string | undefined {
    let relative = publicPath.startsWith(`${this.#basePath}/`)
      ? publicPath.slice(this.#basePath.length + 1)
      : publicPath.replace(/^\/+/, '')

    return this.#keyByPath.get(relative)
  }

  /** Every assignment, as `key -> public path`. */
  entries(): Map<string, string> {
    return new Map(this.#pathByKey)
  }
}

/**
 * Derives a readable, browser-safe path for a resolved specifier.
 *
 * The shape encodes where a module came from, which makes a devtools network panel legible:
 * `app/...` for your own sources, `jsr/...` for JSR, `npm/...` for npm, `https/...` for anything
 * else fetched over the network.
 *
 * @param specifier The resolved specifier
 * @param options.rootDir Absolute directory that `file:` modules are made relative to
 * @returns A path relative to the base path, with no leading slash
 */
export function candidatePathFor(
  specifier: string,
  options: { rootDir?: string } = {},
): string {
  if (specifier.startsWith('file://')) {
    let filePath = fileUrlToPath(specifier)
    let npmPath = npmRelativePath(filePath)
    if (npmPath) return npmPath

    let rootDir = options.rootDir
    if (rootDir && isInside(filePath, rootDir)) {
      return `app/${toJsExtension(relativeTo(filePath, rootDir))}`
    }

    return `fs/${toJsExtension(sanitizeSegments(filePath))}`
  }

  if (specifier.startsWith('https://jsr.io/')) {
    return `jsr/${toJsExtension(sanitizeSegments(specifier.slice('https://jsr.io/'.length)))}`
  }

  if (specifier.startsWith('npm:')) {
    // `npm:/@remix-run/component@0.4.0/jsx-runtime` and the bare `npm:@remix-run/component@0.4.0` both land here.
    return `npm/${toJsExtension(sanitizeSegments(specifier.slice('npm:'.length)))}`
  }

  if (specifier.startsWith('http://') || specifier.startsWith('https://')) {
    let url = new URL(specifier)
    return `https/${sanitizeSegments(url.host)}/${
      toJsExtension(sanitizeSegments(url.pathname + url.search))
    }`
  }

  return `other/${toJsExtension(sanitizeSegments(specifier))}`
}

/** Rewrites a compiled source extension to `.js`, leaving anything else alone. */
export function toJsExtension(path: string): string {
  for (let extension of COMPILED_EXTENSIONS) {
    if (path.toLowerCase().endsWith(extension)) {
      return `${path.slice(0, path.length - extension.length)}.js`
    }
  }

  return path
}

/** Converts a `file:` URL to an absolute path, tolerating percent-encoding. */
export function fileUrlToPath(specifier: string): string {
  try {
    return decodeURIComponent(new URL(specifier).pathname)
  } catch {
    return specifier
  }
}

const NODE_MODULES = '/node_modules/'

/**
 * Names a file inside `node_modules` by its package-relative path.
 *
 * The *last* `node_modules` segment wins, which is what makes a nested copy read as the package it
 * actually is (`.../a/node_modules/b/index.js` is `b`, not `a`). Deno's layout puts the real files
 * under `node_modules/.deno/<pkg>@<version>/node_modules/<name>/…`, so this yields a clean
 * `npm/<name>/…`. Two versions of one package therefore propose the same path; {@link PathRegistry}
 * resolves that collision, so distinct modules still get distinct URLs.
 */
function npmRelativePath(filePath: string): string | null {
  let index = filePath.lastIndexOf(NODE_MODULES)
  if (index === -1) return null

  let rest = filePath.slice(index + NODE_MODULES.length)
  if (rest === '') return null

  return `npm/${toJsExtension(sanitizeSegments(rest))}`
}

function normalizeBasePath(basePath: string): string {
  let trimmed = basePath.trim().replace(/\/+$/, '')
  if (trimmed === '') return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function isInside(filePath: string, directory: string): boolean {
  let normalized = directory.replace(/\/+$/, '')
  return filePath === normalized || filePath.startsWith(`${normalized}/`)
}

function relativeTo(filePath: string, directory: string): string {
  let normalized = directory.replace(/\/+$/, '')
  return filePath.slice(normalized.length).replace(/^\/+/, '')
}

/**
 * Strips characters that would change how a URL parses (`?`, `#`, `..`) while keeping `/`, so the
 * shape of the original specifier survives.
 */
function sanitizeSegments(value: string): string {
  return value
    .replace(/^\/+/, '')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/[?#\s\\]+/g, '_'))
    .join('/')
}

function uniqueRelativePath(
  candidate: string,
  key: string,
  isTaken: (path: string) => boolean,
): string {
  let base = sanitizeSegments(candidate)
  if (base === '') base = `module-${hash(key)}.js`
  if (!isTaken(base)) return base

  let extension = base.lastIndexOf('.') > base.lastIndexOf('/')
    ? base.slice(base.lastIndexOf('.'))
    : ''
  let stem = extension === '' ? base : base.slice(0, base.length - extension.length)

  // Keyed on the specifier, so a given module keeps the same URL across restarts.
  let disambiguated = `${stem}-${hash(key)}${extension}`
  if (!isTaken(disambiguated)) return disambiguated

  let counter = 2
  while (isTaken(`${stem}-${hash(key)}-${counter}${extension}`)) counter++
  return `${stem}-${hash(key)}-${counter}${extension}`
}

/** FNV-1a, 32-bit. Short, synchronous, and only ever used to break a path collision. */
function hash(value: string): string {
  let result = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 0x01000193)
  }

  return (result >>> 0).toString(16).padStart(8, '0')
}
