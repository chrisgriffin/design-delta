/**
 * extract.mjs — the code-side prop/API census (ADR-001 D10/D13, Phase 1,
 * issue #98): reads each component's exported props type directly off the
 * **TypeScript compiler API**, per `docs/spikes/prop-extraction.md`.
 *
 * That spike ran `react-docgen-typescript` against a real design system and
 * rejected it: it silently drops `children` even when declared first-party,
 * which would turn the very first contract that carries a `children` prop
 * into a false finding — disqualifying for a checker whose acceptance gate is
 * *zero* false findings. This module exists to control that one behavior
 * (and the two adjacent ones the spike also measured — enum values leaking
 * `undefined`, and first-party/`node_modules` intersection-arm filtering)
 * directly, rather than adapting someone else's undocumented heuristics.
 *
 * `typescript` is loaded LAZILY, via `createRequire` at call time, never as a
 * top-level import — it is an OPTIONAL peer dependency (same reasoning v1
 * had for the same lazy-load: importing the compiler eagerly crashed under
 * jsdom), so a consumer who never runs the components check does not need it
 * installed. A missing/unresolvable module NEVER throws: it degrades to
 * `{ok: false, …, diagnostics}` with a clear "install typescript" message,
 * the same honest-degradation rule `sources/code.mjs` and `spec/contracts.mjs`
 * both follow.
 *
 * THE INTERSECTION WALK (the spike's central finding): a component's props
 * type is commonly `{…local…} & OtherFirstPartyProps & ButtonHTMLAttributes<…>`.
 * Rather than resolving the whole type and asking the checker to flatten it
 * (which collapses to `any` — and therefore to ZERO properties — the moment
 * any arm references an unresolvable module, e.g. an uninstalled `react`),
 * this module walks the INTERSECTION'S OWN TYPE NODES itself:
 *
 *   - a `{ … }` type literal is always first-party — its members come
 *     straight from the AST, independent of any other arm's resolvability;
 *   - a named arm (`OtherFirstPartyProps`, `HTMLAttributes<…>`) is resolved
 *     via the checker to its declaration(s), and is walked ONLY when that
 *     declaration's own source file does not contain `node_modules` — the
 *     spike's explicit call: "decide first-party by the declaration's source
 *     file path, not a heuristic";
 *   - an arm that cannot be resolved at all (an uninstalled peer) is treated
 *     the same as a `node_modules` exclusion: nothing about it is known, so
 *     nothing about it is asserted. This is what keeps a missing `react`
 *     install from collapsing the WHOLE props type to zero properties, the
 *     failure mode the checker-based approach above would hit.
 *
 * `children` therefore falls out for free the moment it is declared in a
 * first-party arm: it is just another member of a type-literal or interface
 * this module already walks, never a name filtered out by convention.
 *
 * Determinism (the working-method gate, ADR-001): components are sorted by
 * file, each component's props sorted by name, and directory walks sort
 * their entries before recursing — no wall clock, no randomness, and nothing
 * here depends on filesystem or Map iteration order.
 *
 * `sources/` may import `core/` + node builtins + external packages and
 * NOTHING else internal (`__tests__/layering.test.js` enforces this) — never
 * `spec/`, `modules/`, or `src/lib/` (v1).
 */

import { existsSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, isAbsolute, join } from "node:path"

import { resolveConventions, resolvePaths } from "../../core/config.mjs"
import { unwrapHoc } from "./hoc.mjs"
import { toPosixRelative } from "../../core/paths.mjs"
import { compareStrings } from "../../core/text.mjs"

// The real filesystem, used unless a caller injects one. Note this backs only
// THIS module's own existence checks and directory walks — the TypeScript
// compiler's own file reads (source files, node_modules type declarations,
// its bundled lib.d.ts) always go through the real `ts.sys`, which is not
// itself injectable; "ts injectable so tests can run without the real
// compiler" (the issue's own phrasing) covers the compiler instance, not its
// internal I/O.
const defaultFs = { existsSync, readdirSync }

const requireFromHere = createRequire(import.meta.url)

// ---------------------------------------------------------------------------
// Lazy `typescript` load — see the module docblock.
// ---------------------------------------------------------------------------

/**
 * Load the `typescript` module by name, never throwing. `moduleName` is
 * overridable so tests can exercise the "not installed" path deterministically
 * (pointing at a module name that cannot possibly resolve) without needing to
 * actually uninstall the real dependency.
 *
 * @param {string} [moduleName]
 * @returns {object|null}
 */
export function loadTypeScript(moduleName = "typescript") {
  try {
    return requireFromHere(moduleName)
  } catch {
    return null
  }
}

const TYPESCRIPT_MISSING_MESSAGE =
  'install typescript to run the components check (it is an optional peer dependency — "npm install --save-dev typescript")'

