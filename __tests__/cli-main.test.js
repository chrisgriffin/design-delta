/**
 * cli-main.test.js — the `design-delta` single-bin entry point
 * (`src/cli/main.mjs`) and its flag parser (`src/cli/flags.mjs`).
 *
 * Almost every case drives `run(argv, io)` in-process against a fake stream
 * pair (no spawning, no `process.exit`) — the whole point of `run` returning
 * an exit code instead of calling `process.exit` itself. The one exception,
 * at the bottom, is a real subprocess invocation of `node src/cli/main.mjs
 * --help`: the in-process tests import `main.mjs` as a module, which can't
 * catch a top-level syntax or import error that would only surface when the
 * file is actually run as a script (v1's own `__tests__/cli.test.js` keeps
 * the same real-subprocess case for the same reason).
 */
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { isMain, parseFlags } from "../src/cli/flags.mjs"
import { buildHelp, run, SUBCOMMANDS } from "../src/cli/main.mjs"

const REPO_ROOT = process.cwd()
const CLI_PATH = join(REPO_ROOT, "src", "cli", "main.mjs")
const PACKAGE_VERSION = JSON.parse(
  readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
).version

/** A minimal writable-stream stand-in that just records what was written. */
function fakeStream() {
  const writes = []
  return {
    stream: {
      write(chunk) {
        writes.push(chunk)
        return true
      },
    },
    writes,
  }
}

function runCapture(argv) {
  const { stream: stdout, writes: stdoutWrites } = fakeStream()
  const { stream: stderr, writes: stderrWrites } = fakeStream()
  const code = run(argv, { stdout, stderr })
  return { code, stdout: stdoutWrites.join(""), stderr: stderrWrites.join("") }
}

// ---------------------------------------------------------------------------
// The subcommand table
// ---------------------------------------------------------------------------

describe("SUBCOMMANDS", () => {
  const EXPECTED_NAMES = [
    "init",
    "audit",
    "lint",
    "report",
    "verify",
    "gather",
    "ingest",
    "contracts",
    "movers",
    "impact",
    "map",
    "query",
    "scaffold",
    "dock",
    "snapshot",
    "mcp",
  ]

  it("covers exactly the sixteen subcommands, no more, no fewer", () => {
    expect(Object.keys(SUBCOMMANDS).sort()).toEqual([...EXPECTED_NAMES].sort())
  })

  it("gives every entry a summary, a phase, and a run function", () => {
    for (const [name, entry] of Object.entries(SUBCOMMANDS)) {
      expect(typeof entry.summary).toBe("string")
      expect(entry.summary.length).toBeGreaterThan(0)
      expect(typeof entry.phase).toBe("number")
      expect(typeof entry.run).toBe("function")
      expect(name).toBe(name) // sanity: name is the table key itself
    }
  })

  it("assigns the ADR-001 phase each subcommand actually lands in", () => {
    // The order after D15: contract↔code first (1–2), lint third, the MVP
    // release fourth, and the design provider layer LAST — deferred out of
    // the first release entirely.
    expect(SUBCOMMANDS.contracts.phase).toBe(1)
    expect(SUBCOMMANDS.audit.phase).toBe(1)
    expect(SUBCOMMANDS.verify.phase).toBe(2)
    expect(SUBCOMMANDS.gather.phase).toBe(5)
    expect(SUBCOMMANDS.ingest.phase).toBe(5)
    // movers/impact/map read state.json (a Phase 6 artifact, ADR-003) —
    // shipped ahead of the design provider layer, not gated on it.
    expect(SUBCOMMANDS.movers.phase).toBe(6)
    expect(SUBCOMMANDS.impact.phase).toBe(6)
    expect(SUBCOMMANDS.map.phase).toBe(6)
    // `query` (issue #493) is a read-only inventory alongside the other
    // Phase 6 queries — it registers no rule and gates nothing.
    expect(SUBCOMMANDS.query.phase).toBe(6)
    expect(SUBCOMMANDS.lint.phase).toBe(3)
    expect(SUBCOMMANDS.report.phase).toBe(3)
    expect(SUBCOMMANDS.init.phase).toBe(4)
    expect(SUBCOMMANDS.scaffold.phase).toBe(6)
    expect(SUBCOMMANDS.dock.phase).toBe(6)
    expect(SUBCOMMANDS.snapshot.phase).toBe(6)
  })

  it("names a phase the stub message and the table agree on", () => {
    // `phase` used to be declared twice per entry — once for the help, once as
    // makeStub's argument — and they drifted. Pin the agreement, not just the
    // numbers.
    for (const entry of Object.values(SUBCOMMANDS)) {
      if (entry.run.name !== "stubRun") continue
      const { stream: stdout, writes: stdoutWrites } = fakeStream()
      const { stream: stderr, writes: stderrWrites } = fakeStream()
      entry.run([], { io: { stdout, stderr }, globalOpts: {} })
      expect(stderrWrites.join("")).toContain(`Phase ${entry.phase}`)
      // A stub writes nothing to stdout — it is not a report.
      expect(stdoutWrites.join("")).toBe("")
    }
  })
})

