# pvmp 2.0 — Rebuild Specification

Complete rewrite. No backward compatibility, no shared code with v1.
Built on an orphan branch (`v2`); v1 history stays reachable on `main`.

Status: agreed via design interview. Every decision below was explicitly chosen.

---

## 1. What it is

A VSCode extension providing a private extension marketplace for corporate
environments. Extensions are distributed as **npm packages** (JFrog Artifactory,
Sonatype Nexus, Verdaccio) or as **local `.tgz` files** in a folder. The UI is a
1:1 visual clone of VSCode's own Extensions view.

Published as `oxdev03.pvmp` **v2.0.0** — same marketplace listing, major bump
signals the break.

---

## 2. Distribution format (our contract)

An extension is an npm package whose tarball contains the `.vsix` as the
canonical artifact. npm is transport only.

```
@corp/vsc-lint-1.4.0.tgz
└─ package/
    package.json      ← metadata, mirrored from the extension manifest
    icon.png          ← MUST precede extension.vsix (see §2.1)
    README.md
    CHANGELOG.md
    extension.vsix    ← the real artifact, opaque to pvmp
```

`package.json` mirrors the extension manifest and adds a `pvmp` block for
fields that exist only in the vsix manifest:

```jsonc
{
  "name": "@corp/vsc-lint",
  "version": "1.4.0",
  "description": "…",
  "keywords": ["vscode-extension", "pvmp"],
  "engines": { "vscode": "^1.96.0" },
  "categories": ["Linters"],
  "pvmp": {
    "extensionId": "acme.lint",     // publisher.name, as VSCode knows it
    "displayName": "Corp Lint",
    "publisherDisplayName": "Acme",
    "targetPlatform": "universal",  // or win32-x64, linux-arm64, …
    "preRelease": false
  }
}
```

**Consequence: pvmp never parses `extension.vsixmanifest`.** All metadata comes
from `package.json`, which the packument already carries. No XML parsing, no
`xml2js`. The vsix is a blob handed to VSCode.

### 2.1 Tarball file ordering

Files MUST be ordered metadata-first: `package.json`, `icon.png`, `README.md`,
`CHANGELOG.md`, then `extension.vsix`. pvmp streams tarballs and aborts the
download once it has what it needs (§6.3). Wrongly-ordered tarballs still work,
they just download in full.

### 2.2 No publishing CLI

Documented format only, with an example CI snippet per platform (GitHub Actions,
GitLab CI, Jenkins). Decided: not worth owning a CLI.

---

## 3. Architecture

### 3.1 Workspace (pnpm)

```
apps/
  extension/          VSCode host code + the extension manifest
  webview/            React app, Vite, two mount points (list, details)
packages/
  contract/           IPC + domain types. Zero runtime deps.
  core/               registry, cache, install orchestration, semver resolution,
                      tarball reader
  source-local/       LocalSource
  source-npm/         NpmSource + catalog adapters
tooling/              shared tsconfig / oxlint / vite presets
```

Sources are real packages so the `SourceProvider` boundary is enforced by the
module graph rather than by discipline. `contract` has zero deps so both the
Node host and the browser bundle can import it safely.

### 3.2 Plugin seams

Two small registries, not one big one.

```ts
interface SourceProvider {
  readonly id: string;
  list(ctx: SourceCtx): Promise<ExtensionRef[]>;
  resolve(ref: ExtensionRef): Promise<ExtensionMeta>;
  fetchIcon(ref: ExtensionRef): Promise<Uint8Array | undefined>;
  fetchVsix(ref: ExtensionRef): Promise<Uint8Array>;
}

interface CatalogAdapter {
  readonly id: 'jfrog' | 'nexus' | 'verdaccio';
  detect?(registryUrl: string, ctx: SourceCtx): Promise<boolean>;
  listPackages(ctx: SourceCtx): Promise<string[]>;
}
```