// Read `baseUrl`/`paths` out of the project's own tsconfig.
//
// Without them a path-aliased import (`@/lib/theme`) does not resolve, the
// imported type degrades to the error type, and `classifyPropType` falls all
// the way through to its default. Measured against a real design system, 107
// props came back "slot" — including every `theme` prop, whose type is a plain
// string union one file away.
//
// ONLY these two fields are taken. The rest of a consumer's tsconfig must not
// leak in: this program exists to read types, not to reproduce the project's
// build, and inheriting `strict` would change what an optional prop's type
// even is — the engine's answer must not depend on how the consumer compiles.
function projectPathOptions(ts, root) {
  try {
    const configPath = ts.findConfigFile(
      root,
      ts.sys.fileExists,
      "tsconfig.json",
    )
    if (!configPath) return {}
    const raw = ts.readConfigFile(configPath, ts.sys.readFile)
    if (raw.error) return {}
    const parsed = ts.parseJsonConfigFileContent(
      raw.config,
      ts.sys,
      dirname(configPath),
    )
    const { baseUrl, paths } = parsed.options || {}
    if (!paths && !baseUrl) return {}
    // `paths` entries are relative ("@/*" -> "./*"), and TypeScript resolves
    // them against `baseUrl` — falling back to the CURRENT WORKING DIRECTORY
    // when it is unset. The engine runs from its own directory, not the
    // consumer's, so an absent baseUrl has to be pinned to the tsconfig's own
    // location or every alias silently resolves into the wrong tree.
    return {
      baseUrl: baseUrl || dirname(configPath),
      ...(paths ? { paths } : {}),
    }
  } catch {
    // A malformed tsconfig must never break extraction. It just means aliased
    // types stay unresolved — now reported honestly rather than mislabeled.
    return {}
  }
}

function compilerOptions(ts, root) {
  return {
    ...(root ? projectPathOptions(ts, root) : {}),
    allowJs: false,
    checkJs: false,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    // "Node10" is the TS5+ name for what used to be "NodeJs" — try both so
    // this runs across the TS versions the spike measured (5.9, 6.0); either
    // name resolves to the same classic Node-style resolution algorithm.
    moduleResolution:
      ts.ModuleResolutionKind.Node10 ?? ts.ModuleResolutionKind.NodeJs,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    // Deliberately lenient: this is a best-effort extractor over whatever
    // `.tsx` a component author already shipped, not a project-wide type
    // check — turning on strict null checks here would change what an
    // OPTIONAL prop's type looks like to the checker for no benefit this
    // module needs (optionality is read from the AST's `?`, never inferred
    // from `T | undefined`).
    strict: false,
    strictNullChecks: false,
  }
}

// ---------------------------------------------------------------------------
// Small, module-local helpers. The generic ones (`compareStrings`,
// `toPosixRelative`) live in `core/` and are imported above.
// ---------------------------------------------------------------------------

function isNodeModulesPath(fileName) {
  return fileName.includes("/node_modules/")
}

function propertyName(ts, nameNode) {
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode))
    return nameNode.text
  return undefined
}

export function hasExportModifier(ts, node) {
  if (!ts.canHaveModifiers(node)) return false
  const modifiers = ts.getModifiers(node)
  return Boolean(
    modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword),
  )
}

// `export default function X` — exported AND the default, as opposed to
// `export function X` (issue #453).
function hasDefaultModifier(ts, node) {
  if (!ts.canHaveModifiers(node)) return false
  const modifiers = ts.getModifiers(node)
  return Boolean(
    modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword),
  )
}

// ---------------------------------------------------------------------------
// 1. Find the exported component's typed props parameter.
// ---------------------------------------------------------------------------

/**
 * Find the first exported function/arrow/function-expression component in
 * `sourceFile` whose first parameter carries a type annotation, and return
 * that annotation plus the binding pattern, if any.
 *
 * The annotation is what the props are read from; the binding pattern is only
 * what `collectDefaults` reads destructuring defaults from, so it is optional
 * and a non-destructured `(props: FooProps) => …` resolves fine without one
 * (issue #154). `null` when no such component is found.
 */
// `export default X` -> "X". A bare identifier only: anything else is not a
// component declaration this can follow back.
function defaultExportName(ts, sourceFile) {
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ts.isIdentifier(statement.expression)
    ) {
      return statement.expression.text
    }
  }
  return null
}

// Returns `{fn, propsTypeNode, name}` — `propsTypeNode` is non-null only when
// the props type came from a wrapper's type arguments rather than the
// parameter; `name` is the declaration's own identifier, the component's real
// exported name (issue #321) rather than a guess derived from the file.
function functionOfStatement(ts, statement, { named } = {}) {
  if (ts.isFunctionDeclaration(statement)) {
    if (named && statement.name?.text !== named) return null
    return { fn: statement, propsTypeNode: null, name: statement.name?.text }
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (named && declaration.name?.text !== named) continue
      const initializer = declaration.initializer
      if (!initializer) continue
      const name = ts.isIdentifier(declaration.name)
        ? declaration.name.text
        : undefined
      if (
        ts.isArrowFunction(initializer) ||
        ts.isFunctionExpression(initializer)
      ) {
        return { fn: initializer, propsTypeNode: null, name }
      }
      const unwrapped = unwrapHoc(ts, initializer)
      if (unwrapped) return { ...unwrapped, name }
    }
  }
  return null
}

