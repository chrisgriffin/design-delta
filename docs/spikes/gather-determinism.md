# Spike: Figma gather determinism (issue #88)

Whether gathering the same unchanged Figma file repeatedly returns the same
bytes, and what variance a normalizer would have to absorb.

Gates [ADR-001](../adr/ADR-001-modular-rewrite.md)'s `### Phase 5` (the
design provider layer), which names this spike explicitly as its
prerequisite — "gated on the gather-determinism spike (#88)." Runs before
any provider code, per ADR-001's own framing: the normalization rules a
future `sources/ingest.mjs` needs must come from **observed** variance, not
a guess. This is where v1's erraticism lived.

## Method

Gathered the same, unchanged Figma file five times via the official Figma
MCP plugin's `list_file_components_for_code_connect` tool — the cheapest
candidate named in issue #88, tried first per the ticket's own priority
order. Target: a consumer project's components file, the largest of the
handful of Figma files its contracts address (36 of 54 addressed contracts
point at this one). No writes; read-only against Figma throughout.

Second, independent check: structural diff against
`.agents/design-delta/baseline.json`'s `fingerprints` block — 47 components
captured by the retired v1 engine, unrelated to this gather path or session.

## Result 1 — five gathers, byte-identical

```
sha256(gather-1.json) = 9e7778ecbc957a5b63fe353b4c594d9fd69e59a880a8076c7db1e28ad783b2c0
sha256(gather-2.json) = 9e7778ecbc957a5b63fe353b4c594d9fd69e59a880a8076c7db1e28ad783b2c0
sha256(gather-3.json) = 9e7778ecbc957a5b63fe353b4c594d9fd69e59a880a8076c7db1e28ad783b2c0
sha256(gather-4.json) = 9e7778ecbc957a5b63fe353b4c594d9fd69e59a880a8076c7db1e28ad783b2c0
sha256(gather-5.json) = 9e7778ecbc957a5b63fe353b4c594d9fd69e59a880a8076c7db1e28ad783b2c0
```

**Zero observed variance.** Not "variance below a rounding threshold" —
`diff` on the raw JSON across all five reports no differences at all: same
byte length, same key ordering, same array ordering, same values.

This is explainable, not surprising, once the response shape is read:
`list_file_components_for_code_connect` returns `name`, `nodeId`, `type`,
`pageId`, `pageName`, `hasVariants`, `properties` (variant/boolean/text/
instance-swap definitions with their options and defaults),
`childInstanceTags`, `instanceCount`, `dependencies`, `assetKey`. **No
field in this shape is inherently unstable** — no timestamp, no float
geometry, no free-form ordering the API is documented to vary. `assetKey`
looks hash-like but was stable across all five calls. The instability
ADR-001 named (response ordering, float geometry, timestamp fields, MCP
paging variance) is real for _other_ Figma API surfaces (raw node
geometry, style objects) but this endpoint doesn't expose any of them.

**Consequence for the normalizer (D6):** for the component-property surface
specifically, `sources/ingest.mjs` needs **no normalization allowlist at
all** — no rounding, no re-ordering, no field-stripping. Hash the raw
payload directly. This conclusion is scoped to this one endpoint; it does
not extend to variable/style data, which this spike did not gather (out of
scope for #88 — the token side is a separate, likely Enterprise-gated
path, per the account-tier check that motivated this spike).

## Result 2 — structural cross-check against `baseline.json`

| check                                                                                                               | result                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| baseline's 47 fingerprinted components                                                                              | **all 47 present** in the fresh gather — zero missing                                                                                                                                       |
| nodeId agreement, all 47 shared components                                                                          | **zero mismatches** — every nodeId identical between the v1-era baseline and today's gather                                                                                                 |
| components in fresh gather not in baseline                                                                          | 18 (genuinely new since the baseline was captured — expected growth, not noise)                                                                                                             |
| `Eyebrow` (a good fixture for the `COMPONENT_SET`/`COMPONENT` census-unit distinction the provider layer will need) | `nodeId: "41:250"`, `type: "COMPONENT_SET"`, one `size` variant property with options `["lg", "sm"]` — matches baseline's `"0/name": "Eyebrow"` / `"0/0/name": "size=lg"` structure exactly |

The `COMPONENT_SET`/`COMPONENT` distinction **comes back reliably**: 39 of
65 gathered entries are `COMPONENT_SET` (a published component with
variants), 26 are bare `COMPONENT` (no variants) — `Eyebrow` is
unambiguously the former, confirming a census unit of "the published
component, not its variant children" is directly checkable from this
endpoint's own `type` field with no extra inference needed.

## Recommendation for a future provider's normalizer

1. **No numeric rounding or field allowlist needed for
   `censusComponents`.** Hash the `list_file_components_for_code_connect`
   response verbatim (after the standard key-sort `hashJson` already does
   in `core/state.mjs` — that's about canonical serialization, not content
   normalization, and stays as-is).
2. **Census unit = `type === "COMPONENT_SET"` for a component with
   variants, `type === "COMPONENT"` for one without.** Variant children are
   never separately censused entities — they live inside `properties`.
3. **`nodeId` is the join key**, not `name` — confirmed stable across five
   gathers and against a dataset captured under a different engine
   entirely. Matching by name is not recommended for a future provider.
4. **This endpoint answers component/variant structure only.** It does not
   return bound-variable data (`boundVariables` presence isn't in this
   response shape at all; it lives in the full-file `GET /v1/files/:key`, a
   different endpoint). A future
   component-parity check gets everything it needs from this tool alone;
   a token census needs a different call (`get_variable_defs`, per-node)
   and was not exercised by this spike — its own determinism should be
   spot-checked separately before any token-side work starts.
5. **These findings are inputs to planning the provider layer, not a
   completed plan.** They confirm two things worth designing around — the
   `Eyebrow`-style census-unit distinction, and nodeId-based matching —
   against live data rather than only the retired baseline.

## What this spike did not test

- The REST gather path — no fresh, working access token to test with, and
  the account's plan tier makes the relevant endpoint unlikely to be
  reachable regardless.
- Variable/style data determinism — a different Figma API call than the
  one this spike exercised.
- The other two Figma files a consumer's contracts address (an icons
  file, and one file referenced by a single contract) — the components
  file was chosen as the largest, most representative target; no reason to
  expect different determinism behavior on the others, but a future
  validation pass against the real project should exercise all of them.
