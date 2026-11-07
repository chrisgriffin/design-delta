#!/usr/bin/env node
/**
 * check-schemas.mjs — CI guard over `schema/`.
 *
 * The JSON Schemas ship inside the published package: `config.schema.json` is
 * the contract with a consuming project's config, and `contract.schema.json`
 * is the component contract every check compares against (ADR-001 D1). A
 * schema that no longer compiles, or one the engine references by a name that
 * no longer exists on disk, is invisible to `npm test` — the suite validates
 * DATA against whatever schemas happen to load, so a rename or a malformed
 * schema surfaces only in a consumer's run, as a confusing downstream
 * failure.
 *
 * Two assertions, both cheap:
 *   1. Every schema/*.json compiles under the SAME Ajv the engine uses
 *      (ajv/dist/2020.js — these are draft 2020-12; the default draft-07
 *      export cannot compile them).
 *   2. Every schema filename the engine references actually exists, caught at
 *      the reference level rather than at runtime in a consumer's install.
 */

import { readdirSync, existsSync } from "fs"
import { readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

import Ajv from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

import { CONFIG_SCHEMA_FILE } from "../../src/core/config.mjs"
import { CONTRACT_SCHEMA_FILE } from "../../src/spec/contracts.mjs"
import {
  DESIGN_COMPONENTS_SCHEMA_FILE,
  DESIGN_TOKENS_SCHEMA_FILE,
} from "../../src/providers/figma/normalize.mjs"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SCHEMA_DIR = join(REPO_ROOT, "schema")

let failed = 0
const fail = msg => {
  failed++
  console.error(`FAIL  ${msg}`)
}

// --- 1. every schema compiles ------------------------------------------------
const files = readdirSync(SCHEMA_DIR)
  .filter(f => f.endsWith(".json"))
  .sort()

if (files.length === 0) {
  fail("schema/ contains no .json files — did the directory move?")
}

for (const file of files) {
  // A fresh Ajv per schema: a shared instance would reject two schemas
  // declaring the same $id, which is a packaging concern, not a validity one.
  const ajv = new Ajv({ allErrors: true, strict: false })
  addFormats(ajv)
  try {
    ajv.compile(JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf8")))
    console.log(`OK    ${file} compiles`)
  } catch (err) {
    fail(`${file} does not compile — ${err.message}`)
  }
}

// --- 2. every referenced schema exists ---------------------------------------
// Both are ABSOLUTE paths (each module resolves its own schema from the
// package root so it works from a consumer's node_modules), so compare on the
// basename against schema/'s contents.
const referenced = new Set(
  [
    CONFIG_SCHEMA_FILE,
    CONTRACT_SCHEMA_FILE,
    DESIGN_COMPONENTS_SCHEMA_FILE,
    DESIGN_TOKENS_SCHEMA_FILE,
  ].map(p => p.split("/").pop()),
)

for (const file of [...referenced].sort()) {
  if (existsSync(join(SCHEMA_DIR, file))) {
    console.log(`OK    ${file} is referenced and present`)
  } else {
    fail(`${file} is referenced by the engine but missing from schema/`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} schema check(s) failed.`)
  process.exit(1)
}

console.log(`\nAll ${files.length} schema(s) compile; all references resolve.`)