// The destructuring pattern for `paramName`, when it happens in the function
// BODY rather than the parameter list:
//
//   (props, ref) => { const {size = "md"} = props; … }
//
// A wrapped component usually looks like this, because the parameter has to
// stay a plain identifier for the ref argument to sit beside it. Defaults live
// only in the destructuring pattern, so without this every default on every
// `forwardRef` component reads as absent.
function bodyBindingPattern(ts, fn, paramName) {
  if (!fn.body || !ts.isBlock(fn.body)) return null
  for (const statement of fn.body.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isObjectBindingPattern(declaration.name)) continue
      const init = declaration.initializer
      if (init && ts.isIdentifier(init) && init.text === paramName)
        return declaration.name
    }
  }
  return null
}

// Find the component whose props this file describes.
//
// Measured against a real design system: of 100 components, ZERO are written
// `export function X`, and 55 declare `const X = …` and export it on the LAST
// LINE via `export default X`. Matching only inline-exported forms — which is
// what this originally did — read the props of just 16 of those 100 files, so
// the props/API check, the engine's flagship, was blind to 84% of the
// codebase while reporting confidently on the rest.
//
// `sources/react/jsx.mjs` carries the same three-pass resolution for the same
// reason; the two are deliberately parallel rather than shared, because they
// want different things from the node they find (a props parameter here, a
// returned JSX tree there).
// Returns `{param, componentConfirmed, shape}`. These are INDEPENDENT answers
// to different questions, and collapsing them is what issue #132 was:
//
//   - `param` — could this file's props be read? (null when not)
//   - `componentConfirmed` — is there an exported component here AT ALL?
//   - `shape` — when a component was confirmed but no param came back, WHY:
//     "propless" (takes no parameter) or "untyped" (takes one with no type).
//
// A file can confirm a component and still yield no param, and the two ways
// that happens are not the same fact — which is what issues #152 and #153
// were. A component taking no parameter has no props, a complete answer about
// its API; one whose parameter is untyped accepts props that were never
// declared. Both still need a contract, so coverage must see them, but only
// the first can honestly be censused as having zero props. A file that
// declares no exported function — a re-export barrel, a constants module —
// confirms nothing, and adding it to the contract worklist would be inventing
// work.
//
// Measured on a real design system: of 23 files whose props could not be read,
// 21 were confirmed components that the worklist silently omitted.
function findComponentPropsParam(ts, sourceFile) {
  let componentConfirmed = false

  // The first UNREADABLE shape seen, in source order: "propless" (the
  // component takes no parameter) or "untyped" (it takes one carrying no type
  // annotation anywhere). Held only as a fallback — a later statement yielding
  // a readable parameter still wins, so a file mixing shapes reports the one
  // that can actually be read.
  //
  // The declaration's own name is recorded WITH the shape, never as a separate
  // variable tracking the last declaration seen (issue #321). A file exporting
  // a propless declaration followed by an untyped one keeps the first's shape;
  // a name carried independently would be the second's, and the fallback
  // answer would pair one declaration's props with another's name.
  let shape = null
  let shapeName = null
  let shapeNamedExport = false
  // Whether the declaration being read is a NAMED export (`export const X`,
  // `export function X`) rather than the file's default export — recorded
  // WITH the name for the same reason the name travels with the shape: it
  // is a fact about that declaration (issue #453 — a binding that
  // default-imports a named export does not compile).
  let readingNamedExport = false
  const noteShape = (value, name) => {
    if (shape) return
    shape = value
    shapeName = name ?? null
    shapeNamedExport = readingNamedExport
  }

  const usable = found => {
    if (!found) return null
    const { fn, propsTypeNode, name } = found
    // Reached the function itself — whatever its parameter looks like, this
    // file declares a component.
    componentConfirmed = true

    const param = fn.parameters?.[0]
    // No parameter at all. This is a COMPLETE answer about the component's
    // API — it has no props — not a failure to read one (issue #152).
    if (!param) {
      noteShape("propless", name)
      return null
    }

    // The parameter's own annotation wins; a wrapper's type argument is the
    // fallback, since a wrapped component's parameter is usually bare.
    const paramTypeNode = param.type || propsTypeNode
    // A parameter carrying no type annotation anywhere. The component DOES
    // accept props — `({...props})` spread onto an element accepts whatever
    // that element does — they are simply never declared (issue #153). This
    // is NOT the propless case above and must not report zero props, which
    // would assert something false about a component that accepts anything.
    if (!paramTypeNode) {
      noteShape("untyped", name)
      return null
    }

    // Destructured in the parameter, or — for a wrapped component, whose
    // parameter must stay an identifier so `ref` can sit beside it — in the
    // body. Either way what is wanted is the pattern the defaults live in.
    //
    // A pattern is OPTIONAL, never a precondition (issue #154). Props come
    // from `paramTypeNode` above; the pattern supplies only destructuring
    // defaults. `(props: FooProps) => …` that never destructures therefore
    // has no defaults to read — a complete answer about that component, not
    // a failure to read it — and requiring a pattern here discarded a type
    // the line above had already resolved. Measured: two components with an
    // identical props type extracted 2 props when destructured and 0, plus an
    // extraction-failed diagnostic, when not.
    const bindingPattern = ts.isObjectBindingPattern(param.name)
      ? param.name
      : ts.isIdentifier(param.name)
        ? bodyBindingPattern(ts, fn, param.name.text)
        : null

    // The name travels WITH the readable parameter, for the same reason the
    // fallback's travels with its shape: whichever declaration answered is the
    // one whose name the census must report.
    return { paramTypeNode, bindingPattern, name: name ?? null }
  }

  // Pass 1: inline-exported function or arrow.
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(ts, statement)) continue
    readingNamedExport = !hasDefaultModifier(ts, statement)
    const found = usable(functionOfStatement(ts, statement))
    if (found)
      return {
        param: found,
        componentConfirmed: true,
        name: found.name,
        namedExport: readingNamedExport,
      }
  }

  // Pass 2: `export default <Identifier>` resolved back to its declaration.
  const named = defaultExportName(ts, sourceFile)
  if (named) {
    readingNamedExport = false
    for (const statement of sourceFile.statements) {
      const found = usable(functionOfStatement(ts, statement, { named }))
      if (found)
        return {
          param: found,
          componentConfirmed: true,
          name: found.name,
          namedExport: false,
        }
    }
  }

  return {
    param: null,
    componentConfirmed,
    shape,
    name: shapeName,
    namedExport: shapeNamedExport,
  }
}

