import * as assert from '@remix-run/assert'
import { describe, it } from '@std/testing/bdd'

import { createD1HttpClient } from './http.ts'

type Call = { url: string; init: RequestInit }

function mockFetch(respond: (body: unknown) => unknown, status = 200) {
  let calls: Call[] = []
  let fetch = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! })
    let body = JSON.parse(String(init!.body))
    return Promise.resolve(new Response(JSON.stringify(respond(body)), { status }))
  }
  return { calls, fetch: fetch as typeof globalThis.fetch }
}

const options = { accountId: 'acc', databaseId: 'db-id', apiToken: 'secret' }

describe('createD1HttpClient', () => {
  it('posts a statement with its params and returns the first result', async () => {
    let { calls, fetch } = mockFetch(() => ({
      success: true,
      result: [{ results: [{ id: 1 }], meta: { changes: 0, last_row_id: 0 }, success: true }],
    }))
    let client = createD1HttpClient({ ...options, fetch })

    let result = await client.prepare('select * from t where id = ?').bind(1).all()

    assert.deepEqual(result.results, [{ id: 1 }])
    assert.equal(
      calls[0].url,
      'https://api.cloudflare.com/client/v4/accounts/acc/d1/database/db-id/query',
    )
    assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer secret')
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      sql: 'select * from t where id = ?',
      params: [1],
    })
  })

  it('sends a batch in one request', async () => {
    let { calls, fetch } = mockFetch((body) => ({
      success: true,
      result: (body as { batch: unknown[] }).batch.map(() => ({
        results: [],
        meta: { changes: 1 },
      })),
    }))
    let client = createD1HttpClient({ ...options, fetch })

    let results = await client.batch([
      client.prepare('insert into t values (?)').bind(1),
      client.prepare('insert into t values (?)').bind(2),
    ])

    assert.equal(calls.length, 1)
    assert.equal(results.length, 2)
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      batch: [
        { sql: 'insert into t values (?)', params: [1] },
        { sql: 'insert into t values (?)', params: [2] },
      ],
    })
  })

  it('throws the API errors', async () => {
    let { fetch } = mockFetch(
      () => ({ success: false, errors: [{ code: 7500, message: 'no such table: t' }] }),
      400,
    )
    let client = createD1HttpClient({ ...options, fetch })

    await assert.rejects(client.prepare('select * from t').all(), /HTTP 400\): no such table: t/)
  })
})
