# pvmp 2.0 design

pvmp 2.0 is a rewrite that shares no code with 1.x and reads none of its
settings. This document records what 2.0 does and why. Code comments cite its
sections as `SPEC.md §n`, so keep the numbering stable.

## 1. Scope

A VS Code extension that installs extensions from private sources: npm
registries (JFrog Artifactory, Sonatype Nexus, Verdaccio) and local folders of
`.tgz` packages. Its UI copies VS Code's Extensions view.

It publishes as `oxdev03.pvmp` 2.0.0, on the same Marketplace listing as 1.x.
The major version marks the break.

## 2. Package format

An extension is an npm package whose tarball contains the `.vsix`. npm only
transports it; pvmp hands the vsix to VS Code unchanged.

```
@corp/vsc-lint-1.4.0.tgz
└─ package/
    package.json      metadata from the extension manifest, plus a "pvmp" block
    CHANGELOG.md
    README.md
    icon.png
    extension.vsix
```

`package.json` carries the manifest fields pvmp shows, and a `pvmp` block for
the ones that otherwise live only in `extension.vsixmanifest`:

```jsonc
{
  "name": "@corp/vsc-lint",
  "version": "1.4.0",
  "engines": { "vscode": "^1.96.0" },
  "categories": ["Linters"],
  "pvmp": {
    "extensionId": "acme.lint", // publisher.name, as VS Code knows it
    "displayName": "Corp Lint",
    "publisherDisplayName": "Acme",
    "targetPlatform": "universal", // or a VS Code target such as linux-x64
    "preRelease": false,
  },
}
```

pvmp never parses `extension.vsixmanifest`. A packument already contains
every version's `package.json`, so the catalog needs no tarball and no XML.
Packages without a `pvmp` block are ignored.

[`docs/publishing.md`](docs/publishing.md) is the publisher-facing version of
this section.

### 2.1 Entry order

`extension.vsix` must come after the metadata entries, because pvmp reads
icons by streaming the tarball and aborting (§6.3). A package in any other
order still works but downloads in full for its icon. `npm pack` sorts entries
by file extension with `package.json` first, which produces a valid order
without any effort from the publisher.

### 2.2 No publishing CLI

The format is small enough to build with `jq` and `npm pack`.
`docs/publishing.md` gives the script and CI examples for GitHub Actions,
GitLab and Jenkins. A CLI would be one more thing to version and support.

## 3. Architecture

### 3.1 Workspace

```
apps/
  extension/      VS Code host. Its package.json is the extension manifest.
  webview/        React app: the sidebar and details entry points.
packages/
  contract/       IPC and domain types. No runtime dependencies.
  core/           Version resolution, tarball reading, cache, source interfaces.
  source-local/   LocalSource.
  source-npm/     NpmSource and its catalog adapters.
tooling/          Shared tsconfig.
```

The internal packages are source-only: `exports` points at `src/index.ts`.
Only the two apps build, so there are no project references or declaration
files to keep in step.

The extension's workspace package is named `pvmp`, because its `package.json`
is the VS Code manifest and vsce rejects a scoped name.

`core` never imports `vscode`. The host injects a `FileStore`, a logger and
the other services, so core runs under plain Vitest.

### 3.2 Extension points

Each source type lives in its own package, so the module graph enforces the
interface between core and sources.

```ts
interface SourceProvider {
  readonly id: string;
  list(): Promise<ExtensionVersion[]>;
  fetchDetails(version: ExtensionVersion): Promise<ExtensionDetailContent>;
  fetchIcon(version: ExtensionVersion): Promise<Uint8Array | undefined>;
  fetchVsix(version: ExtensionVersion): Promise<Uint8Array>;
  dispose?(): void;
}

interface SourceFactory {
  readonly type: string; // the `type` in pvmp.sources
  create(config: RawSourceConfig, deps: SourceDeps): SourceProvider;
}

interface CatalogAdapter {
  readonly id: string;
  listPackages(ctx: AdapterContext): Promise<string[]>;
}
```

The host registers the two factories at activation. There is no API for
third-party sources.

`NpmSource` handles everything the registries share: packuments, tarballs,
ETags and auth. An adapter only lists package names, because npm has no
portable way to do that. Both sources read packages with the same
`readPvmpTarball()` from core.