// ---------------------------------------------------------------------------
// 2. Destructuring defaults — read from the CODE (the type carries no
//    defaults; `size = "md"` in the parameter's binding pattern does).
// ---------------------------------------------------------------------------

function literalValue(ts, node) {
  if (!node) return undefined
  if (node.kind === ts.SyntaxKind.StringLiteral) return node.text
  if (node.kind === ts.SyntaxKind.NumericLiteral) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  return undefined
}

function collectDefaults(ts, bindingPattern) {
  const defaults = new Map()
  // No pattern is a valid shape, not a missing one — a non-destructured
  // parameter simply carries no destructuring defaults (issue #154).
  if (!bindingPattern) return defaults
  for (const element of bindingPattern.elements) {
    if (!ts.isBindingElement(element) || !element.initializer) continue
    const nameNode = element.propertyName || element.name
    const name = propertyName(ts, nameNode)
    if (name === undefined) continue
    const value = literalValue(ts, element.initializer)
    if (value !== undefined) defaults.set(name, value)
  }
  return defaults
}

// ---------------------------------------------------------------------------
// 3. The intersection walk — see the module docblock.
// ---------------------------------------------------------------------------

function resolveAliasedSymbol(ts, checker, symbol) {
  if (!symbol) return null
  if (symbol.flags & ts.SymbolFlags.Alias)
    return checker.getAliasedSymbol(symbol)
  return symbol
}

// Record a member the FIRST time it is seen — the earliest arm in source
// order (typically the component's own local literal) wins over a same-named
// member reached later via an extended/intersected arm, which keeps output
// deterministic when a name genuinely appears more than once.
function recordMember(propsMap, name, member) {
  if (!propsMap.has(name)) propsMap.set(name, member)
}

function collectMembersOf(ts, declarationMembers, propsMap) {
  for (const member of declarationMembers) {
    if (!ts.isPropertySignature(member) || !member.name) continue
    const name = propertyName(ts, member.name)
    if (name === undefined) continue
    recordMember(propsMap, name, {
      questionToken: Boolean(member.questionToken),
      typeNode: member.type,
    })
  }
}

/**
 * Resolve a named type reference (`OtherFirstPartyProps`,
 * `ButtonHTMLAttributes<…>`, or an `interface`'s `extends` clause target) and
 * walk it ONLY when first-party. An arm that cannot be resolved at all (an
 * uninstalled peer) is treated the same as a `node_modules` exclusion —
 * nothing about it is known, so nothing about it is asserted; see the module
 * docblock for why this matters more than it sounds.
 */
function collectPropsFromReference(ts, checker, nameNode, propsMap, visited) {
  const symbol = checker.getSymbolAtLocation(nameNode)
  const resolved = resolveAliasedSymbol(ts, checker, symbol)
  const declarations = resolved?.declarations || []
  if (declarations.length === 0) return

  const visitKey = declarations
    .map(
      declaration =>
        `${declaration.getSourceFile().fileName}#${declaration.pos}`,
    )
    .join(",")
  if (visited.has(visitKey)) return
  visited.add(visitKey)

  for (const declaration of declarations) {
    const file = declaration.getSourceFile().fileName
    // THE spike's exclusion rule, applied directly: a declaration whose
    // source file lives under `node_modules` (this includes TypeScript's own
    // bundled lib.d.ts, since `typescript` itself is installed under
    // `node_modules`) is third-party and excluded outright.
    if (isNodeModulesPath(file)) continue

    if (ts.isTypeAliasDeclaration(declaration)) {
      collectPropsFromTypeNode(ts, checker, declaration.type, propsMap, visited)
      continue
    }
    if (ts.isInterfaceDeclaration(declaration)) {
      collectMembersOf(ts, declaration.members, propsMap)
      for (const heritage of declaration.heritageClauses || []) {
        for (const expression of heritage.types) {
          collectPropsFromReference(
            ts,
            checker,
            expression.expression,
            propsMap,
            visited,
          )
        }
      }
    }
  }
}

