/**
 * cli-contract.test.js — `design-delta scaffold <Component>`
 * (`src/cli/commands/scaffold.mjs`), roadmap item split from #217/2026-08-12.
 *
 * Drives `runScaffold(cmdArgv, ctx)` directly, the same testable seam every
 * other subcommand test uses before/independent of `main.mjs` wiring.
 * `withSyntheticProject`/`runCapture` mirror `cli-codegen.test.js`'s harness.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { run } from "../src/cli/main.mjs"
import { runScaffold } from "../src/cli/commands/scaffold.mjs"
import {
  CONTRACT_SCHEMA_VERSION,
  loadContracts,
} from "../src/spec/contracts.mjs"
import {
  createSyntheticProject,
  SYNTHETIC_PATHS,
} from "./helpers/synthetic-project.mjs"

// A real, typed component — every scalar kind the classifier maps
// (boolean/number/string/function), plus destructuring defaults, so the
// scaffolded contract's `props` block has something worth asserting on.
const BUTTON_TSX = `export type ButtonProps = {
  active?: boolean
  count?: number
  label: string
  size?: "sm" | "lg"
  onPress?: () => void
}

export function Button({ active = false, count = 0, label, size = "sm", onPress }: ButtonProps) {
  return null
}
`

// A resolvable render tree (`sources/react/jsx.mjs` never declines it): a
// `button` root wrapping a nested custom component and a `span` whose only
// content is a prop-bound expression — enough to exercise every anatomy node
// kind `buildScaffoldAnatomy` maps to something other than a placeholder
// (`element`, `component`/instance, `expression`).
const ICON_BUTTON_TSX = `export type IconButtonProps = {
  label: string
}

export function IconButton({ label }: IconButtonProps) {
  return (
    <button className="acmeIconButton">
      <Icon />
      <span>{label}</span>
    </button>
  )
}
`

// An `{identifier}` expression that names a LOCAL variable, not a declared
// prop — `jsx.mjs` classifies any bare identifier as `expression` with no
// check against the props census, so this exercises the guard that stops
// `buildScaffoldAnatomy` from drafting a `{$prop: "greeting"}` binding the
// contract's own validation would then reject (no `greeting` prop exists).
const UNBOUND_TEXT_TSX = `export type UnboundTextProps = {
  label: string
}

export function UnboundText({ label }: UnboundTextProps) {
  const greeting = "hi"
  return (
    <span>{greeting}</span>
  )
}
`

// A PARTIALLY resolvable render tree: both branches share a "div > span"
// root, but the span's own text content differs between branches, so
// `sources/react/jsx.mjs` intersects them and marks that one position
// `{kind: "unresolved"}` rather than guessing which branch's text counts.
const TOGGLE_TSX = `export type ToggleProps = {
  on: boolean
}

export function Toggle({ on }: ToggleProps) {
  if (on) {
    return (
      <div className="acmeToggle">
        <span>On</span>
      </div>
    )
  }
  return (
    <div className="acmeToggle">
      <span>Off</span>
    </div>
  )
}
`

// ADR-002's canonical divergent-roots shape: an `<a>` when `href` is set, a
// `<button>` otherwise. `sources/react/jsx.mjs` declines the component (no
// single tree exists) but CARRIES both branches, so scaffold has a real
// second shape to draft rather than nothing at all (issue #431).
const DIVERGENT_ROOTS_TSX = `export type LinkCtaProps = {
  href?: string
  label: string
}

export function LinkCta({ href, label }: LinkCtaProps) {
  if (href) return <a href={href}>{label}</a>
  return <button>{label}</button>
}
`

// THREE branches, two of which render the SAME root element. Variants are
// told apart by their root element and nothing else (ADR-002 D4), so drafting
// a second `span` variant would make the contract `ambiguous-variant-root` at
// load time — the one thing this drafting path may never produce.
const SHARED_ROOT_BRANCHES_TSX = `export type TrackedLinkProps = {
  href?: string
  pending?: boolean
  label: string
}

export function TrackedLink({ href, pending, label }: TrackedLinkProps) {
  if (href) return <a href={href}>{label}</a>
  if (pending) return <span>{label}</span>
  return <span>unavailable</span>
}
`

// A styled render tree, co-located per `SYNTHETIC_CONVENTIONS.stylesSuffix`
// (issue #236): `root` maps to `.acmeIconButton` (the file's only top-level
// selector); `span`/`label` have no matching selector, so both stay
// unmapped. `padding` is a plain literal (drafts as `raw(4px)`/`raw(8px)`,
// base and the `size: "lg"` modifier); `color` is a `var()` reference whose
// name (`--acme-color-fg`) matches exactly one token in the synthetic
// project's default `tokens.json` fixture (`acme.color.fg`) — the exact-match
// happy path for issue #261, drafting as `{token: "acme.color.fg"}` rather
// than a `_scaffold` todo.
const STYLED_ICON_BUTTON_TSX = `export type IconButtonProps = {
  label: string
  size?: "sm" | "lg"
}

export function IconButton({ label, size = "sm" }: IconButtonProps) {
  return (
    <button className="acmeIconButton">
      <span>{label}</span>
    </button>
  )
}
`

// `STYLED_ICON_BUTTON_TSX` plus a nested custom component, so the drafted
// anatomy carries an `instance` node for the styles pass to skip (#598).
const INSTANCE_ICON_BUTTON_TSX = `export type IconButtonProps = {
  label: string
  size?: "sm" | "lg"
}

export function IconButton({ label, size = "sm" }: IconButtonProps) {
  return (
    <button className="acmeIconButton">
      <Icon />
      <span>{label}</span>
    </button>
  )
}
`

const STYLED_ICON_BUTTON_STYLES = `.acmeIconButton {
  color: var(--acme-color-fg);
  padding: 4px;

  &.lg {
    padding: 8px;
  }
}
`

function customComponents(extra = []) {
  return [
    {
      name: "button",
      dir: "button",
      tsx: BUTTON_TSX,
      // No contract — that's the point of `scaffold`: there isn't one yet.
      contract: undefined,
    },
    ...extra,
  ]
}

function fakeStream() {
  const writes = []
  return { stream: { write: chunk => writes.push(chunk) }, writes }
}

async function runCapture(cmdArgv, { config } = {}) {
  const { stream: stdout, writes: stdoutWrites } = fakeStream()
  const { stream: stderr, writes: stderrWrites } = fakeStream()
  const code = await runScaffold(cmdArgv, {
    globalOpts: { config },
    io: { stdout, stderr },
    bus: undefined,
  })
  return { code, stdout: stdoutWrites.join(""), stderr: stderrWrites.join("") }
}

// `runScaffold` is async (issue #261 — it censuses `tokens.json` before
// drafting), so `fn` may return a pending promise: awaiting it INSIDE `try`
// is load-bearing, not style — a bare `return fn(project)` would let
// `finally`'s `project.cleanup()` delete the fixture while `fn`'s own
// `await`ed work was still reading it.
async function withSyntheticProject(components, fn, overrides = {}) {
  const project = createSyntheticProject({
    ...overrides,
    components: components ?? customComponents(),
  })
  const originalCwd = process.cwd()
  process.chdir(project.root)
  try {
    return await fn(project)
  } finally {
    process.chdir(originalCwd)
    project.cleanup()
  }
}

describe("design-delta scaffold — happy path", () => {
  it("drafts a valid contract from the props census", async () => {
    await withSyntheticProject(undefined, async project => {
      const { code, stdout } = await runCapture(["Button"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      expect(stdout).toMatch(/wrote .*button\.spec\.json/)

      const outputAbs = join(
        project.root,
        SYNTHETIC_PATHS.contractsDir,
        "button.spec.json",
      )
      expect(existsSync(outputAbs)).toBe(true)

      const contract = JSON.parse(readFileSync(outputAbs, "utf8"))
      expect(contract.id).toBe("button")
      expect(contract.title).toBe("Button")
      // Stamped from the schema's own `version` (#365), so a drafted
      // contract states what it was written against from day one.
      expect(contract.schemaVersion).toBe(CONTRACT_SCHEMA_VERSION)
      expect(contract.sources.code.path).toMatch(/button\.tsx$/)
      // Never guessed — see spec/scaffold.mjs's docblock.
      expect(contract.sources.design).toBeUndefined()
      expect(contract.codegen).toBeUndefined()

      expect(contract.props).toEqual({
        active: { type: "boolean", default: false, required: false },
        count: { type: "number", default: 0, required: false },
        label: { type: "string", required: true },
        onPress: { type: "function", required: false },
        size: {
          type: "enum",
          values: ["sm", "lg"],
          default: "sm",
          required: false,
        },
      })

      // The actual Done-means gate: it passes real `contracts` validation.
      const result = loadContracts(project.config, { root: project.root })
      expect(result.diagnostics).toEqual([])
      expect(result.contracts.map(c => c.id)).toContain("button")
    })
  })

  it("--json emits a machine-readable summary instead of the human line", async () => {
    await withSyntheticProject(undefined, async project => {
      const { code, stdout } = await runCapture(["Button", "--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload).toMatchObject({
        command: "scaffold",
        id: "button",
        title: "Button",
        propCount: 5,
      })
    })
  })

  it("declines to draft anatomy when the component's own props census returns null (no-jsx-returned) — props still scaffold", async () => {
    await withSyntheticProject(undefined, async project => {
      const { code } = await runCapture(["Button"], {
        config: project.configPath,
      })
      expect(code).toBe(0)

      const outputAbs = join(
        project.root,
        SYNTHETIC_PATHS.contractsDir,
        "button.spec.json",
      )
      const contract = JSON.parse(readFileSync(outputAbs, "utf8"))
      expect(contract.anatomy).toBeUndefined()
      expect(contract.props).toBeDefined()
    })
  })
})

// ---------------------------------------------------------------------------
// The invariant behind issue #351: whatever scaffold writes, `audit` must
// accept. A generator whose own output fails its own checker is worse than
// no generator — it hands every new contract a false finding to explain away.
// ---------------------------------------------------------------------------

// A literal and an interpolated prop in ONE position — two content children
// where a node carries exactly one `content`. There is no honest single
// binding to draft, so this is the one path that upholds #351's invariant by
// OMITTING `content` rather than by writing it.
const MIXED_CONTENT_TSX = `export type GreetingProps = {
  name: string
}

export function Greeting({ name }: GreetingProps) {
  return <div>Hello {name}</div>
}
`

// The simplest component there is, and the shape that exposed the bug: a root
// whose only child is an interpolated prop. `{label}` is CONTENT, so it
// belongs in the root's own `content`, not in `children` where the anatomy
// checker (which pairs `children` against STRUCTURAL children alone) would
// find nothing to pair it with.
const TEXT_ONLY_TSX = `export type ProbeProps = {
  label: string
}

export function Probe({ label }: ProbeProps) {
  return <div>{label}</div>
}
`

// Accessibility attributes are drafted; framework plumbing never is (#376).
const A11Y_TSX = `export type CloseProps = {
  label: string
  onClose: () => void
}

export function Close({ label, onClose }: CloseProps) {
  return (
    <button
      type="button"
      role="button"
      aria-label="Close"
      aria-haspopup={label}
      className="close"
      data-testid="close"
      onClick={onClose}
    >
      <span aria-hidden="true">x</span>
    </button>
  )
}
`

describe("design-delta scaffold — its output audits clean (issue #351)", () => {
  async function scaffoldThenAudit(project, componentName) {
    const scaffolded = await runCapture([componentName], {
      config: project.configPath,
    })
    expect(scaffolded.code).toBe(0)

    const { stream: stdout, writes } = (() => {
      const w = []
      return { stream: { write: chunk => w.push(chunk) }, writes: w }
    })()
    const code = await run(
      ["audit", "--anatomy", "--json", "--config", project.configPath],
      { stdout, stderr: { write: () => {} } },
    )
    expect(code).toBe(0)
    return JSON.parse(writes.join(""))
  }

  it("a text-only root scaffolds to a contract with no anatomy findings", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "probe",
          dir: "probe",
          tsx: TEXT_ONLY_TSX,
          contract: undefined,
        },
      ]),
      async project => {
        const contractPath = join(
          project.root,
          SYNTHETIC_PATHS.contractsDir,
          "probe.spec.json",
        )
        const payload = await scaffoldThenAudit(project, "Probe")

        const contract = JSON.parse(readFileSync(contractPath, "utf8"))
        expect(contract.anatomy).toEqual({
          root: {
            type: "container",
            element: "div",
            content: { $prop: "label" },
          },
        })
        expect(
          payload.findings.filter(f => f.entity.startsWith("probe")),
        ).toEqual([])
      },
    )
  })

  it("two content values in one position draft a todo, not a guessed binding", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "greeting",
          dir: "greeting",
          tsx: MIXED_CONTENT_TSX,
          contract: undefined,
        },
      ]),
      async project => {
        const payload = await scaffoldThenAudit(project, "Greeting")

        const contract = JSON.parse(
          readFileSync(
            join(
              project.root,
              SYNTHETIC_PATHS.contractsDir,
              "greeting.spec.json",
            ),
            "utf8",
          ),
        )
        // No `content`: one node carries one binding, and picking between
        // "Hello" and `{name}` would present a guess as something read from
        // the code. No `children` either — neither value is structural.
        expect(contract.anatomy.root).toEqual({
          type: "container",
          element: "div",
          _scaffold: {
            todo: "content here renders 2 values, which one `content` binding cannot express — fill in by hand",
          },
        })
        // The invariant still holds on the branch that omits rather than
        // writes: an undeclared `content` is not compared at all.
        expect(
          payload.findings.filter(f => f.entity.startsWith("greeting")),
        ).toEqual([])
      },
    )
  })

  it("drafts accessibility attributes, never framework plumbing, and audits clean (#376)", async () => {
    await withSyntheticProject(
      customComponents([
        { name: "close", dir: "close", tsx: A11Y_TSX, contract: undefined },
      ]),
      async project => {
        const contractPath = join(
          project.root,
          SYNTHETIC_PATHS.contractsDir,
          "close.spec.json",
        )
        const payload = await scaffoldThenAudit(project, "Close")

        const contract = JSON.parse(readFileSync(contractPath, "utf8"))
        expect(contract.anatomy.root.attributes).toEqual({
          "aria-label": "Close",
          role: "button",
          type: "button",
          // `aria-haspopup={label}` is computed — not drafted, not a todo.
          // `className`, `data-testid`, `onClick` — never drafted.
        })
        expect(contract.anatomy.span.attributes).toEqual({
          "aria-hidden": "true",
        })
        expect(contract.anatomy.root._scaffold).toBeUndefined()
        expect(
          payload.findings.filter(f => f.entity.startsWith("close")),
        ).toEqual([])
      },
    )
  })

  it("a nested tree scaffolds to a contract with no anatomy findings", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "icon-button",
          dir: "icon-button",
          tsx: ICON_BUTTON_TSX,
          contract: undefined,
        },
      ]),
      async project => {
        const payload = await scaffoldThenAudit(project, "IconButton")
        expect(
          payload.findings.filter(f => f.entity.startsWith("icon-button")),
        ).toEqual([])
      },
    )
  })
})

describe("design-delta scaffold — anatomy (issue #235)", () => {
  it("drafts anatomy from a fully resolvable render tree", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "icon-button",
          dir: "icon-button",
          tsx: ICON_BUTTON_TSX,
          contract: undefined,
        },
      ]),
      async project => {
        const { code, stdout } = await runCapture(["IconButton", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)

        const payload = JSON.parse(stdout)
        // Three, not four: `{label}` is CONTENT of the span it sits in, so it
        // becomes that node's `content` binding rather than a node of its own
        // — the shape `modules/anatomy.mjs` actually checks (#351).
        expect(payload.anatomyNodeCount).toBe(3)
        expect(payload.anatomyPartial).toBe(false)

        const outputAbs = join(
          project.root,
          SYNTHETIC_PATHS.contractsDir,
          "icon-button.spec.json",
        )
        const contract = JSON.parse(readFileSync(outputAbs, "utf8"))
        expect(contract.anatomy).toEqual({
          root: {
            type: "container",
            element: "button",
            children: ["icon", "span"],
          },
          icon: {
            type: "instance",
            instanceOf: "Icon",
            _scaffold: { todo: "confirm instanceOf names the right contract" },
          },
          span: {
            type: "container",
            element: "span",
            content: { $prop: "label" },
          },
        })

        // The Done-means gate: it passes real `contracts` validation.
        const result = loadContracts(project.config, { root: project.root })
        expect(result.diagnostics).toEqual([])
      },
    )
  })

  it("drafts the resolved portion of a partial tree with a clearly-marked placeholder for the rest", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "toggle",
          dir: "toggle",
          tsx: TOGGLE_TSX,
          contract: undefined,
        },
      ]),
      async project => {
        const { code, stdout } = await runCapture(["Toggle", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)

        const payload = JSON.parse(stdout)
        expect(payload.anatomyPartial).toBe(true)

        const outputAbs = join(
          project.root,
          SYNTHETIC_PATHS.contractsDir,
          "toggle.spec.json",
        )
        const contract = JSON.parse(readFileSync(outputAbs, "utf8"))
        expect(contract.anatomy.root).toEqual({
          type: "container",
          element: "div",
          children: ["span"],
        })
        expect(contract.anatomy.span).toEqual({
          type: "container",
          element: "span",
          children: ["unresolved"],
        })
        // Never a silently incomplete tree — the disagreeing position gets a
        // node, never guessed content, and a `_scaffold` note to review.
        expect(contract.anatomy.unresolved).toEqual({
          type: "container",
          _scaffold: {
            todo: "structure here could not be resolved from the code — fill in by hand",
          },
        })

        const result = loadContracts(project.config, { root: project.root })
        expect(result.diagnostics).toEqual([])
      },
    )
  })

  it("never binds content to an identifier that isn't a declared prop", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "unbound-text",
          dir: "unbound-text",
          tsx: UNBOUND_TEXT_TSX,
          contract: undefined,
        },
      ]),
      async project => {
        const { code } = await runCapture(["UnboundText"], {
          config: project.configPath,
        })
        expect(code).toBe(0)

        const outputAbs = join(
          project.root,
          SYNTHETIC_PATHS.contractsDir,
          "unbound-text.spec.json",
        )
        const contract = JSON.parse(readFileSync(outputAbs, "utf8"))
        // "greeting" is not in `props` — never guessed as a `$prop` binding.
        // The todo lands on the node that WOULD have carried the binding,
        // since content belongs to its parent now (#351).
        expect(contract.anatomy.root).toEqual({
          type: "container",
          element: "span",
          _scaffold: {
            todo: 'content here binds "greeting", which is not a declared prop — fill in by hand',
          },
        })

        // The actual regression: this must still pass real validation.
        const result = loadContracts(project.config, { root: project.root })
        expect(result.diagnostics).toEqual([])
      },
    )
  })
})

describe("design-delta scaffold — anatomy variants (issue #431)", () => {
  it("drafts a base anatomy plus a `$variants` entry per further branch", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "link-cta",
          dir: "link-cta",
          tsx: DIVERGENT_ROOTS_TSX,
          contract: undefined,
        },
      ]),
      async project => {
        const { code, stdout } = await runCapture(["LinkCta", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)

        const payload = JSON.parse(stdout)
        // `$variants` is a sigil, not a node — it must not inflate the count.
        expect(payload.anatomyNodeCount).toBe(1)
        expect(payload.anatomyVariantCount).toBe(1)

        const outputAbs = join(
          project.root,
          SYNTHETIC_PATHS.contractsDir,
          "link-cta.spec.json",
        )
        const contract = JSON.parse(readFileSync(outputAbs, "utf8"))
        expect(contract.anatomy).toEqual({
          // The FIRST branch is the base tree; every later one is an override.
          root: {
            type: "container",
            element: "a",
            content: { $prop: "label" },
          },
          $variants: {
            // Named from its own root element, in the schema's node casing —
            // the `asLink` shape ADR-002 D2 writes by hand.
            asButton: {
              // Never an invented condition: `when` is documentation the
              // engine cannot check (D4), so it is drafted as a placeholder
              // and marked for the author like every other unresolved value.
              when: "TODO: say when this branch renders",
              _scaffold: {
                todo: "`when` is documentation for a human reader, never a condition this engine evaluates (ADR-002 D4) — say when this branch renders",
              },
              // Only the node that DIFFERS from the base (D3, partial
              // override) — nothing the two branches agree on is repeated.
              root: {
                type: "container",
                element: "button",
                content: { $prop: "label" },
              },
            },
          },
        })

        // The Done-means gate: schema + semantics, `ambiguous-variant-root`
        // included.
        const result = loadContracts(project.config, { root: project.root })
        expect(result.diagnostics).toEqual([])
      },
    )
  })

  it("never drafts two variants claiming the same root element", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "tracked-link",
          dir: "tracked-link",
          tsx: SHARED_ROOT_BRANCHES_TSX,
          contract: undefined,
        },
      ]),
      async project => {
        const { code } = await runCapture(["TrackedLink"], {
          config: project.configPath,
        })
        expect(code).toBe(0)

        const outputAbs = join(
          project.root,
          SYNTHETIC_PATHS.contractsDir,
          "tracked-link.spec.json",
        )
        const contract = JSON.parse(readFileSync(outputAbs, "utf8"))
        // Two branches render a `span`. The first becomes `asSpan`; the second
        // has nothing to tell it apart from that one, so it is reported rather
        // than drafted — a guess here is a contract the loader rejects.
        expect(Object.keys(contract.anatomy.$variants).sort()).toEqual([
          "_scaffold",
          "asSpan",
        ])
        expect(contract.anatomy.$variants._scaffold.todo).toContain('"span"')

        const result = loadContracts(project.config, { root: project.root })
        expect(result.diagnostics).toEqual([])
      },
    )
  })

  it("still omits anatomy entirely for a decline that carries no branches", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "badge",
          dir: "badge",
          tsx: `export type BadgeProps = {
  label: string
}

export function Badge({ label }: BadgeProps) {
  return label ? <span>{label}</span> : <b>{label}</b>
}
`,
          contract: undefined,
        },
      ]),
      async project => {
        const { code, stdout } = await runCapture(["Badge", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)

        const payload = JSON.parse(stdout)
        expect(payload.anatomyNodeCount).toBe(0)
        expect(payload.anatomyVariantCount).toBe(0)

        const outputAbs = join(
          project.root,
          SYNTHETIC_PATHS.contractsDir,
          "badge.spec.json",
        )
        const contract = JSON.parse(readFileSync(outputAbs, "utf8"))
        // A conditional root carries no `branches`, so the omit-don't-guess
        // rule is untouched by #431 — there is still nothing to draft.
        expect(contract.anatomy).toBeUndefined()
      },
    )
  })
})

describe("design-delta scaffold — styles (issue #236)", () => {
  it("drafts base + variant styles for a mapped element, resolving a var() that matches exactly one token (issue #261)", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "icon-button",
          dir: "icon-button",
          tsx: STYLED_ICON_BUTTON_TSX,
          styles: STYLED_ICON_BUTTON_STYLES,
          contract: undefined,
        },
      ]),
      async project => {
        const { code, stdout } = await runCapture(["IconButton", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)

        const payload = JSON.parse(stdout)
        expect(payload.stylesFile).toMatch(/icon-button\.styles\.scss$/)
        expect(payload.styleElementCount).toBe(1)
        // "span" has no matching selector in the stylesheet. (There is no
        // separate "label" node any more — see #351.)
        expect(payload.styleUnmappedCount).toBe(1)
        // "color" resolved to the one token whose name matches — see the
        // fixture comment above.
        expect(payload.styleTokenBindingCount).toBe(1)

        const outputAbs = join(
          project.root,
          SYNTHETIC_PATHS.contractsDir,
          "icon-button.spec.json",
        )
        const contract = JSON.parse(readFileSync(outputAbs, "utf8"))
        expect(contract.sources.code.styles).toMatch(
          /icon-button\.styles\.scss$/,
        )
        expect(contract.styles).toEqual({
          root: {
            base: {
              color: { token: "acme.color.fg" },
              padding: {
                blockStart: "raw(4px)",
                blockEnd: "raw(4px)",
                inlineStart: "raw(4px)",
                inlineEnd: "raw(4px)",
              },
            },
            variants: [
              {
                when: { size: "lg" },
                padding: {
                  blockStart: "raw(8px)",
                  blockEnd: "raw(8px)",
                  inlineStart: "raw(8px)",
                  inlineEnd: "raw(8px)",
                },
              },
            ],
          },
        })
        // Never a false "unmapped element could not be found" — the caller
        // decided "span"/"label" are unmapped and just left them out.
        expect(contract.styles.span).toBeUndefined()
        expect(contract.styles.label).toBeUndefined()

        // The Done-means gate: it passes real `contracts` validation.
        const result = loadContracts(project.config, { root: project.root })
        expect(result.diagnostics).toEqual([])
      },
    )
  })

  it("leaves a var() matching zero tokens as a _scaffold todo (issue #261)", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "icon-button",
          dir: "icon-button",
          tsx: STYLED_ICON_BUTTON_TSX,
          // No token in the default synthetic `tokens.json` derives this var
          // name — zero matches, same behavior as before this issue.
          styles: `.acmeIconButton {
  color: var(--acme-color-unknown);
}
`,
          contract: undefined,
        },
      ]),
      async project => {
        const { code, stdout } = await runCapture(["IconButton", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        const payload = JSON.parse(stdout)
        expect(payload.styleTokenBindingCount).toBe(0)

        const outputAbs = join(
          project.root,
          SYNTHETIC_PATHS.contractsDir,
          "icon-button.spec.json",
        )
        const contract = JSON.parse(readFileSync(outputAbs, "utf8"))
        expect(contract.styles.root._scaffold).toEqual({
          todo: "color (var(--acme-color-unknown)) is token-bound — fill in by hand",
        })
        expect(contract.styles.root.base?.color).toBeUndefined()

        const result = loadContracts(project.config, { root: project.root })
        expect(result.diagnostics).toEqual([])
      },
    )
  })

  it("leaves a var() matching 2+ tokens as a _scaffold todo naming every match, never a guess (issue #261, #191)", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "icon-button",
          dir: "icon-button",
          tsx: STYLED_ICON_BUTTON_TSX,
          styles: STYLED_ICON_BUTTON_STYLES,
          contract: undefined,
        },
      ]),
      async project => {
        const { code, stdout } = await runCapture(["IconButton", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        const payload = JSON.parse(stdout)
        expect(payload.styleTokenBindingCount).toBe(0)

        const outputAbs = join(
          project.root,
          SYNTHETIC_PATHS.contractsDir,
          "icon-button.spec.json",
        )
        const contract = JSON.parse(readFileSync(outputAbs, "utf8"))
        const todo = contract.styles.root._scaffold.todo
        expect(todo).toMatch(
          /^color \(var\(--acme-color-fg\)\) matches multiple tokens \(/,
        )
        expect(todo).toContain("acme.color.fg")
        expect(todo).toContain("acme.colorFg")
        expect(contract.styles.root.base?.color).toBeUndefined()

        const result = loadContracts(project.config, { root: project.root })
        expect(result.diagnostics).toEqual([])
      },
      // `acme.colorFg` and `acme.color.fg` both derive the same candidate CSS
      // var name (`--acme-color-fg`) — several tokens legitimately sharing
      // one var (#191), the ambiguous case this issue must never guess among.
      { tokens: { acme: { colorFg: { $type: "color", $value: "#222222" } } } },
    )
  })

  it("omits styles entirely when no style file exists on disk", async () => {
    await withSyntheticProject(undefined, async project => {
      const { code, stdout } = await runCapture(["Button", "--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.stylesFile).toBeUndefined()
      expect(payload.styleElementCount).toBe(0)

      const outputAbs = join(
        project.root,
        SYNTHETIC_PATHS.contractsDir,
        "button.spec.json",
      )
      const contract = JSON.parse(readFileSync(outputAbs, "utf8"))
      expect(contract.sources.code.styles).toBeUndefined()
      expect(contract.styles).toBeUndefined()
    })
  })

  // Issue #598: the branches that decide what a variant or element
  // contributes when its stylesheet maps only partly.
  it("skips an instance node, drops a variant that drafts nothing, and keeps a todo-only variant", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "icon-button",
          dir: "icon-button",
          tsx: INSTANCE_ICON_BUTTON_TSX,
          // `cursor` is no property `PROPERTY_DEFS` maps, so the `lg`
          // modifier drafts neither a prop nor a todo; the `sm` modifier's
          // var matches no token, so it drafts a todo and nothing else.
          styles: `.acmeIconButton {
  padding: 4px;

  &.lg {
    cursor: pointer;
  }

  &.sm {
    color: var(--acme-color-unknown);
  }
}
`,
          contract: undefined,
        },
      ]),
      async project => {
        const { code, stdout } = await runCapture(["IconButton", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        const payload = JSON.parse(stdout)
        // Only "span" counts as unmapped: "icon" is an instance, styled by
        // its own contract, and never looked up here at all.
        expect(payload.styleUnmappedCount).toBe(1)
        expect(payload.styleElementCount).toBe(1)

        const outputAbs = join(
          project.root,
          SYNTHETIC_PATHS.contractsDir,
          "icon-button.spec.json",
        )
        const contract = JSON.parse(readFileSync(outputAbs, "utf8"))
        expect(contract.styles).toEqual({
          root: {
            base: {
              padding: {
                blockStart: "raw(4px)",
                blockEnd: "raw(4px)",
                inlineStart: "raw(4px)",
                inlineEnd: "raw(4px)",
              },
            },
            variants: [
              {
                when: { size: "sm" },
                _scaffold: {
                  todo: "color (var(--acme-color-unknown)) is token-bound — fill in by hand",
                },
              },
            ],
          },
        })

        const result = loadContracts(project.config, { root: project.root })
        expect(result.diagnostics).toEqual([])
      },
    )
  })

  it("omits styles, never writes `{}`, when a style file exists but no element drafts anything", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "icon-button",
          dir: "icon-button",
          tsx: STYLED_ICON_BUTTON_TSX,
          styles: `.acmeIconButton {
  cursor: pointer;
}
`,
          contract: undefined,
        },
      ]),
      async project => {
        const { code, stdout } = await runCapture(["IconButton", "--json"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        const payload = JSON.parse(stdout)
        expect(payload.stylesFile).toMatch(/icon-button\.styles\.scss$/)
        expect(payload.styleElementCount).toBe(0)

        const outputAbs = join(
          project.root,
          SYNTHETIC_PATHS.contractsDir,
          "icon-button.spec.json",
        )
        const contract = JSON.parse(readFileSync(outputAbs, "utf8"))
        // The style file is still named — it was found and read...
        expect(contract.sources.code.styles).toMatch(
          /icon-button\.styles\.scss$/,
        )
        // ...but drafted nothing, so the block is absent, not an empty shell.
        expect(contract).not.toHaveProperty("styles")
      },
    )
  })
})

describe("design-delta scaffold — refuses rather than guesses", () => {
  it("refuses when no <Component> argument is given", async () => {
    await withSyntheticProject(undefined, async project => {
      const { code, stderr } = await runCapture([], {
        config: project.configPath,
      })
      expect(code).toBe(1)
      expect(stderr).toMatch(/expected exactly one <Component> argument, got 0/)
    })
  })

  it("refuses a non-PascalCase argument", async () => {
    await withSyntheticProject(undefined, async project => {
      const { code, stderr } = await runCapture(["button"], {
        config: project.configPath,
      })
      expect(code).toBe(1)
      expect(stderr).toMatch(/not PascalCase/)
    })
  })

  it("refuses with no partial file when no component file matches", async () => {
    await withSyntheticProject(undefined, async project => {
      const { code, stderr } = await runCapture(["Nonexistent"], {
        config: project.configPath,
      })
      expect(code).toBe(1)
      expect(stderr).toMatch(/no component file matches/)
      expect(
        existsSync(
          join(
            project.root,
            SYNTHETIC_PATHS.contractsDir,
            "nonexistent.spec.json",
          ),
        ),
      ).toBe(false)
    })
  })

  it("refuses an ambiguous name match rather than guessing which file", async () => {
    await withSyntheticProject(
      customComponents([
        {
          // Same `name` ("button") as the base fixture's component — the
          // harness writes the file at `<dir>/<name>.tsx`, so this is a
          // second `button.tsx` under a different directory. The match is
          // on basename, not directory name.
          name: "button",
          dir: "button-2",
          tsx: BUTTON_TSX,
          contract: undefined,
        },
      ]),
      async project => {
        const { code, stderr } = await runCapture(["Button"], {
          config: project.configPath,
        })
        expect(code).toBe(1)
        expect(stderr).toMatch(/matches more than one file/)
      },
    )
  })

  it("never overwrites an existing contract", async () => {
    await withSyntheticProject(undefined, async project => {
      const outputAbs = join(
        project.root,
        SYNTHETIC_PATHS.contractsDir,
        "button.spec.json",
      )
      mkdirSync(join(project.root, SYNTHETIC_PATHS.contractsDir), {
        recursive: true,
      })
      writeFileSync(outputAbs, '{"id":"button","title":"Button"}\n')

      const { code, stderr } = await runCapture(["Button"], {
        config: project.configPath,
      })
      expect(code).toBe(1)
      expect(stderr).toMatch(/already exists/)
      // Untouched — not silently regenerated over a hand-edited file.
      expect(readFileSync(outputAbs, "utf8")).toBe(
        '{"id":"button","title":"Button"}\n',
      )
    })
  })

  // Issue #598: the single-component path's half of "props could not be
  // read" — `--uncontracted` skips the file, this path refuses it outright.
  it("refuses with no partial file when the component's props cannot be read", async () => {
    await withSyntheticProject(
      customComponents([
        { name: "weird", dir: "weird", tsx: WEIRD_TSX, contract: undefined },
      ]),
      async project => {
        const { code, stdout, stderr } = await runCapture(["Weird"], {
          config: project.configPath,
        })
        expect(code).toBe(1)
        expect(stdout).toBe("")
        // The census's own reason, not the generic fallback.
        expect(stderr).toMatch(
          /^design-delta scaffold: "Weird"'s props could not be read \(.+\) — refusing to write a partial contract\n$/,
        )
        expect(stderr).not.toMatch(/extraction failed/)
        expect(
          existsSync(
            join(project.root, SYNTHETIC_PATHS.contractsDir, "weird.spec.json"),
          ),
        ).toBe(false)
      },
    )
  })

  it("exits 1 naming each flag error before reading any config", async () => {
    await withSyntheticProject(undefined, async project => {
      const { code, stdout, stderr } = await runCapture(["Button", "--bogus"], {
        config: project.configPath,
      })
      expect(code).toBe(1)
      expect(stdout).toBe("")
      expect(stderr).toBe(
        'design-delta scaffold: Unknown argument "--bogus".\n',
      )
    })
  })

  it("exits 1 with the config error when --config names no file", async () => {
    await withSyntheticProject(undefined, async project => {
      const missing = join(project.root, "absent.json")
      const { code, stdout, stderr } = await runCapture(["Button"], {
        config: missing,
      })
      expect(code).toBe(1)
      expect(stdout).toBe("")
      expect(stderr).toBe(`design-delta scaffold: no config at ${missing}\n`)
      expect(
        existsSync(
          join(project.root, SYNTHETIC_PATHS.contractsDir, "button.spec.json"),
        ),
      ).toBe(false)
    })
  })
})

// A component whose props parameter carries no type annotation — confirmed
// (an exported function IS found) but unreadable (`untyped-props-parameter`),
// so it lands on the `coverage/uncontracted-component` worklist without ever
// joining `census.components` — the same file `matches[0]` refuses to draft
// a partial contract for in the single-`<Component>` path.
const WEIRD_TSX = `export function Weird(props) {
  return null
}
`

// A single already-contracted component — every uncontracted-mode test that
// needs an EMPTY worklist uses this, since \`customComponents()\`'s own
// default ("button", deliberately left uncontracted) would defeat the point.
function contractedOnlyComponents() {
  return [
    {
      name: "widget",
      dir: "widget",
      tsx: `export type WidgetProps = {
  label: string
}

export function Widget({ label }: WidgetProps) {
  return null
}
`,
      contract: {
        id: "widget",
        title: "Widget",
        sources: {
          code: { path: `${SYNTHETIC_PATHS.componentsDir}/widget/widget.tsx` },
        },
      },
    },
  ]
}

describe("design-delta scaffold --uncontracted (issue #263)", () => {
  it("drafts a contract for every uncontracted component in one pass, skipping ones already contracted", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "icon-button",
          dir: "icon-button",
          tsx: ICON_BUTTON_TSX,
          contract: undefined,
        },
        {
          name: "widget",
          dir: "widget",
          tsx: `export type WidgetProps = {
  label: string
}

export function Widget({ label }: WidgetProps) {
  return null
}
`,
          contract: {
            id: "widget",
            title: "Widget",
            sources: {
              code: {
                path: `${SYNTHETIC_PATHS.componentsDir}/widget/widget.tsx`,
              },
            },
          },
        },
      ]),
      async project => {
        const { code, stdout } = await runCapture(["--uncontracted"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        expect(stdout).toMatch(/wrote .*button\.spec\.json/)
        expect(stdout).toMatch(/wrote .*icon-button\.spec\.json/)
        expect(stdout).not.toMatch(/widget/)

        expect(
          existsSync(
            join(
              project.root,
              SYNTHETIC_PATHS.contractsDir,
              "button.spec.json",
            ),
          ),
        ).toBe(true)
        expect(
          existsSync(
            join(
              project.root,
              SYNTHETIC_PATHS.contractsDir,
              "icon-button.spec.json",
            ),
          ),
        ).toBe(true)

        // The already-contracted component was never touched.
        const widgetContract = JSON.parse(
          readFileSync(
            join(
              project.root,
              SYNTHETIC_PATHS.contractsDir,
              "widget.spec.json",
            ),
            "utf8",
          ),
        )
        expect(widgetContract.props).toBeUndefined()

        // Every drafted contract still passes real validation.
        const result = loadContracts(project.config, { root: project.root })
        expect(result.diagnostics).toEqual([])
      },
    )
  })

  it("titles a drafted contract from the real exported name, not a filename guess (issue #321)", async () => {
    // `apibutton.tsx` -> `titleFromFile` would guess "Apibutton" (no hyphen
    // to split the acronym on); the component's real exported name is
    // `APIButton`, which the census now carries and scaffold must prefer.
    await withSyntheticProject(
      customComponents([
        {
          name: "apibutton",
          dir: "apibutton",
          tsx: `export type APIButtonProps = {
  label: string
}

export function APIButton({ label }: APIButtonProps) {
  return null
}
`,
          contract: undefined,
        },
      ]),
      async project => {
        const { code } = await runCapture(["--uncontracted"], {
          config: project.configPath,
        })
        expect(code).toBe(0)

        const contract = JSON.parse(
          readFileSync(
            join(
              project.root,
              SYNTHETIC_PATHS.contractsDir,
              "apibutton.spec.json",
            ),
            "utf8",
          ),
        )
        expect(contract.title).toBe("APIButton")
        expect(contract.id).toBe("apibutton")
      },
    )
  })

  it("--json emits an array of the same per-component records the single path emits", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "icon-button",
          dir: "icon-button",
          tsx: ICON_BUTTON_TSX,
          contract: undefined,
        },
      ]),
      async project => {
        const { code, stdout } = await runCapture(
          ["--uncontracted", "--json"],
          {
            config: project.configPath,
          },
        )
        expect(code).toBe(0)

        const payload = JSON.parse(stdout)
        expect(Array.isArray(payload)).toBe(true)
        expect(payload).toHaveLength(2)
        // Same record shape the single-`<Component>` path publishes, one per
        // component, in worklist order.
        expect(payload[0]).toMatchObject({
          command: "scaffold",
          id: "button",
          title: "Button",
          file: `${SYNTHETIC_PATHS.componentsDir}/button/button.tsx`,
          propCount: 5,
        })
        expect(payload[1]).toMatchObject({
          command: "scaffold",
          id: "icon-button",
          title: "IconButton",
          file: `${SYNTHETIC_PATHS.componentsDir}/icon-button/icon-button.tsx`,
        })
        expect(payload[1].output).toMatch(/icon-button\.spec\.json$/)
      },
    )
  })

  it("--json emits an empty array when nothing is uncontracted", async () => {
    await withSyntheticProject(contractedOnlyComponents(), async project => {
      const { code, stdout } = await runCapture(["--uncontracted", "--json"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload).toEqual([])
    })
  })

  it("drafts every uncontracted component even when one's props are unreadable, and does not abort the pass", async () => {
    await withSyntheticProject(
      customComponents([
        { name: "weird", dir: "weird", tsx: WEIRD_TSX, contract: undefined },
      ]),
      async project => {
        const { code, stdout, stderr } = await runCapture(["--uncontracted"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        expect(stdout).toMatch(/wrote .*button\.spec\.json/)
        expect(stderr).toMatch(/skipping ".*weird\.tsx"/)
        expect(stderr).toMatch(/its props could not be read/)
        expect(
          existsSync(
            join(project.root, SYNTHETIC_PATHS.contractsDir, "weird.spec.json"),
          ),
        ).toBe(false)
      },
    )
  })

  it("skips (never overwrites) a component whose output path collides with an existing file, without aborting the pass", async () => {
    await withSyntheticProject(
      customComponents([
        {
          name: "icon-button",
          dir: "icon-button",
          tsx: ICON_BUTTON_TSX,
          contract: undefined,
        },
      ]),
      async project => {
        const collidingAbs = join(
          project.root,
          SYNTHETIC_PATHS.contractsDir,
          "button.spec.json",
        )
        mkdirSync(join(project.root, SYNTHETIC_PATHS.contractsDir), {
          recursive: true,
        })
        writeFileSync(collidingAbs, '{"id":"button","title":"Button"}\n')

        const { code, stdout, stderr } = await runCapture(["--uncontracted"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        expect(stderr).toMatch(
          /skipping "Button" — .*button\.spec\.json already exists/,
        )
        expect(stdout).toMatch(/wrote .*icon-button\.spec\.json/)
        expect(readFileSync(collidingAbs, "utf8")).toBe(
          '{"id":"button","title":"Button"}\n',
        )
      },
    )
  })

  it("does not claim nothing is uncontracted when every uncontracted component was skipped", async () => {
    await withSyntheticProject(
      [
        ...contractedOnlyComponents(),
        { name: "weird", dir: "weird", tsx: WEIRD_TSX, contract: undefined },
      ],
      async project => {
        const { code, stdout, stderr } = await runCapture(["--uncontracted"], {
          config: project.configPath,
        })
        expect(code).toBe(0)
        // Nothing was written, but the worklist was not empty — saying it was
        // would assert a complete contract set that does not exist.
        expect(stdout).not.toMatch(/no uncontracted components found/)
        expect(stderr).toMatch(/skipping ".*weird\.tsx"/)
      },
    )
  })

  it("says so and exits 0 when nothing is uncontracted", async () => {
    await withSyntheticProject(contractedOnlyComponents(), async project => {
      const { code, stdout } = await runCapture(["--uncontracted"], {
        config: project.configPath,
      })
      expect(code).toBe(0)
      expect(stdout).toMatch(/no uncontracted components found/)
    })
  })

  it("is a flag error when combined with a positional <Component>", async () => {
    await withSyntheticProject(contractedOnlyComponents(), async project => {
      const { code, stderr } = await runCapture(["--uncontracted", "Button"], {
        config: project.configPath,
      })
      expect(code).toBe(1)
      expect(stderr).toMatch(/--uncontracted takes no <Component> argument/)
    })
  })
})