## 4. Sources

### 4.1 Local folders

```jsonc
{ "type": "local", "path": "${userHome}/vsix", "depth": 3 }
```

pvmp scans breadth-first for `*.tgz`, `depth` levels deep (default 3),
skipping `node_modules`, `.git`, `.svn`, `.hg` and `.cache`. Cached metadata is
keyed by path, mtime and size, so editing a file re-reads it. The file's mtime
stands in for a publish date.

Paths accept `${userHome}`, `${workspaceFolder}` and `${env:NAME}`. The
resolved path is logged, because in a remote window it refers to the remote
machine (§8).

### 4.2 npm registries

1. The adapter lists package names.
2. pvmp fetches each packument (`GET /<name>`, revalidated by ETag), which
   holds every version's `package.json` and publish time.
3. It reads a tarball only for an icon (the first few KB, §6.3), for the
   details page, or to install.

| `adapter`   | Lists packages with                                 | Tested against              |
| ----------- | --------------------------------------------------- | --------------------------- |
| `verdaccio` | `/-/all`, falling back to `/-/v1/search`            | A live Verdaccio container  |
| `jfrog`     | `GET /api/storage/<repo>?list&deep=1`               | Recorded responses only     |
| `nexus`     | `GET /service/rest/v1/components?repository=<repo>` | Recorded responses only     |

Without an `adapter` setting, a registry URL containing `/api/npm/` selects
`jfrog` and one containing `/repository/` selects `nexus`. Any other URL is a
configuration error, because the wrong listing API would produce an empty
catalog with no visible cause. `repo` and `baseUrl` override the values
derived from the URL. `scope` restricts the catalog to one npm scope.

The Verdaccio test publishes a package containing a real vsix, then lists,
fetches the packument and tarball, and extracts the vsix. That also covers
the HTTP client the JFrog and Nexus adapters use.

### 4.3 Authentication

Each source can have a bearer token, stored in SecretStorage (the OS keychain)
under `pvmp.token.<sourceId>` and sent as `Authorization: Bearer <token>`.
**Private Marketplace: Sign in to Source** asks for it; submitting an empty
token deletes it. pvmp does not read `.npmrc`.

Settings sync between machines, so tokens never go there. Error messages and
log lines strip userinfo from URLs, so a registry configured as
`https://user:pass@host/` does not leak its password into the error banner.

A 401 or 403 becomes an `auth` error, and its banner offers sign-in (§7.4).

### 4.4 Several sources

pvmp shows one entry per `pvmp.extensionId`, with the versions of every
source merged. When two sources offer the same version, a build for the exact
host platform beats `universal`. After that, the source listed first in
`pvmp.sources` wins. The loser stays in the version list, marked shadowed, and
the details page names each version's source.

## 5. Version resolution

A version is installable when its version string is valid semver, its
`targetPlatform` is `universal` or matches the host, `engines.vscode` accepts
the running VS Code, and it is not a pre-release (unless you opted in for that
extension). Insiders builds report versions like `1.99.0-insider`, so the
engine check includes pre-releases.

Versions sort with `semver.rcompare`. 1.x compared strings and ranked 1.9.0
above 1.10.0.

An entry's status is `update-available` when the newest installable version
is greater than the installed one. An installed extension stays listed even
with no installable version, so you can still uninstall it. If no source
offers the installed version (it came from the public Marketplace, say), the
entry is marked external.

The host platform comes from `process.platform` and `process.arch`, plus
`/etc/alpine-release` to tell Alpine from other Linux.

## 6. Cache

`BlobCache` stores blobs under `globalStorage/cache/` through
`vscode.workspace.fs`, which also works on remote hosts.

```
cache/
  meta/<key>.json    packuments with their ETag, detail content, local metadata
  icon/<key>.png     icons
  index.json         size and access order of every blob
```

| Key                                 | Holds                                    |
| ----------------------------------- | ---------------------------------------- |
| `packument:<source>:<name>`         | A packument and its ETag                 |
| `details:<source>:<package>@<ver>`  | README, CHANGELOG and links              |
| `<source>:<package>@<ver>`          | An npm package's icon                    |
| `<source>:<path>:<mtime>:<size>`    | A local package's metadata and icon      |
| `webview:<extensionId>@<ver>`       | The copy the webview loads by URI (§7.7) |