/**
 * Walk a props type node — a type literal, an intersection of arms, or a
 * named reference to either — collecting every first-party member into
 * `propsMap` (name -> `{questionToken, typeNode}`). This is the whole
 * "walk intersection arms" behavior the spike decided on.
 */
function collectPropsFromTypeNode(ts, checker, typeNode, propsMap, visited) {
  if (!typeNode) return

  if (ts.isParenthesizedTypeNode(typeNode)) {
    collectPropsFromTypeNode(ts, checker, typeNode.type, propsMap, visited)
    return
  }
  if (ts.isIntersectionTypeNode(typeNode)) {
    for (const member of typeNode.types)
      collectPropsFromTypeNode(ts, checker, member, propsMap, visited)
    return
  }
  if (ts.isTypeLiteralNode(typeNode)) {
    collectMembersOf(ts, typeNode.members, propsMap)
    return
  }
  if (ts.isTypeReferenceNode(typeNode)) {
    collectPropsFromReference(ts, checker, typeNode.typeName, propsMap, visited)
    return
  }
  if (ts.isUnionTypeNode(typeNode)) {
    collectPropsFromUnion(ts, checker, typeNode, propsMap, visited)
    return
  }
  // A mapped type, `Omit<…>`, etc. — beyond the three documented shapes
  // (D2's `Props = {…}`, `Props = {…} & Arm & Arm`, and issue #381's
  // discriminated-union arm) this checker needs to support. Skip rather
  // than guess at a structure nobody asked for.
}

// Is every declaration behind a type reference first-party and statically
// walkable (a type alias or an interface, not under node_modules)? A union
// member that is not is a member this walk cannot see into — and one
// unseen member means the union's key set is unknown, so the whole union
// is skipped rather than half-read.
function referenceIsWalkable(ts, checker, nameNode) {
  const symbol = checker.getSymbolAtLocation(nameNode)
  const resolved = resolveAliasedSymbol(ts, checker, symbol)
  const declarations = resolved?.declarations || []
  return (
    declarations.length > 0 &&
    declarations.every(
      declaration =>
        !isNodeModulesPath(declaration.getSourceFile().fileName) &&
        (ts.isTypeAliasDeclaration(declaration) ||
          ts.isInterfaceDeclaration(declaration)),
    )
  )
}

/**
 * A discriminated union used as an intersection arm (issue #381):
 *
 *   Props = { size?: Size } & (IconProps | TextProps)
 *   IconProps = { variant: "icon"; icon: ReactNode; text?: never }
 *   TextProps = { variant: "text"; text: string; icon?: never }
 *
 * is the standard TypeScript way to say "exactly one of these prop sets",
 * and exactly what a design tool models as a variant axis — so the props
 * most likely to correspond to a design variant were the ones this census
 * could not see. The walk takes the UNION of the members' keys, the way the
 * type itself reads: a key present in every member is required as declared;
 * a key absent from some member, optional in some member, or typed `never`
 * in some member, is optional; a key whose members carry different types
 * (`variant: "icon"` / `variant: "text"`) keeps every alternative, and the
 * classifier merges literals into one enum. Only when EVERY member is a
 * type literal or a walkable first-party reference — one member this walk
 * cannot see into means the key set is unknown, and the union is skipped
 * whole, as before.
 */
function collectPropsFromUnion(ts, checker, unionNode, propsMap, visited) {
  const memberMaps = []
  for (const member of unionNode.types) {
    const node = ts.isParenthesizedTypeNode(member) ? member.type : member
    const walkable =
      ts.isTypeLiteralNode(node) ||
      (ts.isTypeReferenceNode(node) &&
        referenceIsWalkable(ts, checker, node.typeName))
    if (!walkable) return
    const map = new Map()
    collectPropsFromTypeNode(ts, checker, node, map, new Set(visited))
    memberMaps.push(map)
  }
  if (memberMaps.length === 0) return

  const names = new Set(memberMaps.flatMap(map => [...map.keys()]))
  for (const name of names) {
    const entries = memberMaps.map(map => map.get(name))
    const isNever = entry =>
      entry?.typeNode?.kind === ts.SyntaxKind.NeverKeyword
    const present = entries.filter(entry => entry && !isNever(entry))
    const optional =
      present.length < memberMaps.length ||
      present.some(entry => entry.questionToken)
    const alternatives = present.map(entry => entry.typeNode)
    recordMember(propsMap, name, {
      questionToken: optional,
      typeNode: alternatives[0],
      ...(alternatives.length > 1 ? { alternatives } : {}),
    })
  }
}

// ---------------------------------------------------------------------------
// 4. Classify one member's type into the contract vocabulary.
// ---------------------------------------------------------------------------

