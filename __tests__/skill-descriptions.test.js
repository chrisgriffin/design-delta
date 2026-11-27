/**
 * skill-descriptions.test.js — #55: every stub `dock`/`init` write into a
 * consumer's `.claude/skills/` copies its packaged skill's frontmatter
 * `description`, because that is the line Claude Code matches a request
 * against. A version bump updates everything a stub points at, but not that
 * copy: a consumer keeps the old description until they re-run `dock`. So a
 * description changes only on purpose, and this pin is where the purpose is
 * recorded. Changing one here is the deliberate act; `dock --check` is what
 * then tells a consumer their stub is stale.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { LINKED_SKILLS, skillRelativePath } from "../src/cli/commands/dock.mjs"

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

// The router's description is deliberately broad: it is the one stub every
// consumer has, so a skill added in a release is reached through it with no
// new stub. It should never need to change.
const PINNED = {
  "design-delta":
    "Anything design-delta in a project — run or interpret an audit of its code and its design tool against the per-component *.contract.json contracts, write or change a contract, build a component to its contract, write a component's documentation page, add, rename, deprecate or remove a design token, refresh the design snapshot, or work a list of findings down. Use for any design-delta, design-system, contract or design-token request, or when a component or token looks out of sync with its contract — this skill routes to the packaged procedure for the task.",
  "design-delta-build":
    "Build a component from its *.contract.json contract — generate the files the contract's sources name so every prop, default, enum value, slot, anatomy element and token binding is realized the way this project's other components do it, then run the design-delta audit until that component reports no findings. Use when asked to build, add, implement or generate a component from a contract, or to bring a component's code back in line after its contract changed.",
  "design-delta-author":
    "Author a component's *.contract.json contract — from a described component, from a design-tool component in the project's design snapshot, or from existing code — so that it validates and states every decision, props, types, defaults, enum values, slots, anatomy, token bindings and sources, asking rather than inventing wherever the request leaves the component's API open. Use when asked to write, draft, add or finish a contract, to spec a new component, or when a build stopped because a component has no contract.",
  "design-delta-refresh":
    "Refresh the design side of a design-delta project — confirm a design provider is configured, read how old each committed design snapshot is, run gather, execute the plan it prints with the session's design-tool tools, save each raw response where the plan says, ingest, then audit and report what changed on the design side. Use when asked to refresh, re-gather or update the design snapshot, when a design-side finding may rest on a stale snapshot, or before trusting any contract-to-design result.",
  "design-delta-resolve":
    "Work down a project's design-delta findings — group every finding by rule, side and entity, separate what code can clear from contract questions, design-side findings, token and config decisions and findings that need a person, fix the code-side drift one component at a time through the build skill's update procedure, and end with a report of what was cleared, what is left and who owns each remainder. Use when an audit reports many findings, when asked to clean up, reduce or burn down drift, or to turn a long design-delta report into something each owner can act on.",
  "design-delta-docs":
    "Write or refresh a component's documentation page from its *.contract.json contract — purpose, props with types, defaults and enum values, slots, states, anatomy, the token each element binds, and usage guidance — in the documentation format this project already uses, stating only what the contract states and marking every place it is silent as needing a person, so that running it again after the contract changes rewrites only the generated parts. Use when asked to document a component, to write, generate or update its documentation page, or when a component's page no longer matches its contract.",
  "design-delta-adopt":
    "Adopt design-delta in an existing codebase that has never used it — install the package and run init (or confirm the config already there), take the first audit, read its coverage findings as the authoring worklist and order it by how widely each component is used, author contracts one component at a time through the authoring skill starting from the code, write the snapshot baseline so later findings carry isNew, wire verify into CI through the package's GitHub Action at the strictest threshold the project already passes, and hand the remaining findings to the resolve skill with a report of what is left and who owns it. Use when asked to set up, adopt, install, onboard or roll out design-delta in a project, or to get a project from no contracts to a working CI gate.",
  "design-delta-token":
    "Change a project's DTCG tokens file — add a token, rename one, or deprecate or remove one — listing first everything the change touches (the code that references the token, the contracts that bind it, the tokens that alias it and the config entries that name it), asking rather than inventing the token's name, tier and value, editing only the tokens file, and handing every contract and code edit the change needs to the authoring and build skills. Use when a component needs a token the project does not have, when asked to add, rename, deprecate or remove a design token, or when a contract or build stopped on a missing token.",
}

const STALE =
  "Every consumer keeps the old description in their stub until they re-run " +
  "`design-delta dock`, so change it only on purpose: update the pin in " +
  "__tests__/skill-descriptions.test.js in the same change."

function packagedDescription(name) {
  const text = readFileSync(join(PACKAGE_ROOT, skillRelativePath(name)), "utf8")
  return text.match(/^description: (.+)$/m)?.[1]
}

describe("#55 the description of every skill a stub links is pinned", () => {
  it("pins exactly the router and the skills dock links", () => {
    const linked = ["design-delta", ...LINKED_SKILLS].sort()
    const pinned = Object.keys(PINNED).sort()
    const unpinned = linked.filter(name => !pinned.includes(name))
    const unlinked = pinned.filter(name => !linked.includes(name))
    if (unpinned.length || unlinked.length) {
      throw new Error(
        `Pinned descriptions and linked skills disagree. Not pinned: ${unpinned.join(", ") || "none"}. ` +
          `Pinned but not linked: ${unlinked.join(", ") || "none"}. ${STALE}`,
      )
    }
  })

  it.each(Object.keys(PINNED))("%s matches its pin", name => {
    const actual = packagedDescription(name)
    if (actual !== PINNED[name]) {
      throw new Error(
        `skills/${name}/SKILL.md's description changed.\n` +
          `  pinned: ${PINNED[name]}\n  actual: ${actual}\n${STALE}`,
      )
    }
  })
})
