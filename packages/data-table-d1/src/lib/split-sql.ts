/**
 * Splits a SQL script into its statements.
 *
 * D1 prepares one statement at a time, and only `batch()` runs several atomically, so a migration's
 * `up.sql` has to be cut into statements before it can be batched. Semicolons inside string and
 * identifier quotes, comments, and a `CREATE TRIGGER … BEGIN … END` body do not end a statement.
 * Comments are dropped from the output, and so is any statement left empty without them.
 *
 * @param script SQL text that may hold any number of statements.
 * @returns Each statement, trimmed, without its terminating semicolon.
 */
export function splitSqlStatements(script: string): string[] {
  let statements: string[] = []
  let current = ''
  // `BEGIN … END` (trigger bodies) and `CASE … END` nest; a `;` only ends a statement at depth 0.
  let depth = 0
  let index = 0

  let flush = () => {
    let text = current.trim()
    if (text !== '') statements.push(text)
    current = ''
    depth = 0
  }

  while (index < script.length) {
    let char = script[index]
    let next = script[index + 1]

    if (char === '-' && next === '-') {
      let end = script.indexOf('\n', index)
      index = end === -1 ? script.length : end
      current += ' '
      continue
    }

    if (char === '/' && next === '*') {
      let end = script.indexOf('*/', index + 2)
      index = end === -1 ? script.length : end + 2
      current += ' '
      continue
    }

    if (char === "'" || char === '"' || char === '`' || char === '[') {
      let close = char === '[' ? ']' : char
      let end = index + 1
      while (end < script.length) {
        if (script[end] === close) {
          // A doubled quote is an escaped quote, not the end (`'it''s'`); brackets do not escape.
          if (close !== ']' && script[end + 1] === close) {
            end += 2
            continue
          }
          break
        }
        end += 1
      }
      current += script.slice(index, end + 1)
      index = end + 1
      continue
    }

    if (char === ';') {
      if (depth === 0) {
        flush()
      } else {
        current += char
      }
      index += 1
      continue
    }

    if (isWordStart(char)) {
      let end = index + 1
      while (end < script.length && isWordPart(script[end])) end += 1
      let word = script.slice(index, end).toLowerCase()
      // At the start of a statement, `BEGIN` and `END` are transaction control, not a block.
      let leading = current.trim() === ''
      if ((word === 'begin' && !leading) || word === 'case') {
        depth += 1
      } else if (word === 'end' && !leading && depth > 0) {
        depth -= 1
      }
      current += script.slice(index, end)
      index = end
      continue
    }

    current += char
    index += 1
  }

  flush()
  return statements
}

function isWordStart(char: string): boolean {
  return /[A-Za-z_]/.test(char)
}

function isWordPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char)
}