`NpmSource` owns everything shared across registries — packument fetch, tarball
fetch, ETag caching, auth, version resolution. Adapters supply only
`listPackages()`, roughly 40 LOC each. `LocalSource` implements `SourceProvider`
directly.

Both sources share one `readPvmpTarball()` in `core`. Only the transport
differs: filesystem vs HTTP. Testing the remote path effectively tests the local
path.

Registration is explicit at activation. No public extension API, no third-party
plugin contract — in-repo providers only.

---

## 4. Sources

### 4.1 LocalSource

Recursive scan for `*.tgz`, default depth 3, configurable, with glob ignores.
A `FileSystemWatcher` on `**/*.tgz` invalidates the cache and refreshes the view
without a manual reload. Cache key: `path + mtime + size`.

```jsonc
{ "type": "local", "path": "${userHome}/vsix", "depth": 3 }
```

`${userHome}` and `${workspaceFolder}` are substituted. The resolved absolute
path is logged, because in a remote context it is not obvious whose filesystem
it refers to (§8).

### 4.2 NpmSource

1. Adapter lists package names.
2. Packument per package (`GET /{name}`, ETag-cached) yields every version with
   its full `package.json`.
3. Tarball fetched lazily — only for icons (streamed, aborted early) and installs.

Ships in v2:

| Adapter | Listing | Test level |
|---|---|---|
| `verdaccio` | `/-/all`, `/-/v1/search` | **Live** — Docker Verdaccio in CI |
| `jfrog` | `/artifactory/api/storage/{repo}` walk | Recorded HTTP fixtures |
| `nexus` | `/service/rest/v1/components?repository=` (cursor-paginated) | Recorded HTTP fixtures |

Verdaccio gets a real end-to-end test — publish a fixture package containing a
real vsix, then list → packument → tarball → vsix extract. It validates the
shared npm client the other two ride on.

### 4.3 Authentication

Bearer token per source, in VSCode SecretStorage (OS keychain), keyed
`pvmp.token.<sourceId>`. `.npmrc` is deliberately **not** read.

```
Authorization: Bearer <token>
```

Command `PVMP: Sign in to Source` → QuickPick of configured sources → input box
→ `context.secrets.store`. A 401 surfaces in the UI (§7.4).

### 4.4 Conflict resolution

One marketplace entry per `pvmp.extensionId`. The version list is the union
across all sources, each version tagged with its origin. Identical versions from
two sources: configured source order wins, the loser is marked shadowed. The
details page shows each version's source.

---

## 5. Version resolution

The v1 bug: versions were compared with `a > b` string sort, so `1.10.0` ranked
below `1.9.0`.

```ts
const candidates = versions
  .filter(v => semver.satisfies(vscodeVersion, v.engines.vscode))
  .filter(v => v.targetPlatform === platform || v.targetPlatform === 'universal')
  .filter(v => (v.preRelease ? optedIn(extensionId) : true))
  .sort(semver.rcompare);

const latest     = candidates[0];
const hasUpdate  = installed && semver.gt(latest.version, installed);
```

Pre-releases are hidden unless the user opts in per extension, mirroring the
real marketplace toggle.

---

## 6. Caching

Content-addressed, under `context.globalStorageUri`. Accessed via
`vscode.workspace.fs` throughout, so remote URIs work transparently.

```
globalStorage/pvmp/cache/
  meta/<key>.json       manifest fields + links
  readme/<key>.md
  changelog/<key>.md
  icon/<key>.png        served via asWebviewUri — never a base64 data: URI
  index.json            key → source, lastSeen, size
```

Keys: `sha256` (remote, from packument `dist.integrity`) or `path+mtime+size`
(local). LRU eviction against a size cap, default 200MB.

Packuments are cached separately with ETag revalidation.

### 6.3 Streaming icon fetch

Icons are fetched lazily per visible row via `IntersectionObserver`, cached
permanently by `package@version`. The fetch streams the tarball through
`fflate`'s gunzip into `nanotar`, and calls `AbortController.abort()` the moment
`icon.png` is complete.

