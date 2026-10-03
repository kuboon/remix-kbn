import type { D1DatabaseBinding, D1PreparedStatementBinding, D1ResultBinding } from './binding.ts'

/** Options for {@link createD1HttpClient}. */
export interface D1HttpClientOptions {
  /** Cloudflare account id. */
  accountId: string
  /** The D1 database's id (`database_id` in the Wrangler config), not its name. */
  databaseId: string
  /** An API token with D1 edit permission. */
  apiToken: string
  /** API origin and prefix. Defaults to `https://api.cloudflare.com/client/v4`. */
  baseUrl?: string
  /** `fetch` to send requests with. Defaults to the global one. */
  fetch?: typeof fetch
}

type Query = { sql: string; params: unknown[] }

type ApiResponse = {
  success: boolean
  errors?: { code?: number; message: string }[]
  result?: D1ResultBinding[]
}

/**
 * A D1 binding over Cloudflare's REST API, for reaching a database from outside a Worker — a
 * migration step in CI, a script, a Deno server in development.
 *
 * Each `all()` is one request to `/d1/database/:id/query`; `batch()` sends its statements in one
 * request as `{ batch: [...] }`, which D1 runs as a single transaction, the same as the binding's
 * `batch()`.
 *
 * Every call is an HTTPS round trip to Cloudflare's API, which is rate limited, so this is for
 * tooling, not for serving traffic. In a Worker, use the binding.
 *
 * @param options Account, database, and API token.
 * @returns A binding accepted by {@link createD1Database}.
 */
export function createD1HttpClient(options: D1HttpClientOptions): D1DatabaseBinding {
  let baseUrl = (options.baseUrl ?? 'https://api.cloudflare.com/client/v4').replace(/\/$/, '')
  let url = baseUrl + '/accounts/' + encodeURIComponent(options.accountId) + '/d1/database/' +
    encodeURIComponent(options.databaseId) + '/query'
  let send = options.fetch ?? fetch

  async function post(body: Query | { batch: Query[] }): Promise<D1ResultBinding[]> {
    let response = await send(url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + options.apiToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    let payload: ApiResponse | undefined
    try {
      payload = await response.json() as ApiResponse
    } catch {
      payload = undefined
    }

    if (!response.ok || !payload?.success) {
      let messages = payload?.errors?.map((error) => error.message).filter(Boolean) ?? []
      throw new Error(
        'D1 query failed (HTTP ' + response.status + ')' +
          (messages.length > 0 ? ': ' + messages.join('; ') : ''),
      )
    }

    return (payload.result ?? []).map((result) => ({
      results: result.results ?? [],
      meta: result.meta ?? {},
    }))
  }

  function statement(query: Query): HttpStatement {
    return {
      query,
      bind(...values: unknown[]) {
        return statement({ sql: query.sql, params: values })
      },
      async all() {
        let results = await post(query)
        return results[0] ?? { results: [], meta: {} }
      },
    }
  }

  return {
    prepare(sql: string) {
      return statement({ sql, params: [] })
    },
    async batch(statements: D1PreparedStatementBinding[]) {
      if (statements.length === 0) return []
      return await post({ batch: statements.map((entry) => toQuery(entry)) })
    },
  }
}

interface HttpStatement extends D1PreparedStatementBinding {
  query: Query
}

function toQuery(statement: D1PreparedStatementBinding): Query {
  let query = (statement as Partial<HttpStatement>).query
  if (!query) {
    throw new Error('createD1HttpClient().batch() only accepts statements from its own prepare()')
  }
  return query
}
