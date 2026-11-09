/**
 * index.mjs — `design.provider`'s config key → the provider module (ADR-001
 * D12, ADR-003 Phase 5.1). `providers: ["core"]` in the layering test — this
 * file imports NOTHING from `figma/`'s siblings statically; every provider
 * is reached through a dynamic `import()`, so `cli/` (the only other layer
 * allowed to import `providers/`) never has to know which provider modules
 * exist to select one.
 *
 * A static allowlist of import()s, not a string-built path from the config
 * value: `design.provider` is project-authored input, and building a module
 * specifier out of it directly would let a config typo (or something worse)
 * resolve an arbitrary path.
 */

const LOADERS = {
  figma: () => import("./figma/index.mjs"),
}

/**
 * The provider keys `loadProvider` can resolve, for a caller (`init`'s
 * design-provider prompt) that needs to offer the known set without
 * duplicating it.
 *
 * @returns {string[]}
 */
export function listProviders() {
  return Object.keys(LOADERS)
}

/**
 * @param {object} config the project's (unresolved) config — only
 *   `design.provider` is read from it
 * @returns {Promise<{ok: true, provider: object} | {ok: false, reason: string}>}
 */
export async function loadProvider(config) {
  const key = config?.design?.provider
  if (typeof key !== "string" || key.length === 0) {
    return { ok: false, reason: "no design.provider configured" }
  }
  // `Object.hasOwn`, not `LOADERS[key]` truthiness alone: a config value of
  // "constructor"/"toString"/etc. would otherwise resolve an inherited
  // `Object.prototype` member as if it were a real loader.
  const loader = Object.hasOwn(LOADERS, key) ? LOADERS[key] : undefined
  if (!loader) {
    return {
      ok: false,
      reason: `design.provider "${key}" is not a known provider (known: ${Object.keys(LOADERS).join(", ")})`,
    }
  }
  const provider = await loader()
  return { ok: true, provider }
}