// ---------------------------------------------------------------------------
// buildHelp()
// ---------------------------------------------------------------------------

describe("buildHelp()", () => {
  const help = buildHelp()

  it("gives every subcommand exactly one row, labelled with its name", () => {
    // Matched against the ROW LABEL column only, not the whole help text. The
    // earlier version counted the name anywhere in the output, which quietly
    // depended on no summary ever containing another command's name as a whole
    // word — and `codegen`'s summary ("…binding files from contracts") broke
    // exactly that assumption. Anchoring to the label is what the test always
    // meant, and it cannot be broken by a wording change.
    const labels = help
      .split("\n")
      .map(line => /^ {4}([a-z][a-z-]*) {2,}\S/.exec(line))
      .filter(Boolean)
      .map(m => m[1])
    expect(labels.slice().sort()).toEqual(Object.keys(SUBCOMMANDS).sort())
    expect(new Set(labels).size).toBe(labels.length)
  })

  it("marks every subcommand's row with its ADR phase", () => {
    for (const [name, entry] of Object.entries(SUBCOMMANDS)) {
      const row = help.split("\n").find(line => line.trim().startsWith(name))
      expect(row).toContain(`(Phase ${entry.phase})`)
    }
  })

  it("documents every global flag", () => {
    for (const flag of ["--quiet", "--config", "--help", "--version"]) {
      expect(help).toContain(flag)
    }
  })

  it("is stable across calls (pure, deterministic)", () => {
    expect(buildHelp()).toBe(help)
  })
})

// ---------------------------------------------------------------------------
// run() — --help / --version / no args
// ---------------------------------------------------------------------------

describe("run() — help and version", () => {
  it("--help prints the help text to stdout and exits 0", () => {
    const { code, stdout, stderr } = runCapture(["--help"])
    expect(code).toBe(0)
    expect(stdout).toBe(buildHelp())
    expect(stderr).toBe("")
  })

  it("-h behaves identically to --help", () => {
    const { code, stdout } = runCapture(["-h"])
    expect(code).toBe(0)
    expect(stdout).toBe(buildHelp())
  })

  it("no args at all also prints help and exits 0", () => {
    const { code, stdout } = runCapture([])
    expect(code).toBe(0)
    expect(stdout).toBe(buildHelp())
  })

  it("--version prints the package.json version to stdout and exits 0", () => {
    const { code, stdout, stderr } = runCapture(["--version"])
    expect(code).toBe(0)
    expect(stdout).toBe(`${PACKAGE_VERSION}\n`)
    expect(stderr).toBe("")
  })

  it("-V behaves identically to --version", () => {
    const { code, stdout } = runCapture(["-V"])
    expect(code).toBe(0)
    expect(stdout).toBe(`${PACKAGE_VERSION}\n`)
  })

  it("--version wins over a subcommand name present in the same argv", () => {
    const { code, stdout } = runCapture(["audit", "--version"])
    expect(code).toBe(0)
    expect(stdout).toBe(`${PACKAGE_VERSION}\n`)
  })
})

// ---------------------------------------------------------------------------
// run() — unknown subcommand
// ---------------------------------------------------------------------------

describe("run() — unknown subcommand", () => {
  it("exits 1 and lists every valid subcommand on stderr", () => {
    const { code, stdout, stderr } = runCapture(["not-a-real-subcommand"])
    expect(code).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain('unknown subcommand "not-a-real-subcommand"')
    for (const name of Object.keys(SUBCOMMANDS)) expect(stderr).toContain(name)
  })

  it("offers a 'did you mean' suggestion for a close typo", () => {
    const { stderr } = runCapture(["auditt"])
    expect(stderr).toContain('Did you mean "audit"?')
  })

  it("offers no suggestion for a wholesale-wrong name", () => {
    const { stderr } = runCapture(["zzzzzzzzzz"])
    expect(stderr).not.toContain("Did you mean")
  })
})

// ---------------------------------------------------------------------------
// run() — flags main.mjs doesn't own are forwarded, never rejected pre-dispatch
// ---------------------------------------------------------------------------

