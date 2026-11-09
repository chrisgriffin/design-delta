/**
 * cli-contracts.test.js — the `design-delta contracts` subcommand
 * (`src/cli/commands/contracts.mjs`), driven through `main.mjs`'s `run` so the
 * whole path a consumer actually takes is under test: global-flag extraction,
 * dispatch, the subcommand's own flag spec, and the exit code.
 *
 * Two invariants get their own cases because breaking either is silent and
 * expensive: `--json` must put ONE parseable document on stdout (so it pipes
 * into `jq` regardless of how noisy the run was), and progress must never
 * touch stdout (ADR-001 D8).
 *
 * The last case is a real subprocess, matching `cli-main.test.js`'s reasoning:
 * the in-process cases import the CLI as a module and structurally cannot
 * catch an error that only surfaces when the file is run as a script.
 */

import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { run } from "../src/cli/main.mjs"

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = process.cwd()
const CLI_PATH = join(REPO_ROOT, "src", "cli", "main.mjs")
const FIXTURES = join(TEST_DIR, "fixtures", "contracts")

// Relative to the repo root, because that is this suite's cwd and it is what
// the command echoes back as its `contractsDir` label — an absolute path in
// asserted output would make the expectation machine-specific.
const VALID_DIR = relative(REPO_ROOT, join(FIXTURES, "valid"))
const INVALID_DIR = relative(REPO_ROOT, join(FIXTURES, "invalid"))

function fakeStream() {
  const writes = []
  return { stream: { write: chunk => writes.push(chunk) }, writes }
}

function runCapture(argv) {
  const { stream: stdout, writes: stdoutWrites } = fakeStream()
  const { stream: stderr, writes: stderrWrites } = fakeStream()
  const code = run(argv, { stdout, stderr })
  return { code, stdout: stdoutWrites.join(""), stderr: stderrWrites.join("") }
}

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------

