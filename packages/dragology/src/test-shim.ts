// Lets the tests carried over from dragology keep their `vitest` imports:
// deno.json maps `vitest` here. Only what those tests use is covered.
import '../dragology-jsx.ts'
import { describe as bddDescribe, it } from '@std/testing/bdd'
import { expect as stdExpect } from '@std/expect'
import { format, plugins } from 'pretty-format'
import { isValidElement, type Svgx } from './svgx/index.ts'

export { afterEach, beforeEach } from '@std/testing/bdd'
export { it }

export const describe: typeof bddDescribe & { todo: (name: string, fn?: () => void) => void } =
  Object.assign((name: string, fn: () => void) => bddDescribe(name, fn), {
    ...bddDescribe,
    todo: (name: string) => bddDescribe.ignore(name, () => {}),
  }) as never

// Print Remix elements the way vitest prints React elements, so the
// snapshots written for React still apply.
const testJson = Symbol.for('react.test.json')
function toTestJson(el: Svgx): unknown {
  const { children, ...props } = el.props
  const flat = [children].flat(Infinity).filter((c) => c != null && typeof c !== 'boolean')
  const type = el.type as string | { displayName?: string; name: string }
  return {
    $$typeof: testJson,
    type: typeof type === 'string' ? type : (type.displayName ?? type.name),
    props,
    children: flat.length === 0 ? null : flat.map((c) => (isValidElement(c) ? toTestJson(c) : c)),
  }
}
const RemixElementPlugin = {
  test: (val: unknown) => isValidElement(val),
  serialize: (
    val: Svgx,
    config: never,
    indentation: string,
    depth: number,
    refs: never,
    printer: never,
  ) =>
    plugins.ReactTestComponent.serialize(
      toTestJson(val) as never,
      config,
      indentation,
      depth,
      refs,
      printer,
    ),
}

function serialize(value: unknown): string {
  return format(value, {
    plugins: [RemixElementPlugin as never, plugins.ReactTestComponent],
    escapeString: false,
    printBasicPrototype: false,
    indent: 2,
  })
}

function dedent(snapshot: string): string {
  const lines = snapshot.replace(/^\n/, '').replace(/\n\s*$/, '').split('\n')
  const indent = Math.min(
    ...lines.filter((l) => l.trim() !== '').map((l) => l.match(/^ */)![0].length),
  )
  return lines.map((l) => l.slice(indent)).join('\n')
}

type Expected = ReturnType<typeof stdExpect> & {
  toMatchInlineSnapshot(snapshot?: string): void
}

export const expect: typeof stdExpect & {
  <T>(value: T, message?: string): Expected
  unreachable(message?: string): never
  assert(value: unknown, message?: string): asserts value
} = Object.assign(
  <T>(value: T, message?: string): Expected => {
    const toMatchInlineSnapshot = (snapshot = '') => {
      stdExpect(serialize(value), message).toEqual(dedent(snapshot))
    }
    // @std/expect has a toMatchInlineSnapshot of its own; take its place.
    return new Proxy(stdExpect(value, message), {
      get: (target, prop, receiver) =>
        prop === 'toMatchInlineSnapshot'
          ? toMatchInlineSnapshot
          : Reflect.get(target, prop, receiver),
    }) as Expected
  },
  stdExpect,
  {
    unreachable(message?: string): never {
      throw new Error(message ?? 'expected to be unreachable')
    },
    assert(value: unknown, message?: string): asserts value {
      if (!value) throw new Error(message ?? 'assertion failed')
    },
  },
)
