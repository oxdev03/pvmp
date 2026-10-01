# Private Marketplace

**A private extension marketplace for VS Code, served from the npm registry you
already run.**

Publish your organisation's extensions to JFrog Artifactory, Sonatype Nexus or
Verdaccio as ordinary npm packages, or drop them in a folder. Developers then
browse, install and update them from a view that looks and behaves like VS
Code's own Extensions view. pvmp needs no server of its own.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/images/overview-light.png">
  <img alt="The Private Marketplace view in VS Code: a sidebar grouping extensions into Updates Available, Installed and Available, next to the details page for Corp Lint with its README, version picker and install button." src="docs/images/overview-dark.png">
</picture>

<sub>Real screenshots of the packaged extension running in VS Code 1.139, not
mock-ups. Regenerate them with <code>pnpm screenshots</code>.</sub>

## Why

The public Marketplace is off-limits in many companies, and internal extensions
need a home either way. Passing `.vsix` files around by hand doesn't scale, and
a dedicated marketplace server is one more service to run and secure.

pvmp instead treats **an npm package carrying a `.vsix`** as the unit of
distribution. You get the registry's existing auth, retention, proxying and
audit trail for free. One packument request returns every version's metadata,
so the catalog loads without downloading a single extension.

## Features

- **A faithful copy of the Extensions view.** Rows, details page, tabs and
  buttons use VS Code's own metrics and theme colours, so it is right in every
  theme, high contrast included.
- **Updates, not just installs.** Outdated extensions are grouped and counted
  on the activity-bar badge. You can update them one at a time or all at once,
  and opt into automatic updates. A failing update backs off instead of
  retrying on every check.
- **Several sources, in priority order.** When two sources offer the same
  version, the first one listed wins. The others stay visible on the details
  page as shadowed entries.
- **Version-aware.** pvmp hides builds for other platforms and versions that
  need a newer VS Code. Pre-releases are opt-in per extension.
- **One source failing leaves the rest working.** Each failure gets its own
  banner. Auth failures come with a one-click sign-in.
- **Credentials stay out of settings.** Tokens live in the OS keychain through
  VS Code's SecretStorage, and userinfo in a registry URL is redacted from logs
  and errors.
- **Runs remotely too.** In a devcontainer, over SSH or in code-server, pvmp
  runs on the remote side, so extensions install where your code is.

<img align="right" width="300" alt="The sidebar with a warning banner reporting that the corp-verdaccio source could not be reached, while extensions from the other source are still listed." src="docs/images/source-error.png">

### When a source fails

A registry that is down, misconfigured or asking for a token gets its own
banner. Every other source keeps working.

Each banner links to the log. **Private Marketplace: Show Log** opens a
`LogOutputChannel`, so you can raise it to _Trace_ from the Output panel and
see every request without reloading.

<br clear="right">

## Getting started