describe("design-delta contracts — exit codes", () => {
  it("exits 0 when every contract in the directory is valid", () => {
    const { code, stdout } = runCapture(["contracts", "--dir", VALID_DIR])
    expect(code).toBe(0)
    expect(stdout).toContain("All 2 contract(s) valid.")
  })

  it("exits 1 when any contract produces a diagnostic", () => {
    const { code, stdout } = runCapture(["contracts", "--dir", INVALID_DIR])
    expect(code).toBe(1)
    expect(stdout).toContain("2 of 2 contract(s) invalid")
  })

  it("never exits 2 — that code means 'not implemented yet'", () => {
    for (const dir of [VALID_DIR, INVALID_DIR]) {
      expect(runCapture(["contracts", "--dir", dir]).code).not.toBe(2)
    }
  })

  it("exits 0 for a directory with no contracts at all", () => {
    const empty = mkdtempSync(join(tmpdir(), "design-delta-empty-"))
    try {
      const { code, stdout } = runCapture(["contracts", "--dir", empty])
      expect(code).toBe(0)
      expect(stdout).toContain("no contract files found under")
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Human output
// ---------------------------------------------------------------------------

describe("design-delta contracts — human output", () => {
  it("lists each valid contract with its id", () => {
    const { stdout } = runCapture(["contracts", "--dir", VALID_DIR])
    expect(stdout).toContain("sample-button.contract.json (sample-button)")
    expect(stdout).toContain("sample-card.contract.json (sample-card)")
    expect(stdout).toContain(`2 file(s) under ${VALID_DIR}`)
  })

  it("lists each invalid contract with every one of its diagnostics", () => {
    const { stdout } = runCapture(["contracts", "--dir", INVALID_DIR])
    expect(stdout).toContain("FAIL  ")
    expect(stdout).toContain("broken-anatomy.contract.json")
    for (const code of [
      "unknown-anatomy-child",
      "unknown-content-prop",
      "unknown-style-element",
      "unreachable-anatomy-node",
      "invalid-prop-default",
      "unknown-variant-prop",
    ]) {
      expect(stdout).toContain(`[${code}]`)
    }
  })

  it("names the in-document path of each diagnostic", () => {
    const { stdout } = runCapture(["contracts", "--dir", INVALID_DIR])
    expect(stdout).toContain("anatomy.root.children[0]:")
    expect(stdout).toContain("props.size.default:")
  })

  it("is deterministic — the same directory renders identically twice", () => {
    expect(runCapture(["contracts", "--dir", INVALID_DIR]).stdout).toBe(
      runCapture(["contracts", "--dir", INVALID_DIR]).stdout,
    )
  })
})

// ---------------------------------------------------------------------------
// --json
// ---------------------------------------------------------------------------

describe("design-delta contracts --json", () => {
  it("emits ONE parseable document on stdout for a clean run", () => {
    const { code, stdout } = runCapture([
      "contracts",
      "--dir",
      VALID_DIR,
      "--json",
    ])
    expect(code).toBe(0)
    const payload = JSON.parse(stdout)
    expect(payload).toEqual({
      command: "contracts",
      ok: true,
      contractsDir: VALID_DIR,
      counts: { files: 2, valid: 2, invalid: 0, diagnostics: 0 },
      contracts: [
        {
          id: "sample-button",
          file: `${VALID_DIR}/sample-button.contract.json`,
          valid: true,
        },
        {
          id: "sample-card",
          file: `${VALID_DIR}/nested/sample-card.contract.json`,
          valid: true,
        },
      ],
      diagnostics: [],
    })
  })

  it("emits the diagnostics verbatim for a failing run", () => {
    const { code, stdout } = runCapture([
      "contracts",
      "--dir",
      INVALID_DIR,
      "--json",
    ])
    expect(code).toBe(1)
    const payload = JSON.parse(stdout)
    expect(payload.ok).toBe(false)
    expect(payload.counts).toEqual({
      files: 2,
      valid: 0,
      invalid: 2,
      diagnostics: 6,
    })
    expect(payload.contracts).toEqual([])
    for (const diagnostic of payload.diagnostics) {
      expect(typeof diagnostic.code).toBe("string")
      expect(typeof diagnostic.file).toBe("string")
      expect(typeof diagnostic.message).toBe("string")
      expect(typeof diagnostic.contractId).toBe("string")
    }
  })

  it("keeps stdout clean of progress, which goes only to stderr", () => {
    const { stdout, stderr } = runCapture([
      "contracts",
      "--dir",
      VALID_DIR,
      "--json",
    ])
    expect(() => JSON.parse(stdout)).not.toThrow()
    expect(stdout).not.toContain("[design-delta]")
    expect(stderr).toContain("[design-delta] contracts")
  })

  it("--quiet silences progress without changing stdout", () => {
    const loud = runCapture(["contracts", "--dir", VALID_DIR, "--json"])
    const quiet = runCapture([
      "contracts",
      "--dir",
      VALID_DIR,
      "--json",
      "--quiet",
    ])
    expect(quiet.stdout).toBe(loud.stdout)
    expect(quiet.stderr).toBe("")
  })
})

// ---------------------------------------------------------------------------
// Flags and config
// ---------------------------------------------------------------------------

describe("design-delta contracts — flags and config", () => {
  it("rejects an unknown flag instead of running with defaults", () => {
    const { code, stdout, stderr } = runCapture(["contracts", "--bogus"])
    expect(code).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain('Unknown argument "--bogus"')
  })

  it("errors when --dir is given with no value", () => {
    const { code, stderr } = runCapture(["contracts", "--dir"])
    expect(code).toBe(1)
    expect(stderr).toContain('"--dir" requires a value.')
  })

  it("errors when an explicitly-named --config does not exist", () => {
    const { code, stdout, stderr } = runCapture([
      "contracts",
      "--config",
      "no-such-config.json",
    ])
    expect(code).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain("no config at no-such-config.json")
  })

  it("falls back to defaults when no config exists and none was named", () => {
    // A project that has not run `init` still has contracts worth validating;
    // every path this command needs has a default.
    const { code, stdout } = runCapture(["contracts", "--dir", VALID_DIR])
    expect(code).toBe(0)
    expect(stdout).toContain("All 2 contract(s) valid.")
  })
})

// ---------------------------------------------------------------------------
// Real subprocess — proves the file runs cleanly top-to-bottom.
// ---------------------------------------------------------------------------

describe("design-delta contracts — real subprocess invocation", () => {
  it("`node src/cli/main.mjs contracts --dir <valid>` exits 0", () => {
    const stdout = execFileSync(
      "node",
      [CLI_PATH, "contracts", "--dir", VALID_DIR, "--quiet"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
    expect(stdout).toContain("All 2 contract(s) valid.")
  })

  it("`node src/cli/main.mjs contracts --dir <invalid>` exits 1", () => {
    let error
    try {
      execFileSync(
        "node",
        [CLI_PATH, "contracts", "--dir", INVALID_DIR, "--quiet"],
        { cwd: REPO_ROOT, encoding: "utf8" },
      )
    } catch (err) {
      error = err
    }
    expect(error).toBeDefined()
    expect(error.status).toBe(1)
    expect(error.stdout).toContain("contract(s) invalid")
  })
})
