/**
 * paths.mjs — path and directory-walk helpers shared by every layer.
 *
 * This module is `core/`: it touches no fs of its own — `collectFilesSorted`
 * takes an injected `fs` so it can be driven with fixture data.
 */

import { join, relative, sep } from "node:path"

import { compareStrings } from "./text.mjs"

/** Root-relative path with `/` separators regardless of platform. */
export function toPosixRelative(root, absPath) {
  return relative(root, absPath).split(sep).join("/")
}

/**
 * Recursive directory walk, sorted at EVERY level before recursing — Node
 * does not guarantee `readdirSync` order, and an unsorted walk would let
 * filesystem iteration order leak into which occurrence lands first (the
 * determinism gate, ADR-001).
 *
 * @param {string} dirAbs
 * @param {string[]} suffixes file-name suffixes to accept
 * @param {{existsSync: Function, readdirSync: Function}} fs
 * @returns {string[]} absolute paths
 */
export function collectFilesSorted(dirAbs, suffixes, fs) {
  const files = []
  if (!fs.existsSync(dirAbs)) return files
  const entries = [...fs.readdirSync(dirAbs, { withFileTypes: true })].sort(
    (a, b) => compareStrings(a.name, b.name),
  )
  for (const entry of entries) {
    const full = join(dirAbs, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFilesSorted(full, suffixes, fs))
      continue
    }
    if (suffixes.some(suffix => entry.name.endsWith(suffix))) files.push(full)
  }
  return files
}