describe("run() — flag forwarding", () => {
  it("forwards a subcommand's own flags without main.mjs rejecting them", () => {
    // main.mjs doesn't know "--dir" — that belongs to `contracts`'s own flag
    // spec. If main.mjs pre-validated flags itself, this would fail before
    // ever reaching `runContracts`; the assertion below distinguishes that
    // from a real rejection by CONTRACTS'S OWN parser (which DOES recognize
    // `--dir`, so this must exit clean, not with an "Unknown argument").
    const { code, stderr } = runCapture(["contracts", "--dir", "contracts"])
    expect(code).toBe(0)
    expect(stderr).not.toContain("Unknown argument")
  })

  it("a flag genuinely unknown to the subcommand is rejected by ITS OWN parser, not main.mjs", () => {
    // Proves the forwarding is unconditional, not "main.mjs happens to allow
    // --dir": a flag `contracts` itself doesn't recognize still reaches it
    // and gets rejected there (`design-delta contracts: Unknown argument`),
    // never intercepted by main.mjs pretending to be a second flag parser.
    const { code, stderr } = runCapture(["contracts", "--bogus-flag"])
    expect(code).toBe(1)
    expect(stderr).toContain(
      'design-delta contracts: Unknown argument "--bogus-flag".',
    )
  })
})

// ---------------------------------------------------------------------------
// run() — global flag parsing
// ---------------------------------------------------------------------------

describe("run() — global flags", () => {
  it("--quiet is consumed as a global flag, never forwarded as an unknown argument", () => {
    const { code, stderr } = runCapture(["contracts", "--quiet"])
    expect(code).toBe(0)
    expect(stderr).not.toContain("Unknown argument")
    expect(stderr).not.toContain("--quiet")
  })

  it("--config with a following value is consumed without becoming an unknown argument", () => {
    const { code, stderr } = runCapture([
      "contracts",
      "--config",
      "custom.config.json",
    ])
    // The named file doesn't exist — a real, distinct error from `contracts`
    // itself (`resolveRunConfig`'s "no config at ..."), never main.mjs
    // treating the value as a stray positional argument.
    expect(code).toBe(1)
    expect(stderr).not.toContain("Unknown argument")
    expect(stderr).toContain("no config at custom.config.json")
  })

  it("a dangling --config with no following value is a global parse error, exit 1", () => {
    const { code, stderr, stdout } = runCapture(["contracts", "--config"])
    expect(code).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain('"--config" requires a value.')
  })

  it("--quiet works whether it appears before or after the subcommand name", () => {
    const before = runCapture(["--quiet", "contracts"])
    const after = runCapture(["contracts", "--quiet"])
    expect(before.code).toBe(0)
    expect(after.code).toBe(0)
    expect(before.stderr).toBe("")
    expect(after.stderr).toBe("")
  })
})

// ---------------------------------------------------------------------------
// parseFlags (src/cli/flags.mjs)
// ---------------------------------------------------------------------------

describe("parseFlags", () => {
  it("parses known boolean flags, camelCasing multi-word flag names", () => {
    const { opts, errors } = parseFlags(["--json", "--fail-on-new-drift"], {
      boolean: ["--json", "--fail-on-new-drift"],
    })
    expect(errors).toEqual([])
    expect(opts).toEqual({ json: true, failOnNewDrift: true })
  })

  it("parses known value flags, consuming the following token", () => {
    const { opts, errors } = parseFlags(["--snapshots", "my-dir"], {
      value: ["--snapshots"],
    })
    expect(errors).toEqual([])
    expect(opts).toEqual({ snapshots: "my-dir" })
  })

  it("rejects an unknown flag instead of silently ignoring it", () => {
    const { opts, errors } = parseFlags(["--bogus"], { boolean: ["--json"] })
    expect(errors).toEqual(['Unknown argument "--bogus".'])
    expect(opts).toEqual({})
  })

  it("a value-type flag with no following value produces an error", () => {
    const { opts, errors } = parseFlags(["--snapshots"], {
      value: ["--snapshots"],
    })
    expect(errors).toEqual(['"--snapshots" requires a value.'])
    expect(opts).toEqual({})
  })

  it("collects bare tokens into opts.positional when spec.positional is set", () => {
    const { opts, errors } = parseFlags(["Button", "--write", "Chip"], {
      boolean: ["--write"],
      positional: true,
    })
    expect(errors).toEqual([])
    expect(opts.write).toBe(true)
    expect(opts.positional).toEqual(["Button", "Chip"])
  })

  it("rejects a bare token as an unknown argument when spec.positional is not set", () => {
    const { errors } = parseFlags(["stray"], { boolean: ["--json"] })
    expect(errors).toEqual(['Unknown argument "stray".'])
  })
})