The cache never decides what is stale; a key changes when its content can.
Keys are percent-encoded into one path segment, because they contain
registry-supplied names.

Eviction is LRU against `pvmp.cacheSizeMb` (default 200). Access order is a
counter, because `Date.now()` cannot order writes within a millisecond.
Every refresh prunes and then flushes the index, and `deactivate()` flushes
too. Pruning first reconciles the index with the disk: blobs from a session
that never flushed are adopted as least recently used, and entries whose file
is gone are dropped.

### 6.3 Streaming icon fetch

The sidebar requests an icon when its row scrolls into view
(`IntersectionObserver`). NpmSource streams the tarball through fflate's
push-based `Gunzip` into a small incremental tar reader and aborts the fetch
once `icon.png` is complete. A test asserts that a 525KB package costs under
16KB.

`DecompressionStream` is not usable here: `pipeThrough` runs its own read loop
ahead of the consumer, so the whole tarball transfers even after the reader
stops.

LocalSource reads the file and caches the icon on first use. Either source
re-extracts an icon that was evicted.

## 7. Webview

### 7.1 Surfaces

- **Sidebar.** A `WebviewViewProvider` in the activity bar, with a badge
  counting available updates.
- **Details.** A `WebviewPanel` in an editor tab titled `Extension: <name>`.
  Opening another extension reuses the open panel, as VS Code's own extension
  editor does.

Both come from one Vite build with two entry points and shared components.

### 7.2 Layout

The sidebar groups extensions into **Updates Available**, **Installed** and
**Available**, each sorted by display name and collapsible. A row shows a 36px
icon, name, version, description, publisher and an Install, Update or
Uninstall button. Uninstall appears on hover, as in VS Code.

The details page has a 128px icon, name, version picker, Install and Uninstall
buttons, a pre-release checkbox and a **Show log** link. Below are Details
(the README) and Changelog tabs, and a column with categories, links and a
More Info table.

Search, filters and sorting are deferred to 3.0.

### 7.3 Visual fidelity

Row height, padding, icon size, font weights and colour tokens come from VS
Code's own source (`apps/webview/src/components/metrics.ts` cites each file).

Playwright stores golden screenshots of both views in Dark Modern, Light
Modern and Dark High Contrast. They are rendered in the Playwright container,
because macOS and Linux render fonts too differently to compare, and the pixel
checks run only on Linux. A second test asserts that every `--vscode-*` token
the UI uses resolves, since a missing one renders transparent without error.

The README screenshots come from the packaged extension running in
code-server (`pnpm screenshots`).

### 7.4 Errors

Each failing source gets one banner with its message and a **Show log**
button. Auth failures add **Sign in**. A failing source contributes no
entries; the other sources still list.

The log is a `LogOutputChannel`, so you can raise it to Trace from the Output
panel without reloading.

### 7.5 Styling

Tailwind v4. `scripts/generate-vscode-theme.mjs` reads VS Code's theme colour
reference and writes an `@theme inline` block with a Tailwind colour for each
of the 910 `--vscode-*` variables, so `bg-vscode-editor-background` follows
the active theme. It replaces `@githubocto/tailwind-vscode`, a Tailwind v3
plugin archived on 2026-08-06.

The controls are native elements styled with those tokens. There is no
component library.

### 7.6 Data

TanStack Query wraps the typed IPC client. `catalogChanged` from the host
refetches the catalog. Install, uninstall and the pre-release toggle refetch
the catalog and details only; icons have an infinite stale time, because
they are keyed by version.

### 7.7 Markdown and CSP

READMEs and CHANGELOGs arrive as raw markdown. The webview renders them with
`react-markdown`, `remark-gfm` and `rehype-sanitize`, which drops scripts,
event handlers and `javascript:` URLs. Headings move down one level so the
page title stays the only `<h1>`. Links open outside the webview.

The host sets this CSP:

```
default-src 'none';
script-src 'nonce-<nonce>' <cspSource>;
style-src <cspSource> 'unsafe-inline';
img-src <cspSource> https: data:;
font-src <cspSource>;
connect-src 'none';
```

The entry script carries the nonce. It imports a shared chunk, and CSP does
not pass a nonce on to imported modules, so `script-src` also allows
`cspSource`. `localResourceRoots` limits that origin to the extension's
`dist/` and its global storage.

