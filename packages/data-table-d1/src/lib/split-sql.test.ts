import * as assert from '@remix-run/assert'
import { describe, it } from '@std/testing/bdd'

import { splitSqlStatements } from './split-sql.ts'

describe('splitSqlStatements', () => {
  it('splits on semicolons and trims', () => {
    assert.deepEqual(splitSqlStatements('create table a (id int);\n  insert into a values (1) ;'), [
      'create table a (id int)',
      'insert into a values (1)',
    ])
  })

  it('keeps a last statement without a semicolon', () => {
    assert.deepEqual(splitSqlStatements('select 1; select 2'), ['select 1', 'select 2'])
  })

  it('ignores semicolons inside quotes and identifiers', () => {
    let script = `insert into "a;b" values ('x;y', 'it''s;', \`c;d\`, [e;f]); select 1`
    assert.deepEqual(splitSqlStatements(script), [
      `insert into "a;b" values ('x;y', 'it''s;', \`c;d\`, [e;f])`,
      'select 1',
    ])
  })

  it('drops comments and comment-only statements', () => {
    let script = [
      '-- header; with a semicolon',
      'create table a (id int); -- trailing',
      '/* block; comment */',
      ';',
      'select 1 /* inline; */ + 1;',
    ].join('\n')
    assert.deepEqual(splitSqlStatements(script).map(collapse), [
      'create table a (id int)',
      'select 1 + 1',
    ])
  })

  it('keeps a trigger body, CASE included, as one statement', () => {
    let script = `
      create trigger t after insert on a begin
        update b set n = case when new.id > 0 then 1 else 0 end;
        insert into c values (new.id);
      end;
      create index i on a (id);
    `
    let statements = splitSqlStatements(script).map(collapse)
    assert.equal(statements.length, 2)
    assert.ok(statements[0].startsWith('create trigger t'))
    assert.ok(statements[0].endsWith('insert into c values (new.id); end'))
    assert.equal(statements[1], 'create index i on a (id)')
  })

  it('treats a leading BEGIN or END as transaction control', () => {
    assert.deepEqual(splitSqlStatements('begin; select 1; end;'), ['begin', 'select 1', 'end'])
  })

  it('returns nothing for an empty script', () => {
    assert.deepEqual(splitSqlStatements('  -- nothing\n'), [])
  })
})

function collapse(statement: string): string {
  return statement.replace(/\s+/g, ' ')
}