1. Install **Private Marketplace** from the VS Code Marketplace or Open VSX, or
   install a `.vsix` from [Releases](https://github.com/oxdev03/pvmp/releases).
2. Open **Private Marketplace** in the activity bar.
3. Add a source. Click the folder button for a local directory, or edit
   `pvmp.sources` in settings:

```jsonc
{
  "pvmp.sources": [
    // A folder of .tgz packages, for air-gapped machines or quick trials.
    { "type": "local", "path": "${userHome}/vsix" },

    // Any npm registry. The adapter lists the catalog; the rest is plain npm.
    {
      "type": "npm",
      "id": "corp",
      "registry": "https://art.corp/artifactory/api/npm/npm-local/",
      "scope": "@corp",
    },
  ],
}
```

4. If the registry needs auth, run **Private Marketplace: Sign in to Source**
   and paste a token.

## Sources

| `type`  | Reads from                         | Notes                                        |
| ------- | ---------------------------------- | -------------------------------------------- |
| `local` | A directory of `.tgz` packages     | `depth` (default `3`) bounds the scan.       |
| `npm`   | Any npm registry, via an `adapter` | `scope` limits the catalog to one npm scope. |

npm has no portable way to list a registry's packages, so an adapter does only
that one job. Everything else (packuments, tarballs, auth) is plain npm.

| `adapter`   | Lists packages with                      | Inferred from a registry URL containing |
| ----------- | ---------------------------------------- | --------------------------------------- |
| `jfrog`     | `GET /api/storage/<repo>?list&deep=1`    | `/api/npm/`                             |
| `nexus`     | `GET /service/rest/v1/components`        | `/repository/`                          |
| `verdaccio` | `/-/all`, falling back to `/-/v1/search` | never; set it explicitly                |

`repo` and `baseUrl` override what the adapter derives from `registry`, for
installs behind a reverse proxy with a different layout.

Path settings accept `${userHome}`, `${workspaceFolder}` and `${env:NAME}`. In
a remote window they resolve on the remote machine, and the resolved path is
written to the log.

## Publishing an extension

An extension package is an npm tarball with the `.vsix` inside and the metadata
in front of it:

```
package/
  package.json     ← your extension manifest's fields, plus a "pvmp" block
  icon.png         ← before the vsix, so icons stream in a few KB
  README.md
  CHANGELOG.md
  extension.vsix   ← the real artifact, handed to VS Code untouched
```

[`docs/publishing.md`](docs/publishing.md) has the full format, a twenty-line
build script, and CI examples for GitHub Actions, GitLab and Jenkins. There is
no pvmp CLI to install.

## Reference

### Commands

| Command                                    | What it does                                           |
| ------------------------------------------ | ------------------------------------------------------ |
| Private Marketplace: Refresh Sources       | Re-read every source now.                              |
| Private Marketplace: Update All Extensions | Install every available update, then offer one reload. |
| Private Marketplace: Add Folder Source     | Pick folders and append them to `pvmp.sources`.        |
| Private Marketplace: Sign in to Source     | Store a token for a source in the OS keychain.         |
| Private Marketplace: Show Log              | Open the output channel.                               |
| Private Marketplace: Open Settings         | Jump to pvmp's settings.                               |

### Settings

| Setting              | Default | What it does                                          |
| -------------------- | ------- | ----------------------------------------------------- |
| `pvmp.sources`       | `[]`    | Where extensions come from, in priority order.        |
| `pvmp.autoUpdate`    | `false` | Install updates during the background check.          |
| `pvmp.checkInterval` | `3600`  | Seconds between background checks. `0` disables them. |
| `pvmp.cacheSizeMb`   | `200`   | Cap on the metadata and icon cache.                   |

### Requirements and limits

- VS Code 1.96 or later on desktop, including devcontainers, Remote SSH and
  code-server.
- **Not VS Code for the Web.** It cannot install from a `.vsix`, and a corporate
  registry would have to serve CORS headers to `vscode.dev`.
- No search or filtering yet. Both are planned for 3.0.

## Status

2.0 is a ground-up rewrite. It shares no code with 1.x and does not read 1.x
settings. The design and its reasoning are in [`SPEC.md`](SPEC.md).

Before 2.0 is released, two things still need proving against real
infrastructure:

- The **JFrog and Nexus adapters** are tested against recorded API responses
  only. Verdaccio has a live container test. Reports from real instances are
  very welcome.
- **Install placement in remote windows** has not yet been confirmed in a real
  devcontainer and code-server.

## Development

Requires Node 20.19+ and pnpm 11. Docker (or Podman) is needed for the integration
tests and the screenshots.

```bash
pnpm install
pnpm dev               # the webview alone, against a mocked host
pnpm check             # lint, format and typecheck
pnpm test              # unit tests
pnpm e2e               # Playwright against the webview (pixel checks skip off Linux)
pnpm test:integration  # live Verdaccio via testcontainers
pnpm package           # build pvmp.vsix
pnpm screenshots       # regenerate the README images in code-server
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host. Run
`pnpm samples` first: it writes example packages and a `dev-workspace` that is
already configured to use them.

`pnpm dev` serves the webview at <http://localhost:5183> with no VS Code
involved, for example `/?view=details&ext=acme.lint&theme=hc`. Fixtures cover
the states that are awkward to reproduce: `auth`, `unreachable`,
`slow-install`, `install-fails`, `unsafe-readme`, `empty` and `many`.

```
apps/
  extension/      The VS Code host. Its package.json is the extension manifest.
  webview/        React and Vite: the sidebar and details views.
packages/
  contract/       Typed IPC and domain types. No runtime dependencies.
  core/           Version resolution, tarball reading, cache, source interfaces.
  source-local/   A folder of .tgz packages.
  source-npm/     Any npm registry, plus one catalog adapter per vendor.
```

`core` never imports `vscode`. Everything it touches is injected, so
resolution, caching and parsing are tested in plain Vitest.

Visual goldens are generated in the same Playwright container CI uses, because
macOS and Linux rasterise fonts too differently to compare:
`apps/webview/scripts/update-visual-goldens.sh` (add `--check` to verify).

## Licence

MIT. Layout metrics are taken from
[microsoft/vscode](https://github.com/microsoft/vscode) (MIT). The theme token
generator replaces the archived
[`@githubocto/tailwind-vscode`](https://github.com/githubocto/tailwind-vscode)
(MIT).