Icons load as `asWebviewUri` files from the cache, never as base64 over IPC.
Images in READMEs load only from `https:` and `data:` URLs (§17).

The host passes the details target as `data-extension-id` on `#root`. The
name is a shared constant, and the host rejects any attribute that is not
lowercase kebab-case: the HTML parser lowercases attribute names, so a
camelCase name would be unreadable through `dataset`.

## 8. Where it runs

```jsonc
"engines": { "vscode": "^1.96.0" },  // Node 20
"extensionKind": ["workspace", "ui"]
```

Desktop VS Code, devcontainers, Remote SSH and code-server. Not VS Code for
the Web: it cannot install from a vsix, and a corporate registry would have to
send CORS headers to `vscode.dev`.

`workspace` comes first, so in a remote window pvmp runs on the remote side
and installs land where the code is; code-server offers only that side. A
local source path therefore resolves on the remote machine, which is why
pvmp logs it.

All file access goes through `vscode.workspace.fs`, which resolves remote URIs.

## 9. Installing and updating

To install, pvmp fetches the tarball, writes the vsix to
`globalStorage/tmp/`, runs `workbench.extensions.installExtension` with its
URI and deletes the temp file. Updating an extension that is already loaded
offers a reload; a first install does not. Uninstalling always offers one.
1.x reloaded the window after every install.

**Update All** installs one extension at a time, skips any still in backoff,
and offers a single reload at the end. Each failure doubles the wait before
the next attempt (2, 4, 8 minutes and so on, capped at a day).

pvmp checks for updates on activation, on refresh, and every
`pvmp.checkInterval` seconds, and updates the badge. With `pvmp.autoUpdate`
on, the background check installs updates too.

Bookkeeping lives in `globalState`, settings hold only your choices:

```
globalState  preReleaseOptIn: ['acme.lint']
             installFailures: { 'acme.lint@1.4.0': { attempts: 2, until: <ms> } }
settings     pvmp.sources, pvmp.autoUpdate, pvmp.checkInterval, pvmp.cacheSizeMb
```

Installed versions come from `vscode.extensions.all`, whatever their origin.

## 10. IPC

Hand-written, in `packages/contract`. Both sides derive from one type:

```ts
type HostApi = {
  listCatalog(): Promise<CatalogSnapshot>;
  getDetails(extensionId: string, version?: string): Promise<ExtensionDetails>;
  getIcon(extensionId: string, version: string): Promise<string | undefined>;
  install(extensionId: string, version: string): Promise<InstallResult>;
  uninstall(extensionId: string): Promise<InstallResult>;
  refresh(): Promise<void>;
  signIn(sourceId: string): Promise<void>;
  setPreReleaseOptIn(extensionId: string, on: boolean): Promise<void>;
  openExtension(extensionId: string): Promise<void>;
  openLog(): Promise<void>;
  addLocalSource(): Promise<void>;
};

type HostEvents = {
  catalogChanged: () => void;
  installProgress: (progress: InstallProgress) => void;
  sourceError: (error: SourceError) => void;
};
```

`HostApi` is a type alias because only aliases get the implicit index
signature the generic `ApiShape` constraint needs.

Messages are `{ t: 'req' | 'res' | 'evt' }` objects. The client is a `Proxy`
that turns each call into a request with an id and a 30-second timeout. The
host builds a map of the implementation's own function properties up front,
so a method name from the webview can never reach `__proto__` or inherited
members. Every payload must survive structured clone.

The webview creates one client per document and never disposes it, because
`acquireVsCodeApi` can be called only once and StrictMode mounts twice.

## 11. Build

Vite builds both targets: the webview into `apps/extension/dist/webview/` with
fixed file names the host can reference, and the host into
`dist/extension.cjs` with `vscode` external.

`vsce package --no-dependencies` packages the bundled output; vsce cannot walk
pnpm's symlinked `node_modules`. Production builds emit no sourcemap, because
vsce's ignore rules did not keep it out of the vsix.

Archives use fflate (gzip) and nanotar (whole tarballs), plus the streaming
reader of §6.3.

## 12. Tooling