/**
 * Map one prop's type node to the contract's vocabulary
 * (`boolean|string|number|enum|slot|function`), with `values` for a union of
 * string/number literals. Deliberately built from `values` that are ONLY
 * literal types — `undefined`/`null` union members (which is how an optional
 * prop's type would carry them, were `strictNullChecks` on) are filtered out
 * structurally rather than by a post-hoc "remove undefined" pass, per the
 * spike's third finding.
 */
function classifyPropType(ts, checker, typeNode) {
  if (!typeNode) return { type: "slot" }

  const type = checker.getTypeFromTypeNode(typeNode)
  const asString = checker.typeToString(type)
  if (asString === "boolean") return { type: "boolean" }
  if (asString === "string") return { type: "string" }
  if (asString === "number") return { type: "number" }
  if (type.getCallSignatures().length > 0) return { type: "function" }

  // One literal alone (`variant: "icon"` inside a union member, #381) is an
  // enum of one value — the classifier below merges the members' enums.
  if (type.isStringLiteral() || type.isNumberLiteral())
    return { type: "enum", values: [type.value] }

  if (type.isUnion()) {
    const members = type.types.filter(
      member => !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
    )
    if (
      members.length > 0 &&
      members.every(
        member => member.isStringLiteral() || member.isNumberLiteral(),
      )
    ) {
      return { type: "enum", values: members.map(member => member.value) }
    }
  }

  // An UNRESOLVED type is not a slot. TypeScript hands back the error type
  // when it cannot resolve an import — a path alias with no tsconfig, a
  // missing dependency — and calling that "slot" asserts a shape nobody
  // established, which is how a `theme` prop typed `"light" | "dark"` got
  // reported as a mismatched slot.
  //
  // Detected by FLAGS, never by stringifying: the error type prints as the
  // alias's own name (`"Theme"`), not `"any"`, so a string comparison sees a
  // perfectly ordinary type name and lets it through. A genuine `any` in the
  // source lands here too, which is right — `download?: any` carries no more
  // information about the prop's shape than an unresolved import does.
  //
  // Reported as "unknown" so the parity check declines the comparison instead
  // of inventing a finding, the same way the token and style checks stay
  // silent on what they could not resolve.
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
    return { type: "unknown" }

  return { type: "slot" }
}

/**
 * A prop typed differently across union members (issue #381): every
 * alternative is classified on its own, then merged. All enums (a literal
 * per member is the discriminant) → one enum, values in member order,
 * deduplicated. All the same scalar → that scalar. Anything else is
 * `unknown` — two members disagreeing on a prop's kind is a shape this
 * vocabulary cannot express, and a parity check declines rather than picks.
 */
function classifyAlternatives(ts, checker, typeNodes) {
  const classified = typeNodes.map(node => classifyPropType(ts, checker, node))
  if (classified.every(c => c.type === "enum")) {
    const values = []
    for (const c of classified)
      for (const value of c.values)
        if (!values.includes(value)) values.push(value)
    return { type: "enum", values }
  }
  const kinds = new Set(classified.map(c => c.type))
  if (kinds.size === 1) return { type: classified[0].type }
  return { type: "unknown" }
}

// ---------------------------------------------------------------------------
// 5. One component.
// ---------------------------------------------------------------------------

/**
 * Extract one component's prop census from its `.tsx` file. Never throws:
 * a missing `typescript`, a missing file, or anything the compiler itself
 * throws on all degrade to `{ok: false, component: null, diagnostics}`.
 *
 * @param {string} filePath path to a component's `.tsx` file (read by the
 *   TypeScript compiler's own I/O — always the real filesystem)
 * @param {object} [options]
 * @param {object} [options.ts] an already-loaded `typescript` module,
 *   injectable so tests can supply their own (or omit `typescript`
 *   altogether to exercise the "not installed" path)
 * @param {string} [options.tsModuleName] module name to lazily require when
 *   `ts` is not given (default `"typescript"`) — overridable so a test can
 *   exercise "not installed" without touching the real dependency
 * @param {{existsSync: Function}} [options.fs] injectable fs for this
 *   module's OWN existence check (default real `node:fs`) — see the module
 *   docblock for why the compiler's own I/O is not covered by this
 * @param {string} [options.label] what to call this file in the returned
 *   component/diagnostics — defaults to `filePath`; callers pass a
 *   repo-relative path so output matches a contract's `sources.code.path`
 * @returns {{ok: boolean, componentConfirmed?: boolean, component: {file: string, props: object[], name?: string, namedExport: boolean}|null, diagnostics: object[]}}
 *   `component.name` is the component's own exported identifier when a
 *   declaration could resolve one (issue #321) — absent when it could not,
 *   never a filename-derived guess
 *   `componentConfirmed` is present (and `true`) only on a failed result
 *   where an exported component WAS found but its props could not be —
 *   distinct from no component being found at all (issue #132); absent
 *   entirely when `ok` is `true`.
 *
 *   A component that takes NO parameter succeeds with an empty `props` list
 *   rather than failing (issue #152): having no props is an answer about its
 *   API, not a failure to read one. A component whose parameter carries no
 *   type still fails, under `untyped-props-parameter` (issue #153) — it
 *   accepts props that were simply never declared, and censusing that as zero
 *   props would assert something false.
 */
