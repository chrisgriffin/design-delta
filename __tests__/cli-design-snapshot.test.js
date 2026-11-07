/**
 * cli-design-snapshot.test.js — `src/cli/design-snapshot.mjs` (issue #560).
 *
 * `readDesignSnapshot` degrades to "no snapshot" on three different causes —
 * the file is absent, its JSON will not parse, or the provider's validator
 * rejects it — and sets `reason` only for the latter two. `audit`, `lint` and
 * `snapshot` all read that presence to tell "never gathered" (stay silent)
 * from "gathered but invalid" (emit a diagnostic), so the four outcomes and
 * the `reason` contract between them are what this suite pins. Before it, all
 * four were reachable only end to end through a synthetic project.
 *
 * Driven from literal inputs: a real file in a temp directory for the path,
 * and a local stub for `validate`. The stub honours the provider contract
 * `(snapshot) => {valid, errors}` without naming a provider — the engine is
 * vendor-neutral outside `src/providers/` (CLAUDE.md, ADR-001 D12) and that
 * applies to its tests as much as to its defaults.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readDesignSnapshot } from "../src/cli/design-snapshot.mjs"

let dir

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "design-delta-snapshot-"))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Write `text` verbatim — the unparseable case needs content that is not JSON. */
function writeFile(name, text) {
  const path = join(dir, name)
  writeFileSync(path, text, "utf8")
  return path
}

/** A path inside the temp directory that was never written. */
function missingPath(name) {
  return join(dir, name)
}

/** The provider validator contract: accepts anything, recording what it saw. */
function accept() {
  const calls = []
  const validate = snapshot => {
    calls.push(snapshot)
    return { valid: true, errors: [] }
  }
  validate.calls = calls
  return validate
}

/** The same contract, rejecting with the given messages. */
function reject(errors) {
  return () => ({ valid: false, errors })
}

describe("absent file", () => {
  it("is not present, has no snapshot and states no reason", () => {
    const validate = accept()
    const result = readDesignSnapshot(
      missingPath("never-written.json"),
      validate,
    )

    expect(result).toEqual({ present: false, snapshot: null })
    expect("reason" in result).toBe(false)
  })

  it("never consults the validator", () => {
    const validate = accept()
    readDesignSnapshot(missingPath("also-never-written.json"), validate)

    expect(validate.calls).toEqual([])
  })
})

describe("unparseable JSON", () => {
  it("is present with no snapshot and a reason naming the path", () => {
    const path = writeFile("unparseable.json", "{ not json at all")
    const result = readDesignSnapshot(path, accept())

    expect(result.present).toBe(true)
    expect(result.snapshot).toBeNull()
    expect(result.reason).toContain(path)
    expect(result.reason).toContain("could not be parsed")
  })

  it("never consults the validator", () => {
    const path = writeFile("unparseable-2.json", "components: []")
    const validate = accept()
    readDesignSnapshot(path, validate)

    expect(validate.calls).toEqual([])
  })
})

describe("validator-rejected", () => {
  it("is present with no snapshot and a reason joining the validator's errors", () => {
    const path = writeFile("invalid.json", JSON.stringify({ components: 7 }))
    const result = readDesignSnapshot(
      path,
      reject([
        "/components must be array",
        "(root) must have required property 'version'",
      ]),
    )

    expect(result.present).toBe(true)
    expect(result.snapshot).toBeNull()
    expect(result.reason).toContain(path)
    expect(result.reason).toContain("failed schema validation")
    expect(result.reason).toContain(
      "/components must be array; (root) must have required property 'version'",
    )
  })

  it("hands the parsed document to the validator, not the file text", () => {
    const document = { components: 7 }
    const path = writeFile("invalid-2.json", JSON.stringify(document))
    let seen
    readDesignSnapshot(path, snapshot => {
      seen = snapshot
      return { valid: false, errors: ["nope"] }
    })

    expect(seen).toEqual(document)
  })
})

describe("valid snapshot", () => {
  const document = {
    version: 1,
    components: [{ name: "Alpha", treeHash: "abc" }],
  }

  it("returns the raw parsed document as the snapshot, with no reason", () => {
    const path = writeFile("valid.json", JSON.stringify(document))
    const result = readDesignSnapshot(path, accept())

    expect(result.present).toBe(true)
    expect(result.snapshot).toEqual(document)
    expect("reason" in result).toBe(false)
  })

  it("returns the very value the validator approved, not a copy of it", () => {
    const path = writeFile("valid-2.json", JSON.stringify(document))
    const validate = accept()
    const result = readDesignSnapshot(path, validate)

    expect(validate.calls).toHaveLength(1)
    expect(result.snapshot).toBe(validate.calls[0])
  })
})

describe("the reason contract across all four outcomes", () => {
  // This is what callers read: `audit` does `designReason || result.reason`,
  // `lint` prints "is not present" vs "is unreadable (<reason>)", `snapshot`
  // spreads `reason` only when set. An absent file must stay silent; a file
  // that was gathered but is unusable must carry a diagnostic.
  it("omits reason only for the absent file", () => {
    const absent = readDesignSnapshot(missingPath("gone.json"), accept())
    const unparseable = readDesignSnapshot(
      writeFile("contract-unparseable.json", "<<<"),
      accept(),
    )
    const invalid = readDesignSnapshot(
      writeFile("contract-invalid.json", "{}"),
      reject(["(root) must have required property 'components'"]),
    )
    const valid = readDesignSnapshot(
      writeFile("contract-valid.json", JSON.stringify({ components: [] })),
      accept(),
    )

    expect("reason" in absent).toBe(false)
    expect(typeof unparseable.reason).toBe("string")
    expect(typeof invalid.reason).toBe("string")
    expect("reason" in valid).toBe(false)

    // Both failures are indistinguishable from the absent file on `snapshot`
    // alone — `present` plus `reason` is the only thing that separates them.
    for (const result of [absent, unparseable, invalid])
      expect(result.snapshot).toBeNull()
    expect([absent.present, unparseable.present, invalid.present]).toEqual([
      false,
      true,
      true,
    ])
  })
})