With §2.1 ordering that costs ~5KB instead of the full multi-MB tarball. Without
it, the download completes normally. This is the known cost of choosing lazy
fetch over embedding icons in `package.json`.

Rows render a placeholder codicon until the icon resolves.

---

## 7. Webview

### 7.1 Surfaces

Two React mount points from one Vite build, sharing components:

- **Sidebar** — `WebviewViewProvider` in the activity bar. Replaces v1's
  `TreeView` entirely.
- **Details** — `WebviewPanel` in an editor tab, a clone of VSCode's extension
  editor.

### 7.2 Sidebar (v2 scope)

Grouped, collapsible, sorted by name: **Updates Available / Installed /
Available**. Marketplace-style rows: 42×42 icon, name, publisher, version,
description snippet, action button.

**No search box, no filter chips, no sort dropdown in v2** — deferred to v3.

### 7.3 Visual fidelity — "exact 1:1"

Metrics ported from VSCode's own MIT-licensed CSS (`extensionsViewlet.css`,
`extensionEditor.css`), not eyeballed: exact row heights, paddings, font sizes,
weights, and theme-color keys.

Locked in by Playwright screenshot diffs against reference captures of the real
Extensions view, across **dark / light / high-contrast**. Goldens are generated
inside a container so font rendering is reproducible across machines and CI.

### 7.4 Error surface

A single generic error banner component handles every source failure — 401,
unreachable, TLS, parse error — showing the message, a `Show log` link, and a
`Sign in` action when the failure is 401. No per-source health panel.

### 7.5 Styling

Tailwind v4, CSS-first config. The archived `@githubocto/tailwind-vscode`
(Tailwind v3 `plugin()` API, archived 2026-08-06) is **cloned and ported** to a
v4 `@theme` block — a codegen script emits `--color-vscode-*` aliases for every
VSCode theme color id. No runtime dependency.

`@vscode-elements/react-elements` supplies the real widgets (dropdown, tabs,
checkbox, badge). `@vscode/webview-ui-toolkit`, used in v1, was deprecated in
January 2025 and is not used.

### 7.6 Data layer

TanStack Query over the typed IPC client. Each `HostApi` method becomes a query
or mutation; caching, dedup, loading/error states, retry and stale-time come
free. Host events map to `queryClient.invalidateQueries`.

### 7.7 Markdown & CSP

README and CHANGELOG cross the wire as **raw markdown** and render in the
webview with `react-markdown` + `rehype-sanitize`.

```
Content-Security-Policy:
  default-src 'none';
  script-src 'nonce-{nonce}';
  style-src {cspSource} 'unsafe-inline';
  img-src {cspSource} https: data:;
  font-src {cspSource};
```

Relative README image paths are rewritten to cached files served via
`asWebviewUri` — fixing v1's documented "local images unsupported" limitation.

---

## 8. Runtime placement

```jsonc
"engines": { "vscode": "^1.96.0" },   // Node 20
"extensionKind": ["workspace", "ui"]  // prefer remote
```

Desktop only. **No web build** — `vscode.dev` is out of scope. Devcontainers,
SSH remotes and code-server are in scope; all three run a Node extension host.

Preferring `workspace` means installs land in the container/remote where the
developer actually works, and it is the only mode code-server can offer. The
tradeoff: a local-folder source resolves against the remote filesystem. The
resolved path is logged so this is never a mystery.

File access goes through `vscode.workspace.fs` rather than `node:fs`, which
handles remote URIs uniformly at no extra cost.

---

## 9. Install & update

Install: fetch `.tgz` → extract `extension.vsix` → write to a temp dir →
`workbench.extensions.installExtension` with a `Uri` → await
`vscode.extensions.onDidChange` → clean up.

**Reload only when VSCode reports it is required.** v1 hard-reloaded the window
after every install and uninstall.

Update policy: check on activation and on explicit refresh, show a badge, user
clicks Update. Opt-in auto-update behind a setting.