export function extractComponent(
  filePath,
  { ts: injectedTs, tsModuleName, fs = defaultFs, label, root } = {},
) {
  const file = label || filePath
  const ts = injectedTs || loadTypeScript(tsModuleName)

  if (!ts) {
    return {
      ok: false,
      component: null,
      diagnostics: [
        {
          code: "typescript-not-installed",
          file,
          message: TYPESCRIPT_MISSING_MESSAGE,
        },
      ],
    }
  }

  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      component: null,
      diagnostics: [
        {
          code: "missing-component-file",
          file,
          message: `no component file at ${file}`,
        },
      ],
    }
  }

  let program
  let sourceFile
  try {
    program = ts.createProgram([filePath], compilerOptions(ts, root))
    sourceFile = program.getSourceFile(filePath)
  } catch (err) {
    return {
      ok: false,
      component: null,
      diagnostics: [
        {
          code: "typescript-error",
          file,
          message: `TypeScript could not process ${file}: ${err.message}`,
        },
      ],
    }
  }

  if (!sourceFile) {
    return {
      ok: false,
      component: null,
      diagnostics: [
        {
          code: "missing-source-file",
          file,
          message: `TypeScript could not load ${file}`,
        },
      ],
    }
  }

  const {
    param: target,
    componentConfirmed,
    shape,
    name: componentName,
    namedExport,
  } = findComponentPropsParam(ts, sourceFile)
  if (!target) {
    // THREE different facts, reported three different ways — never one code
    // meaning "something went wrong here" (issues #152, #153). `no-props-type-
    // found` used to cover all of them, which read as "extraction failed" on
    // two shapes where nothing had failed at all.
    //
    // `componentConfirmed` travels on a failed result because coverage needs
    // it: a component whose props are unreadable still needs a contract, a
    // file that is not a component does not.

    if (!componentConfirmed)
      return {
        ok: false,
        componentConfirmed: false,
        component: null,
        diagnostics: [
          {
            code: "no-component-found",
            file,
            message: `no exported component is declared in ${file}`,
          },
        ],
      }

    // A component that takes no parameter HAS no props. That is an answer,
    // so it censuses like any other component — with an empty prop list —
    // and joins `components` rather than the unreadable pile (issue #152).
    if (shape === "propless")
      return {
        ok: true,
        component: {
          file,
          props: [],
          ...(componentName ? { name: componentName } : {}),
          namedExport,
        },
        diagnostics: [],
      }

    // Only "untyped" is left: every path that confirms a component without
    // yielding a parameter notes one of the two shapes, so this is total by
    // construction rather than a default worth guessing at.
    //
    // Such a component accepts props this module cannot name — `({...props})`
    // spread onto an element accepts whatever that element does. Reported as
    // its own code, worded as an UNDECLARED api rather than a failed read, and
    // still unreadable, so it stays on the contract worklist instead of
    // claiming zero props (issue #153).
    return {
      ok: false,
      componentConfirmed: true,
      component: null,
      diagnostics: [
        {
          code: "untyped-props-parameter",
          file,
          message: `the exported component in ${file} takes a props parameter with no type annotation, so its API is undeclared and cannot be read`,
        },
      ],
    }
  }

  const checker = program.getTypeChecker()
  const propsMap = new Map()
  collectPropsFromTypeNode(
    ts,
    checker,
    target.paramTypeNode,
    propsMap,
    new Set(),
  )
  const defaults = collectDefaults(ts, target.bindingPattern)

  const props = [...propsMap.entries()]
    .map(([name, member]) => {
      const classified = member.alternatives
        ? classifyAlternatives(ts, checker, member.alternatives)
        : classifyPropType(ts, checker, member.typeNode)
      const prop = { name, type: classified.type }
      if (classified.values) prop.values = classified.values
      if (defaults.has(name)) prop.default = defaults.get(name)
      prop.required = !member.questionToken
      return prop
    })
    .sort((a, b) => compareStrings(a.name, b.name))

  return {
    ok: true,
    component: {
      file,
      props,
      ...(componentName ? { name: componentName } : {}),
      namedExport,
    },
    diagnostics: [],
  }
}

// ---------------------------------------------------------------------------
// 6. Every component.
// ---------------------------------------------------------------------------

