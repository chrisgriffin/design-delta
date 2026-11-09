# GitHub Action

[`action.yml`](../action.yml) at the repo root is a composite action wrapping
the CI gate a consumer already runs by hand: `design-delta verify`, plus an
optional [SARIF](./report-structure.md#the-report-commands-sarif-artifact) log
for inline code-scanning annotations on the PR diff.

It does not check out the repo or install Node — a consumer does that once
in their own job, the same way they would for any other step that runs their
own tooling. `design-delta` is on the public npm registry, so the job needs
no registry auth before this action's steps run `npx`.

## Inputs

| Input         | Default              | Meaning                                                                                                                                        |
| ------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `config-path` | _(unset)_            | Passed as `--config`. Unset uses the CLI's own default, `design-delta.json`.                                                                   |
| `fail-on`     | `error`              | Passed as `verify --fail-on` (`error` \| `warn` \| `review` \| `none`).                                                                        |
| `sarif`       | `false`              | When `"true"`, runs `report --format sarif` and uploads it via `upload-sarif` before `verify` runs, so annotations land even on a failing run. |
| `sarif-path`  | `drift-report.sarif` | Output path for the SARIF log, when `sarif` is `"true"`.                                                                                       |

## Example

```yaml
name: Design drift

on:
  pull_request:

permissions:
  contents: read
  # `security-events: write` is only needed when `sarif: "true"` —
  # upload-sarif needs it to attach annotations to the PR.
  security-events: write

jobs:
  design-delta:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 22

      - name: Install dependencies
        run: npm ci

      - uses: chrisgriffin/design-delta@vX.Y.Z
        with:
          fail-on: error
          sarif: "true"
```

Pin an exact release tag, as above, from the
[releases page](https://github.com/chrisgriffin/design-delta/releases). This
repo's tags are bare `vX.Y.Z` (the release flow cuts nothing else), so there
is no floating `v1`/`v0` ref to track — and there will not be one while the
package stays `0.x`.

`npx design-delta` resolves the version already installed by
`npm ci` above rather than re-resolving one over the network, so pin the
version the same way as any other dependency: in `package.json`.