Failure state and backoff live in `context.globalState`, **never in settings**.
v1 wrote a `failedUpdates` array into user settings, which syncs across machines
and conflates user intent with scratch state.

```
globalState:  lastCheck, failures: { 'acme.lint@1.4.0': { n: 2, until: … } }
settings:     pvmp.sources, pvmp.autoUpdate, pvmp.checkInterval  (intent only)
```

Installed status is read from `vscode.extensions.all` regardless of origin. If
an extension was installed from the public marketplace and a private source
offers a different version, that is shown honestly rather than hidden.

---

## 10. IPC

Hand-written, roughly 150 LOC in `packages/contract` + a client/host pair. No
dependency on `react-vscode-webview-ipc`.

```ts
// packages/contract
export interface HostApi {
  listCatalog(): Promise<CatalogEntry[]>;
  getDetails(id: string): Promise<ExtensionDetails>;
  getIcon(id: string, version: string): Promise<string | undefined>; // webview uri
  install(id: string, version: string): Promise<InstallResult>;
  uninstall(id: string): Promise<void>;
  refresh(): Promise<void>;
  signIn(sourceId: string): Promise<void>;
  setPreReleaseOptIn(id: string, on: boolean): Promise<void>;
}

export interface HostEvents {
  catalogChanged: () => void;
  installProgress: (p: { id: string; phase: Phase; pct?: number }) => void;
  sourceError: (e: { sourceId: string; kind: ErrorKind; message: string }) => void;
}
```

Transport: request-id map, promise table, configurable timeout, event emitter.
Both sides are generated from the one interface, so drift is a type error.

---

## 11. Build

Vite for both targets — one tool, one config language, one plugin ecosystem.

```
apps/webview/vite.config.ts     → dist/webview/
apps/extension/vite.config.ts   → dist/extension.cjs
    lib: { formats: ['cjs'] }
    rollupOptions: { external: ['vscode'] }
    ssr: true, target: 'node20'
```

`vsce package --no-dependencies` over the bundled output. **This flag is
mandatory** — `vsce` cannot walk pnpm's symlinked `node_modules`, so everything
must be bundled.

Archives: `fflate` (zip + gunzip, ~8KB, no native deps) + `nanotar`. No
`adm-zip`, which is Node-only and pulls native concerns into packaging.

---

## 12. Tooling

| Concern | Tool |
|---|---|
| Lint | **oxlint** (pinned exact) |
| Format | **oxfmt** (pinned exact — 0.68.0, pre-1.0) |
| Types | `tsc -b --noEmit` |
| Unit tests | Vitest |
| E2E / visual | Playwright |
| Versioning | Changesets |
| Hooks | lint-staged + simple-git-hooks |

oxfmt is pre-1.0 and passes ~95% of Prettier's JS/TS suite; `vuejs/core` and
`vercel/turborepo` use it in production. Both oxc tools are pinned to exact
versions, not caret ranges, because pre-1.0 minors can change formatting output.

oxlint has ported most `react-hooks` and `jsx-a11y` rules, covering the
accessibility linting the pixel-clone UI needs.

---

## 13. Testing

| Layer | Scope |
|---|---|
| **Vitest** — `core`, `source-*` | Version-resolution matrix (semver × engine × target × pre-release), tarball parsing, cache keying, source merging and priority, streaming abort. Pure functions; the highest-value tests in the repo, and where v1's real bugs lived. |
| **Playwright** — `apps/webview` | Standalone against the Vite dev server with mocked IPC. List rendering, grouping, version dropdown, install/uninstall flows, error and empty states, plus dark/light/high-contrast visual diffs. |
| **Verdaccio integration** | Docker Verdaccio in CI. Publish a fixture package containing a real vsix, then list → packument → tarball → vsix extract, end to end. |

**No `@vscode/test-cli` extension-host tests** — deliberately skipped as the
slowest and flakiest layer.

### 13.1 Playwright harness