| Concern   | Tool                                                               |
| --------- | ------------------------------------------------------------------ |
| Packages  | pnpm 11                                                            |
| Types     | TypeScript 7, typecheck only; `tsconfig.node.json` and `tsconfig.web.json` |
| Lint      | oxlint 1.83.0                                                      |
| Format    | oxfmt 0.68.0                                                       |
| Tests     | Vitest, Playwright, testcontainers                                 |
| Releases  | Changesets                                                         |

The split tsconfigs keep DOM globals out of host code and Node globals out of
webview code. `contract` is checked under both.

oxlint and oxfmt are pinned to exact versions, because oxfmt is pre-1.0 and a
minor release can change formatting.

## 13. Testing

| Layer                  | Covers                                                                 |
| ---------------------- | ---------------------------------------------------------------------- |
| Vitest                 | IPC, version resolution, tarball reading, streaming abort, cache, both sources, adapters against recorded responses |
| Playwright             | Both views against a mock host: grouping, version picker, install flows, errors, empty state, sanitizer, lazy icons, visual goldens |
| Verdaccio (testcontainers) | The npm path end to end against a real registry (§4.2)             |
| Bundle smoke test      | Loads `dist/extension.cjs` with a stub `vscode`, activates it, and checks every manifest command is registered |

There are no extension-host tests (`@vscode/test-cli`); they are the slowest
and least reliable layer. The bundle smoke test catches the packaging
mistakes that would otherwise surface only after installing the vsix, but
not misuse of the VS Code API.

Integration tests start containers through testcontainers. Its Ryuk reaper
removes them when the test process dies, which `docker run --rm` would not do
for a container that never stops on its own.

### 13.1 Playwright harness

The dev harness replaces `window.acquireVsCodeApi` with a fake host that
answers over the same `postMessage` path, so the webview's IPC code runs
unchanged under test: request ids, timeouts, events and structured clone.

`?fixture=` selects a scenario (`auth`, `unreachable`, `slow-install`,
`install-fails`, `unsafe-readme`, `empty`, `many`, `no-icons`), and tests drive
the fake through `window.__pvmpMock`.

## 14. Release

```
pnpm changeset                 adds .changeset/*.md
push to main                   changesets/action opens a "Version Packages" PR
merge                          tags v2.x.y
tag                            vsce publish (Marketplace), ovsx publish (Open VSX),
                               GitHub release with the vsix
```

Only `apps/extension` publishes. The other packages are private. Open VSX
matters because VSCodium, Cursor and Windsurf cannot use the Microsoft
Marketplace. 1.x published on every push to main.

## 15. Migration

None. 2.0 does not read 1.x's settings, and an empty sidebar offers **Add
Folder Source**. The changeset tells upgraders to reconfigure `pvmp.sources`
and republish in the 2.0 format.

## 16. Settings

```jsonc
{
  "pvmp.sources": [
    { "type": "local", "path": "${userHome}/vsix", "depth": 3 },
    {
      "type": "npm",
      "id": "corp-artifactory",
      "registry": "https://art.corp/artifactory/api/npm/npm-local/",
      "adapter": "jfrog", // optional, inferred from the URL
      "scope": "@corp",
    },
  ],
  "pvmp.autoUpdate": false,
  "pvmp.checkInterval": 3600,
  "pvmp.cacheSizeMb": 200,
}
```

Array order is source priority (§4.4). A source without an `id` gets
`<type>-<index>`, which changes when you reorder the list and so forgets its
token; set `id` on any source that signs in.

## 17. Open items

1. **Remote install placement is unverified.** Nobody has run an install in a
   real devcontainer or code-server to confirm it lands on the remote side.
   Until 2026-10-01 the manifest listed `["ui", "workspace"]`, the reverse of
   §8, so earlier manual testing proves nothing. Resolve this first.
2. **JFrog and Nexus are tested only against recorded responses.** Validate
   both against real instances before announcing support.
3. **Local folders are not watched.** `LocalSource.watch()` and the host's
   `FileSystemWatcher` hook exist but nothing connects them, so a new `.tgz`
   appears after the next refresh.
4. **Relative image paths in READMEs do not load.** Only `https:` and `data:`
   images render. Serving package-relative images would mean extracting them
   into the cache.
5. **No search or filtering.** Deferred to 3.0. The catalog is already in the
   webview, so a text filter is small.
6. **oxfmt is pre-1.0.** Accepted, and pinned.