/**
 * Extract every component in `files`. A single bad file NEVER aborts the set
 * (same rule `spec/contracts.mjs`'s `loadContracts` follows): it contributes
 * diagnostics and every other file still extracts. A missing `typescript`
 * install is different in kind — nothing in the set CAN extract — so it is
 * reported distinctly via `skipped: true`, letting a caller (the `audit`
 * command) skip the whole components check with one stated reason rather
 * than reporting a component-shaped "missing file" diagnostic per file.
 *
 * @param {string[]} files paths to component `.tsx` files, absolute or
 *   relative to `options.root`
 * @param {object} [options]
 * @param {object} [options.ts] see `extractComponent`
 * @param {string} [options.tsModuleName] see `extractComponent`
 * @param {{existsSync: Function}} [options.fs] see `extractComponent`
 * @param {string} [options.root] when given, each component's `file` label is
 *   `files`' entry made relative to this and POSIX-normalized (matching a
 *   contract's `sources.code.path` convention); omitted, the entry is used
 *   as-is
 * @param {{start?: Function, update?: Function, done?: Function, skip?: Function}} [options.onProgress]
 *   a `core/progress.mjs`-shaped bus, called if given — this module never
 *   imports a renderer itself (ADR-001 D8)
 * @returns {{ok: boolean, skipped: boolean, components: object[], unreadableProps: string[], diagnostics: object[]}}
 *   `components` holds only the files that extracted cleanly, sorted by
 *   `file`; `unreadableProps` lists the (relative) files of CONFIRMED
 *   components whose props could not be read — present but propless,
 *   consulted so a component this module cannot read still stays on the
 *   contract worklist (issue #132) — see `findComponentPropsParam`'s
 *   `componentConfirmed`; `ok` is `diagnostics.length === 0`
 */
export function extractComponents(
  files,
  { ts: injectedTs, tsModuleName, fs = defaultFs, root, onProgress } = {},
) {
  const ts = injectedTs || loadTypeScript(tsModuleName)
  if (!ts) {
    onProgress?.skip?.("components", TYPESCRIPT_MISSING_MESSAGE)
    return {
      ok: false,
      skipped: true,
      components: [],
      unreadableProps: [],
      diagnostics: [
        {
          code: "typescript-not-installed",
          message: TYPESCRIPT_MISSING_MESSAGE,
        },
      ],
    }
  }

  const sorted = [...files].sort(compareStrings)
  onProgress?.start?.("components", `extracting ${sorted.length} file(s)`)

  const components = []
  const unreadableProps = []
  const diagnostics = []
  for (const file of sorted) {
    const label = root ? toPosixRelative(root, file) : file
    onProgress?.update?.("components", label)
    const result = extractComponent(file, { ts, fs, label, root })
    diagnostics.push(...result.diagnostics)
    if (result.ok) components.push(result.component)
    else if (result.componentConfirmed) unreadableProps.push(label)
  }

  components.sort((a, b) => compareStrings(a.file, b.file))
  unreadableProps.sort(compareStrings)

  if (diagnostics.length > 0)
    onProgress?.skip?.("components", `${diagnostics.length} diagnostic(s)`)
  else onProgress?.done?.("components", `${components.length} component(s)`)

  return {
    ok: diagnostics.length === 0,
    skipped: false,
    components,
    // Confirmed components whose props could not be read. NOT part of
    // `components` — they carry no prop list, so letting them into the parity
    // path would report every contracted prop as missing from code. Coverage
    // reads them so the contract worklist stays complete (issue #132).
    unreadableProps,
    diagnostics,
  }
}

// ---------------------------------------------------------------------------
// 7. Discovering component files under the configured componentsDir.
// ---------------------------------------------------------------------------

/** React's own file conventions — see ./adapter.mjs, which re-exports them. */
export const REACT_NON_COMPONENT_FILE_SUFFIXES = [".stories.tsx", ".test.tsx"]

function collectTsxFilesSorted(dirAbs, excludedSuffixes, fs) {
  const files = []
  if (!fs.existsSync(dirAbs)) return files
  const entries = [...fs.readdirSync(dirAbs, { withFileTypes: true })].sort(
    (a, b) => compareStrings(a.name, b.name),
  )
  for (const entry of entries) {
    const full = join(dirAbs, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectTsxFilesSorted(full, excludedSuffixes, fs))
      continue
    }
    if (!entry.name.endsWith(".tsx")) continue
    if (excludedSuffixes.some(suffix => entry.name.endsWith(suffix))) continue
    files.push(full)
  }
  return files
}

/**
 * Every `.tsx` file under the configured `paths.componentsDir` that is not
 * excluded by `conventions.nonComponentFileSuffixes` (Storybook stories, test
 * files, Code Connect sidecars) — absolute and sorted. A missing directory is
 * zero files, never a crash.
 *
 * @param {object} config the project's (unresolved) config
 * @param {object} [options]
 * @param {string} [options.root] project root a relative `componentsDir`
 *   resolves against (default `process.cwd()`)
 * @param {{existsSync: Function, readdirSync: Function}} [options.fs]
 * @returns {{dir: string, files: string[]}} `dir` is the resolved absolute
 *   components directory; `files` are absolute paths in sorted order
 */
export function findComponentFiles(
  config,
  { root = process.cwd(), fs = defaultFs } = {},
) {
  const { componentsDir } = resolvePaths(config)
  // The adapter's own default applies when the project sets none (issue
  // #117): `.tsx` conventions are React's, not the engine's.
  const nonComponentFileSuffixes =
    resolveConventions(config).nonComponentFileSuffixes ??
    REACT_NON_COMPONENT_FILE_SUFFIXES
  const dir = isAbsolute(componentsDir)
    ? componentsDir
    : join(root, componentsDir)
  return {
    dir,
    files: collectTsxFilesSorted(dir, nonComponentFileSuffixes, fs),
  }
}