Mocked at the `acquireVsCodeApi` boundary — not at the API object. A dev-only
shim defines `window.acquireVsCodeApi()` and runs an in-page `HostApi`
implementation over the same postMessage path, so the entire IPC layer
(serialization, request ids, timeouts, event fan-out) executes under test.

```ts
// apps/webview/src/dev/mock-host.ts
window.acquireVsCodeApi = () => ({
  postMessage: m => fixtureHost.handle(m),
  getState, setState,
});
```

Scenarios are selected by URL (`?fixture=empty-catalog`, `?fixture=auth-401`)
and driven from tests via `window.__pvmpMock` — force a 401, a slow install, an
empty catalog. The mock is the IPC transport plus a thin fixture responder,
nothing more.

---

## 14. Release

Changesets → version PR → tag → publish.

```
pnpm changeset                     → .changeset/*.md
CI on main:
  changesets/action                → "Version Packages" PR
  merge → tag v2.0.0
  vsce publish --no-dependencies   → VS Marketplace
  ovsx publish --no-dependencies   → Open VSX
  gh release + .vsix asset
```

Only `apps/extension` publishes; workspace packages stay `"private": true`.

Open VSX matters: corporate users on VSCodium, Cursor and Windsurf cannot reach
the Microsoft marketplace at all.

This replaces v1's publish-on-every-push-to-main, where a README typo shipped a
release.

---

## 15. Migration

**None.** v1's `privateMarketplace.Source` is not read. Existing users open an
empty marketplace and reconfigure, guided by a `viewsWelcome` entry and the
CHANGELOG. Explicitly chosen over a ~15 LOC migration shim.

---

## 16. Settings

```jsonc
{
  "pvmp.sources": [
    { "type": "local", "path": "${userHome}/vsix", "depth": 3 },
    {
      "type": "npm",
      "id": "corp-artifactory",
      "registry": "https://art.corp/artifactory/api/npm/npm-local/",
      "adapter": "jfrog",          // omit to auto-detect
      "scope": "@corp"
    }
  ],
  "pvmp.autoUpdate": false,
  "pvmp.checkInterval": 3600,
  "pvmp.cacheSizeMb": 200
}
```

Array order is source priority (§4.4). Tokens never appear here.

---

## 17. Known risks

1. **JFrog and Nexus adapters are fixture-verified, not live-verified.** Only
   Verdaccio is exercised against a real server. Validate both against a real
   instance before announcing support.
2. **Install target in remote contexts.** `workbench.extensions.installExtension`
   with a `Uri`, under `extensionKind: ["workspace","ui"]`, needs manual
   verification in a devcontainer and in code-server that the extension lands on
   the intended host. Verify this early — it invalidates §8 if wrong.
3. **oxfmt is pre-1.0** (0.68.0). Pinned exactly; expect occasional formatting
   churn on upgrade.
4. **Visual-diff flakiness.** Font rendering differs across OS and CI. Goldens
   must be generated in the same container that runs the assertions.
5. **Icon fetch cost** depends on publishers honoring §2.1 tarball ordering. If
   they don't, the list pulls full tarballs. Revisit the embedded-icon option if
   this bites.
6. **No search in v2** with a full client-side catalog already loaded — a
   substring filter is ~15 lines. Deferred by choice, cheap to reverse.

---

## 18. Sequencing

1. Orphan branch, pnpm workspace skeleton, tooling, CI.
2. `contract` + IPC transport + its unit tests.
3. `core`: tarball reader, semver resolution, cache. Vitest throughout.
4. `source-local` + watcher. First end-to-end path with no network.
5. Webview shell, Tailwind v4 theme port, mock host, Playwright baseline.
6. Sidebar to pixel spec + visual goldens.
7. Details panel to pixel spec, markdown + CSP.
8. `source-npm` + Verdaccio adapter + live integration test.
9. JFrog and Nexus adapters + fixtures.
10. Install/update/uninstall orchestration, globalState, error banner.
11. Release pipeline, docs, format specification.
