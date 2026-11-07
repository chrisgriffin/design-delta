/**
 * sources-react-parity.test.js — the props census and the anatomy census parse
 * the SAME files independently (`sources/react/extract.mjs` and
 * `sources/react/jsx.mjs`), and both legitimately reach conclusions about a
 * file that are not about props or anatomy at all: the file is missing,
 * TypeScript could not load it, it declares no component.
 *
 * Issue #155: those were reported TWICE — and for `no-component-found`, in two
 * different sentences for the identical fact, which is how a consumer noticed.
 * The other three shared codes were already byte-identical, so they were
 * double-counted silently, which is worse.
 *
 * `dedupeDiagnostics` collapses only byte-identical diagnostics, deliberately
 * (see its docblock: dropping a diagnostic that says something DIFFERENT about
 * the same file is a worse failure than a duplicate). That makes the two
 * modules' wording load-bearing: if either drifts, the duplicate silently comes
 * back and no other test notices. This file is what makes drift fail loudly.
 *
 * The two modules stay deliberately parallel rather than sharing a message
 * constant — see `jsx.mjs`'s docblock on why they are not merged — so this test
 * enforces the agreement that a shared constant would have guaranteed.
 */

import { join } from "node:path"

import { extractComponent } from "../src/sources/react/extract.mjs"
import { extractJsxComponent } from "../src/sources/react/jsx.mjs"
import { dedupeDiagnostics } from "../src/core/findings.mjs"

const FIXTURES = join(process.cwd(), "__tests__/fixtures/extract")
const BARREL = join(FIXTURES, "barrel.tsx")
const MISSING = join(FIXTURES, "does-not-exist.tsx")

// The two shared codes reachable from a real file on disk. The other two
// (`typescript-error`, `missing-source-file`) need a stubbed compiler and are
// covered by COMPILER_CASES below.
//
// `typescript-not-installed` is the one shared code deliberately covered
// nowhere here: it is reported once per RUN via `skipped`, never per file, so
// it cannot duplicate this way.
const SHARED_CASES = [
  { code: "no-component-found", file: BARREL, label: "a re-export barrel" },
  { code: "missing-component-file", file: MISSING, label: "a missing file" },
]

// The remaining two shared codes, reachable only by making the compiler fail.
// These matter MOST: both modules already word them identically, so they were
// double-counted with no mismatch to give them away, and an unpinned wording
// drift would resurrect that silent duplicate — the exact failure this file
// exists to prevent.
//
// Both modules accept an injectable `ts`, so a stub drives each path
// deterministically without touching the real compiler. The file must still
// EXIST, because both modules check existence before ever building a program —
// otherwise these would report `missing-component-file` instead.
const COMPILER_CASES = [
  {
    code: "typescript-error",
    label: "a compiler that throws",
    ts: {
      createProgram() {
        throw new Error("boom")
      },
    },
  },
  {
    code: "missing-source-file",
    label: "a program that yields no source file",
    ts: {
      // Both modules build compiler options off these enums BEFORE calling
      // `createProgram`, so a stub missing them throws and lands on
      // `typescript-error` instead — passing the wrong test for the wrong
      // reason. They are present only to let this reach the path under test.
      JsxEmit: { ReactJSX: 4 },
      ScriptTarget: { ES2022: 9 },
      ModuleKind: { CommonJS: 1 },
      ModuleResolutionKind: { Node10: 2 },
      createProgram: () => ({ getSourceFile: () => undefined }),
    },
  },
]

describe("props and anatomy censuses agree on shared per-file diagnostics", () => {
  for (const { code, file, label } of SHARED_CASES) {
    it(`words \`${code}\` identically for ${label}`, () => {
      const props = extractComponent(file)
      const anatomy = extractJsxComponent(file)

      const fromProps = props.diagnostics.find(d => d.code === code)
      const fromAnatomy = anatomy.diagnostics.find(d => d.code === code)

      // Both phases must actually reach this conclusion — a test that passed
      // because one of them stopped emitting would prove nothing.
      expect(fromProps).toBeDefined()
      expect(fromAnatomy).toBeDefined()
      expect(fromProps.message).toBe(fromAnatomy.message)
    })

    it(`collapses \`${code}\` to one entry when both phases run`, () => {
      const combined = [
        ...extractComponent(file).diagnostics,
        ...extractJsxComponent(file).diagnostics,
      ]
      expect(combined.filter(d => d.code === code)).toHaveLength(2)
      expect(dedupeDiagnostics(combined).filter(d => d.code === code)).toEqual([
        expect.objectContaining({ code, file }),
      ])
    })
  }

  for (const { code, label, ts } of COMPILER_CASES) {
    it(`words \`${code}\` identically for ${label}`, () => {
      const props = extractComponent(BARREL, { ts })
      const anatomy = extractJsxComponent(BARREL, { ts })

      const fromProps = props.diagnostics.find(d => d.code === code)
      const fromAnatomy = anatomy.diagnostics.find(d => d.code === code)

      // Guards against the stub landing on a DIFFERENT failure path and the
      // test passing vacuously — each module must emit exactly this code.
      expect(props.diagnostics.map(d => d.code)).toEqual([code])
      expect(anatomy.diagnostics.map(d => d.code)).toEqual([code])
      expect(fromProps.message).toBe(fromAnatomy.message)
    })

    it(`collapses \`${code}\` to one entry when both phases run`, () => {
      const combined = [
        ...extractComponent(BARREL, { ts }).diagnostics,
        ...extractJsxComponent(BARREL, { ts }).diagnostics,
      ]
      expect(combined.filter(d => d.code === code)).toHaveLength(2)
      expect(dedupeDiagnostics(combined).filter(d => d.code === code)).toEqual([
        expect.objectContaining({ code, file: BARREL }),
      ])
    })
  }
})

describe("dedupeDiagnostics", () => {
  const a = { code: "no-component-found", file: "a.tsx", message: "m" }
  const b = { code: "no-component-found", file: "b.tsx", message: "m" }

  it("collapses byte-identical diagnostics", () => {
    expect(dedupeDiagnostics([a, { ...a }, b])).toEqual([a, b])
  })

  it("keeps diagnostics that differ only by message", () => {
    // The case the whole triple-key exists for: same code, same file, but the
    // two phases know DIFFERENT things. Collapsing these would lose one.
    const other = { ...a, message: "something else entirely" }
    expect(dedupeDiagnostics([a, other])).toHaveLength(2)
  })

  it("keeps diagnostics that differ only by file", () => {
    expect(dedupeDiagnostics([a, b])).toHaveLength(2)
  })

  it("preserves first-seen order", () => {
    expect(dedupeDiagnostics([b, a, { ...b }]).map(d => d.file)).toEqual([
      "b.tsx",
      "a.tsx",
    ])
  })

  it("is a no-op on an empty list", () => {
    expect(dedupeDiagnostics([])).toEqual([])
  })
})