// ---------------------------------------------------------------------------
// isMain (src/cli/flags.mjs)
// ---------------------------------------------------------------------------

describe("isMain", () => {
  it("is false when process.argv[1] is absent", () => {
    const original = process.argv[1]
    try {
      process.argv[1] = undefined
      expect(isMain("file:///anything")).toBe(false)
    } finally {
      process.argv[1] = original
    }
  })

  it("is false for a URL that doesn't match the running script", () => {
    expect(isMain("file:///definitely/not/this/test/file.mjs")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Real subprocess: proves the file runs cleanly top-to-bottom, catching what
// the in-process tests above structurally cannot (a top-level syntax error
// or a broken import chain that only fails when the file is actually run).
// ---------------------------------------------------------------------------

describe("design-delta CLI — real subprocess invocation", () => {
  it("`node src/cli/main.mjs --help` exits 0 and prints the subcommand list", () => {
    const stdout = execFileSync("node", [CLI_PATH, "--help"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
    expect(stdout).toContain("Usage: design-delta <subcommand>")
    for (const name of Object.keys(SUBCOMMANDS)) expect(stdout).toContain(name)
  })

  it("`node src/cli/main.mjs gather` runs its real (dynamic-import) provider-loading path end to end", () => {
    // `gather` is deliberately the subprocess case: `providers/index.mjs`
    // reaches a provider through a dynamic `import()`, which only actually
    // executes when awaited — a broken provider module could pass every
    // in-process test (which imports `main.mjs` statically, never touching
    // the dynamic path) and still fail here. This repo's own root has no
    // `design.provider` configured, so the real, honest outcome is a clean
    // "nothing to do" error, not a stub notice.
    let error
    try {
      execFileSync("node", [CLI_PATH, "gather"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      })
    } catch (err) {
      error = err
    }
    expect(error).toBeDefined()
    expect(error.status).toBe(1)
    expect(error.stderr).toContain(
      "design-delta gather: no design.provider configured",
    )
  })
})

// ---------------------------------------------------------------------------
// Regression: `main()` must not truncate stdout on a pipe (issue #353).
//
// `run()`, tested in-process everywhere above, can't observe this — the bug
// lives entirely in `main()` calling `process.exit()` before an async pipe
// write has drained. An in-process fake stream or `execFileSync` (which
// drains the child's stdout eagerly enough that the write never goes async)
// can't reproduce it either; only a real OS pipe that isn't read until the
// child has already exited does, matching how a consumer actually pipes
// `--json` output into `jq`.
// ---------------------------------------------------------------------------

describe("design-delta CLI — stdout must not truncate on a pipe", () => {
  let fixtureRoot
  let contractsDir

  beforeAll(() => {
    // `contracts --json` (any subcommand would do, per the issue: the fix is
    // in `main()`, not per-command) needs a payload bigger than the 64 KiB
    // pipe buffer to exercise the async-write path. 200 minimal, deliberately
    // invalid contract files comfortably clears that.
    fixtureRoot = mkdtempSync(join(tmpdir(), "design-delta-cli-pipe-"))
    contractsDir = join(fixtureRoot, "contracts")
    mkdirSync(contractsDir)
    for (let i = 0; i < 200; i++) {
      writeFileSync(join(contractsDir, `broken-${i}.contract.json`), "{}")
    }
  })

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it("piping `contracts --json` yields the same byte count as redirecting it to a file", () => {
    const outFile = join(fixtureRoot, "out.json")
    const command = `node ${JSON.stringify(CLI_PATH)} contracts --dir ${JSON.stringify(contractsDir)} --json`

    // Deliberately no `pipefail`: `contracts` legitimately exits 1 on
    // invalid contracts, which would otherwise make the whole pipeline's
    // exit status non-zero and throw — the byte count from `wc -c` (which
    // does exit 0) is all this assertion needs.
    const pipedBytes = parseInt(
      execFileSync("bash", ["-c", `${command} 2>/dev/null | wc -c`], {
        encoding: "utf8",
      }).trim(),
      10,
    )

    // The subcommand's own exit code (1, for invalid contracts) is expected
    // here and unrelated to the truncation bug, so ignore it.
    try {
      execFileSync("bash", [
        "-c",
        `${command} > ${JSON.stringify(outFile)} 2>/dev/null`,
      ])
    } catch {
      // expected: `contracts` exits 1 on invalid contracts
    }
    const fileBytes = statSync(outFile).size

    // The fixture itself must exceed the pipe buffer for this to be a
    // meaningful assertion — otherwise both sides would trivially match even
    // on the buggy code.
    expect(fileBytes).toBeGreaterThan(65536)
    expect(pipedBytes).toBe(fileBytes)
  })
})
