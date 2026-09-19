# Private Marketplace (pvmp)

A private extension marketplace for VS Code, for organisations that cannot use
the public gallery.

Extensions are distributed as **npm packages carrying a `.vsix`**, so whichever
registry you already run is the transport — JFrog Artifactory, Sonatype Nexus,
Verdaccio — or a plain folder of `.tgz` files for air-gapped machines. There is
no pvmp server component.

The UI is a 1:1 clone of VS Code's own Extensions view, built from VS Code's
MIT-licensed CSS rather than approximated.

> **2.0 is a complete rewrite.** It shares no code with 1.x and does not read
> 1.x settings. See [`SPEC.md`](SPEC.md) for the design and the reasoning.

## Using it

1. Install the extension.
2. Open **Private Marketplace** in the activity bar.
3. Add a source — the folder button, or `pvmp.sources` in settings:

```jsonc
{
  "pvmp.sources": [
    { "type": "local", "path": "${userHome}/vsix", "depth": 3 },
    {
      "type": "npm",
      "id": "corp-artifactory",
      "registry": "https://art.corp/artifactory/api/npm/npm-local/",
      "adapter": "jfrog",
      "scope": "@corp",
    },
  ],
}
```

Array order is priority: when two sources offer the same version, the earlier
one wins.

4. For a registry that needs auth, run **Private Marketplace: Sign in to
   Source**. Tokens go to the OS keychain via SecretStorage, never to settings.

Publishing extensions is documented in [`docs/publishing.md`](docs/publishing.md).

### Settings

| Setting              | Default | What it does                                   |
| -------------------- | ------- | ---------------------------------------------- |
| `pvmp.sources`       | `[]`    | Where extensions come from, in priority order. |
| `pvmp.autoUpdate`    | `false` | Install updates during the background check.   |
| `pvmp.checkInterval` | `3600`  | Seconds between checks. `0` disables them.     |
| `pvmp.cacheSizeMb`   | `200`   | Cap on the metadata and icon cache.            |

### Where it runs

`extensionKind` is `["workspace", "ui"]`, so in a devcontainer, over SSH or in
code-server pvmp runs on the remote side and installs land where you actually
write code. A `local` source path therefore resolves against that machine; the
resolved path is written to the log so it is never a mystery.

VS Code for the Web is not supported: it cannot install from a vsix, and a
corporate registry would have to serve CORS headers for `vscode.dev`.

## Development

```bash
pnpm install
pnpm dev              # webview standalone, with a mocked host
pnpm check            # lint + format + typecheck
pnpm test             # unit tests
pnpm e2e              # webview e2e (visual assertions skip off Linux)
pnpm test:integration # Verdaccio (testcontainers) + bundle smoke test
pnpm package          # build and produce pvmp.vsix
```

`pnpm dev` serves the webview at <http://localhost:5183> against fixture data,
with no VS Code involved:

```
/?view=sidebar&fixture=auth&theme=light
/?view=details&ext=acme.lint&theme=hc
```

Fixtures: `default`, `empty`, `auth`, `unreachable`, `slow-install`,
`install-fails`, `no-icons`, `unsafe-readme`, `many`.

### Layout

```
apps/
  extension/      VS Code host. Its package.json is the extension manifest.
  webview/        React, Vite, two entry points sharing one component set.
packages/
  contract/       IPC + domain types. Zero runtime dependencies.
  core/           Resolution, tarball reading, cache, source interfaces.
  source-local/   A folder of .tgz packages.
  source-npm/     Any npm registry, plus one adapter per vendor.
tooling/          Shared tsconfig.
```

Internal packages are source-only: their `exports` point straight at
`src/index.ts`, so only the two apps build and there is no project-reference
graph or declaration emit to keep in step.

`core` imports `vscode` nowhere. It takes an injected `FileStore`, which is
what lets the resolution, caching and parsing logic be tested in plain Vitest.

### Regenerating derived files

```bash
# Tailwind tokens from the current VS Code theme colour reference
node apps/webview/scripts/generate-vscode-theme.mjs

# Visual goldens, in the same container CI uses
apps/webview/scripts/update-visual-goldens.sh          # regenerate
apps/webview/scripts/update-visual-goldens.sh --check  # verify
```

Goldens are generated in a container because macOS and Linux rasterise fonts
far beyond any useful pixel threshold. The pixel assertions skip off Linux.

`pnpm test:integration` needs a container runtime. It is probed through
testcontainers, so Docker, Podman and a remote `DOCKER_HOST` all work, and the
suite skips rather than fails when none is present.

## Licence

MIT. The VS Code metrics in `apps/webview/src/components/metrics.ts` are taken
from [microsoft/vscode](https://github.com/microsoft/vscode) (MIT), and the
Tailwind theme generator replaces the archived
[`@githubocto/tailwind-vscode`](https://github.com/githubocto/tailwind-vscode)
(MIT).
