# Changelog

design-delta was cut from its earlier, privately developed source at 0.26.0.
Entries start with the first release from this repo; `release-pr.yml` writes
each one from the Conventional Commits since the previous tag.

## [0.29.0](https://github.com/chrisgriffin/design-delta/compare/v0.28.0...v0.29.0) (2026-11-27)

### Features

* **dock:** make a design-delta version bump the whole skill update ([e81030c](https://github.com/chrisgriffin/design-delta/commit/e81030ca97ec6fb075d1f7482e1977c1c886f182))
* **skills:** add design-delta-adopt, a skill that adopts design-delta in an existing codebase ([9c7c3e2](https://github.com/chrisgriffin/design-delta/commit/9c7c3e248e011f8ea495cbb8b483b3039ecdd1de))
* **skills:** add design-delta-build-design, a component in the design tool from its contract ([8fc39ed](https://github.com/chrisgriffin/design-delta/commit/8fc39edd6f11d175b337142689a900d00986d79f))
* **skills:** add design-delta-token, a skill that adds, renames, deprecates and removes a token ([d6d41f2](https://github.com/chrisgriffin/design-delta/commit/d6d41f28e44a0d35993f62c78c2c197d534ef255))

### Bug Fixes

* **dock:** parse the router's frontmatter, check the docked dir, ignore line endings ([5f4b606](https://github.com/chrisgriffin/design-delta/commit/5f4b606f0b4ed8715715331034791595d80da382))
* **dock:** pin design-delta-adopt and route to it from the router ([36c269f](https://github.com/chrisgriffin/design-delta/commit/36c269ffd5eccb1acf68b6005f0db693ce0405d1))
* **dock:** pin design-delta-build-design and route to it from the router ([2909670](https://github.com/chrisgriffin/design-delta/commit/2909670da324c5e7d59e73121cbacd15db45a0e4)), closes [#59](https://github.com/chrisgriffin/design-delta/issues/59)
* **exemptions:** cover the other direction, token-unemitted to token-unreferenced ([7391d3b](https://github.com/chrisgriffin/design-delta/commit/7391d3bcbd4c51072b314aeb08c5e7345d460d24))
* **exemptions:** let a token-unreferenced exemption cover token-unemitted ([f2291e9](https://github.com/chrisgriffin/design-delta/commit/f2291e92b4397cf3ca478b29d3f6f13b7c1a828d))
* **skills:** close the design-build skill's false-clean and loop gaps ([ec1334d](https://github.com/chrisgriffin/design-delta/commit/ec1334dc291455ea1d8e53b856df6fb7e69d98d2))
* **skills:** correct the adopt skill's naming, usage, gate and config steps ([8caa081](https://github.com/chrisgriffin/design-delta/commit/8caa081eaf27749507aa7f91a3e9ef3d0ec5b5aa))
* **skills:** design-delta-token covers declarations, group clashes, mode sets and aliasing tokens ([065d108](https://github.com/chrisgriffin/design-delta/commit/065d108b51ecea2a57da810856444e9c9343f388))
* **styles:** compare a single-var shorthand like its longhand ([0218931](https://github.com/chrisgriffin/design-delta/commit/0218931b1ae585329780788eaad01903625ae7a6))
* **styles:** keep only the background declaration that wins the cascade ([267caab](https://github.com/chrisgriffin/design-delta/commit/267caabf51e8fd5f0f6142e5fff526eaa502fd33))
* **tokens:** report a string dimension instead of censusing "undefinedundefined" ([b79167c](https://github.com/chrisgriffin/design-delta/commit/b79167c0789cc062e465ae936f23c3a34579ff1c))
* **tokens:** say only a mode is lost when only a mode is unreadable ([da1955c](https://github.com/chrisgriffin/design-delta/commit/da1955ce20c5951378c8da6862d5ca21874b8f3f))

### Documentation

* **spec:** a packaged skill that adds, renames, deprecates and removes a token ([7f637fd](https://github.com/chrisgriffin/design-delta/commit/7f637fd77c33520de2d3c27c8350d57d5d424781))
* **spec:** a packaged skill that adopts design-delta in an existing codebase ([3547c55](https://github.com/chrisgriffin/design-delta/commit/3547c557415352543121bcca62781d7670bfa2ba))
* **spec:** a packaged skill that builds a component in the design tool from its contract ([0cf7cc5](https://github.com/chrisgriffin/design-delta/commit/0cf7cc51458f5ba09d5f794e9d963f180e61fae8))
* **spec:** make a design-delta version bump the whole skill update ([1b593de](https://github.com/chrisgriffin/design-delta/commit/1b593deced233b7300991611fa09680a25eb8dbc))

## [0.28.0](https://github.com/chrisgriffin/design-delta/compare/v0.27.0...v0.28.0) (2026-11-23)

### Features

* **audit:** add --contract to scope the report to one component, and have init write every linked skill stub ([b87ab91](https://github.com/chrisgriffin/design-delta/commit/b87ab91a2783fde739c8c2bf6cb433a75912e719))
* **skills:** add design-delta-author, a skill that authors a component's contract ([58478ee](https://github.com/chrisgriffin/design-delta/commit/58478eef133af9a4ccd7949b1ab06c646f5ceff4))
* **skills:** add design-delta-build, a skill that builds a component from its contract ([61d13de](https://github.com/chrisgriffin/design-delta/commit/61d13de572cbff6764995baf8b6454c1920e9051))
* **skills:** add design-delta-docs, a component's documentation page from its contract ([58c8c9a](https://github.com/chrisgriffin/design-delta/commit/58c8c9a3e745997c1db02199e1d22aefafbb8dd4))
* **skills:** add design-delta-refresh, a skill that refreshes the design-side snapshot ([5c4d745](https://github.com/chrisgriffin/design-delta/commit/5c4d7452665fe2b0499ad7700bd1fa76698b00bc))
* **skills:** add design-delta-resolve, a skill that works down drift across a project ([764f023](https://github.com/chrisgriffin/design-delta/commit/764f023bbc5ed65e91a39bd61579325928d1c03d))

### Bug Fixes

* **audit:** keep token findings out of --contract scope and name a contract that failed to load ([5a0f9d0](https://github.com/chrisgriffin/design-delta/commit/5a0f9d0405e938eaf81d3faff8a1c63941173d0a))
* **deps:** override glob onto 14 beside minimatch 11 ([8ca080a](https://github.com/chrisgriffin/design-delta/commit/8ca080aafb1ae4d67f478d99b614ac2e368144af))
* **deps:** resolve minimatch past GHSA-g3hv-75wg-m249 ([968f0b6](https://github.com/chrisgriffin/design-delta/commit/968f0b6fac09e4d2664f0634c6818d237de9da51))
* describe design-delta as it is released in the npm description and README status ([222bff9](https://github.com/chrisgriffin/design-delta/commit/222bff98b42d2bc4ed98ec1c5e9d42d0cb67fe36))
* drop tracker issue numbers from rule descriptions ([84e284d](https://github.com/chrisgriffin/design-delta/commit/84e284d5d3ba4a0eb32af684bbf1ad65524ec34d))
* drop tracker issue numbers from shipped schemas and reference docs ([a6a5a2e](https://github.com/chrisgriffin/design-delta/commit/a6a5a2e45d463f973de1256a0549a049cf5e47c6))
* name design-delta as the owner of every ADR a consumer reads ([f4b1616](https://github.com/chrisgriffin/design-delta/commit/f4b1616913df33acb3e7284fb6d149aa821fe498))
* say the README's npm install works once the package is on npm ([47b0be5](https://github.com/chrisgriffin/design-delta/commit/47b0be556a29529246c03cf5d4f3044c3b889f53))
* **schema:** attribute every ADR the shipped schemas and doctor skill cite ([fe8b78f](https://github.com/chrisgriffin/design-delta/commit/fe8b78fdef57e64503785ecec5f1c4a1df034375))
* **schema:** drop tracker refs from consumer-read config text ([083faac](https://github.com/chrisgriffin/design-delta/commit/083faacdad63fe83ad36854a45365932d93cce0b))
* **skills:** answer the evaluator's findings on the resolve and refresh skills ([d57a231](https://github.com/chrisgriffin/design-delta/commit/d57a231f31d75c825e566d730b0c1e347866252f))
* **skills:** check diagnostics for an invalid contract and loop only on code-clearable findings ([9e26dce](https://github.com/chrisgriffin/design-delta/commit/9e26dceddace7fd5e6da84dc726299a3aa268ebf))
* **skills:** close the docs skill's gaps the evaluator found ([0ce3ede](https://github.com/chrisgriffin/design-delta/commit/0ce3ede4c5beb32150faeda874be7b2541f9405f))
* **skills:** give each doctor run its own temporary directory and always remove it ([6db8f2e](https://github.com/chrisgriffin/design-delta/commit/6db8f2eadb83c2265b390a77a22d93ed4bbe90c3))
* **skills:** make the refresh skill's ingest, skip and comparison steps match the engine ([10b49b5](https://github.com/chrisgriffin/design-delta/commit/10b49b5e7fd028db249f4ad8d66ea795294d586a))
* **skills:** quote the doctor's run directory and catch $TMPDIR paths ([e640dc3](https://github.com/chrisgriffin/design-delta/commit/e640dc358205389c23b12dd27bf80aba70cc1118))
* **skills:** validate only the new contract and expect design-side findings ([f6baaa5](https://github.com/chrisgriffin/design-delta/commit/f6baaa5e0e3e5de4a5c9764a9f6fbbab7d296863))
* the gate lints again, and it is one command ([2668c6a](https://github.com/chrisgriffin/design-delta/commit/2668c6a20588aeeb55f6a6ca57b0cdf8d30cddec))

### Documentation

* **adr:** restore ADR-005, why a component binding a primitive is drift ([a3ef206](https://github.com/chrisgriffin/design-delta/commit/a3ef20631a7cbaab6e7f59d8d4856b5c8deadd17))
* **adr:** scope the ADR-005 sentence to when no skip applies ([4f53837](https://github.com/chrisgriffin/design-delta/commit/4f53837df37370d11cd6d560976b1325bc15c90d))
* name only the CI checks this repo runs, by their real job ids ([e929b92](https://github.com/chrisgriffin/design-delta/commit/e929b9249ee77a50f5799c0c9ba1dd3ef0505c98))
* **readme:** qualify verify's error gate as the default ([2456a17](https://github.com/chrisgriffin/design-delta/commit/2456a175c83119ada3c48264cfa8b26099dbfcab))
* **readme:** say design-delta is on npm ([8064601](https://github.com/chrisgriffin/design-delta/commit/8064601393eb4500937ffc14e8305a8f55db3943))
* **readme:** say verify's --fail-on can gate on warn and review findings ([d73a133](https://github.com/chrisgriffin/design-delta/commit/d73a133c5e711b1b3b90e96143ffdbec1633f154))
* say npm run verify skips the CLAUDE.md budget ([dddfd08](https://github.com/chrisgriffin/design-delta/commit/dddfd08ed76367861169dd2272d3bc8031ccb8c3))
* say when the Node 24/26 jobs run, and name the CLAUDE.md budget ([c093ec5](https://github.com/chrisgriffin/design-delta/commit/c093ec5989f428fb819e857f5785fad02d8ab31d))
* **spec:** a packaged skill that authors a component's contract ([b347dc4](https://github.com/chrisgriffin/design-delta/commit/b347dc46eb9f506cdcc7cb6cf1f96ab7eced70f6))
* **spec:** a packaged skill that builds a component from its contract ([ff8f260](https://github.com/chrisgriffin/design-delta/commit/ff8f26091033557f46836c2c3eacc11eb7b8bd69))
* **spec:** a packaged skill that refreshes the design-side snapshot ([4ea06d0](https://github.com/chrisgriffin/design-delta/commit/4ea06d0434e73f854935363f6f3a49da73dc9863))
* **spec:** a packaged skill that works down drift across a project ([5e0fc65](https://github.com/chrisgriffin/design-delta/commit/5e0fc657c3100d621a6b1e8dd97de9d5a8992ccf))
* **spec:** a packaged skill that writes a component's documentation page from its contract ([8c47d7b](https://github.com/chrisgriffin/design-delta/commit/8c47d7baafc1918ff0184791cd6beb4b15abf4bb))
* **spec:** audit --contract scopes the output to one component, and init writes every linked skill stub ([089afaf](https://github.com/chrisgriffin/design-delta/commit/089afaffd6da1a2c6394339209520a425848ea0f))
* **spec:** every ADR this engine names in a consumer-read string says which package owns it ([79eb1ef](https://github.com/chrisgriffin/design-delta/commit/79eb1ef0d13998f9f84ec28def8b26b5d3a68036))
* **spec:** make the runnable line a single red command, not a compound claim ([8dd362c](https://github.com/chrisgriffin/design-delta/commit/8dd362cbef6c834dba86783cafd0bd947ca47272))
* **spec:** make the runnable line observable, and count both scaffold notes ([edf5c9f](https://github.com/chrisgriffin/design-delta/commit/edf5c9fe607a0a7d4543917dfb8dff5b387ff466))
* **spec:** restore the accepted decision record this engine still implements but no longer carries ([a47fbf8](https://github.com/chrisgriffin/design-delta/commit/a47fbf8b4c6d210231e47e4f35b5c6f09a4c3155))
* **spec:** runnable line names a path that exists, so the Ready gate can read it ([304b150](https://github.com/chrisgriffin/design-delta/commit/304b1504cf8123cbedaad1ea2fbfebba55731b5a))
* **spec:** the doctor skill works in a unique temporary directory per run ([e91f4ee](https://github.com/chrisgriffin/design-delta/commit/e91f4ee0501476d26251cf7b1b4ae65c680a6dcc))
* **spec:** the gate lints again, and it is one command ([804a89a](https://github.com/chrisgriffin/design-delta/commit/804a89a9bbbc5cd1d50848386274f4d70fb5e73f))
* **spec:** the npm description and README status describe design-delta as it is released ([dc71ef2](https://github.com/chrisgriffin/design-delta/commit/dc71ef2d0798ac43e7ded3ed817fa722d63ca14d))
* **spec:** the README says --fail-on can make verify gate on warn and review findings ([8b362b2](https://github.com/chrisgriffin/design-delta/commit/8b362b23da62434683f177d3de6bf69b61189741))
* **spec:** the README says design-delta is on npm ([455f529](https://github.com/chrisgriffin/design-delta/commit/455f5291868037d3526f14c5b92e46516bcca54f))
* **spec:** the reviewer checklist, answered ([ae5ea1e](https://github.com/chrisgriffin/design-delta/commit/ae5ea1e4c29487a069295a32e5c87df4ac39d9b7))

## 0.27.0 (2026-11-07)

### Features

* the engine's source at 0.26.0, renamed design-delta and wired to npm ([5f15425](https://github.com/chrisgriffin/design-delta/commit/5f154252784d6d8aa47895f3412081be65804e5b))

### Bug Fixes

* **source:** drop personal attributions, and say what the copy is ([8fddfed](https://github.com/chrisgriffin/design-delta/commit/8fddfed84c177a5c1fb26f17c317035266f1197b))

### Documentation

* **spec:** design-delta is the engine's source at 0.26.0, renamed and released to npm ([e9558f8](https://github.com/chrisgriffin/design-delta/commit/e9558f8e1c1102d5b5eb1c48ee850acdfdce834f))
