# Publishing an extension to pvmp

pvmp distributes extensions as **npm packages that carry a `.vsix`**. npm is
only transport: the vsix stays the canonical artifact, and pvmp hands it to
VS Code untouched.

That means any registry you already run works — JFrog Artifactory, Sonatype
Nexus, Verdaccio — with no pvmp-specific server component.

There is no `pvmp` CLI. The format is small enough to produce from CI in about
twenty lines, and that is what this page is.

## The package layout

```
@corp/vsc-lint-1.4.0.tgz
└─ package/
    package.json      ← metadata, mirrored from the extension manifest
    icon.png          ← MUST come before extension.vsix
    README.md
    CHANGELOG.md
    extension.vsix    ← the real artifact
```

### File ordering matters

Metadata entries **must** precede `extension.vsix` in the tarball.

pvmp fetches icons by streaming the tarball and aborting as soon as `icon.png`
is complete. With this ordering an icon costs a few KB. Without it, pvmp has to
download the whole package — vsix included — for every row in the list.

`npm pack` preserves the order files appear in, so listing them metadata-first
in the staging directory is enough.

## package.json

Mirror the extension manifest, and add a `pvmp` block for the fields that live
only inside `extension.vsixmanifest`. pvmp never parses that file, so anything
not mirrored here is invisible to it.

```jsonc
{
  "name": "@corp/vsc-lint",
  "version": "1.4.0",
  "description": "Company lint rules with autofix.",
  "keywords": ["vscode-extension", "pvmp"],
  "categories": ["Linters", "Formatters"],
  "engines": { "vscode": "^1.96.0" },
  "repository": { "url": "https://github.com/acme/lint" },
  "homepage": "https://acme.example/lint",
  "bugs": { "url": "https://github.com/acme/lint/issues" },
  "license": "MIT",

  "pvmp": {
    "extensionId": "acme.lint",
    "displayName": "Corp Lint",
    "publisherDisplayName": "Acme Corp",
    "targetPlatform": "universal",
    "preRelease": false,
  },
}
```

| Field                       | Required    | Notes                                                       |
| --------------------------- | ----------- | ----------------------------------------------------------- |
| `name`                      | yes         | npm package name. Unrelated to the extension id.            |
| `version`                   | yes         | Must be valid semver. Should match the vsix.                |
| `engines.vscode`            | recommended | Range check. Defaults to `*`, i.e. always compatible.       |
| `categories`                | recommended | Shown on the details page.                                  |
| `pvmp.extensionId`          | **yes**     | `publisher.name`, exactly as VS Code knows it.              |
| `pvmp.displayName`          | **yes**     | Shown in the list and the details hero.                     |
| `pvmp.publisherDisplayName` | recommended | Falls back to the publisher segment of the id.              |
| `pvmp.targetPlatform`       | no          | `universal` (default) or a VS Code target like `linux-x64`. |
| `pvmp.preRelease`           | no          | Hidden unless the user opts in per extension.               |

A package with no `pvmp` block is ignored, so a registry shared with ordinary
npm packages is fine.

## Versions

One npm version per extension version. pvmp reads the whole packument, so every
published version appears in the version dropdown, ordered by semver.

Platform-specific builds are separate npm versions with different
`pvmp.targetPlatform` values. When two sources offer the same version, an exact
platform match beats `universal`, and otherwise the earlier-configured source
wins.

## Building the tarball

```bash
#!/usr/bin/env bash
set -euo pipefail

VSIX="$(ls ./*.vsix)"                       # produced by `vsce package`
OUT=pvmp-dist
rm -rf "$OUT" && mkdir -p "$OUT"

# Order matters: metadata first, vsix last.
cp package.json          "$OUT/package.json"   # then edit in the pvmp block
cp media/icon.png        "$OUT/icon.png"
cp README.md             "$OUT/README.md"
cp CHANGELOG.md          "$OUT/CHANGELOG.md"
cp "$VSIX"               "$OUT/extension.vsix"

cd "$OUT" && npm pack
```

Adding the `pvmp` block with `jq`, reading what it can from the extension's own
manifest:

```bash
jq '{
  name: ("@corp/" + .name),
  version, description, categories, license, repository, homepage, bugs,
  engines: { vscode: .engines.vscode },
  keywords: ["vscode-extension", "pvmp"],
  pvmp: {
    extensionId: (.publisher + "." + .name),
    displayName: (.displayName // .name),
    publisherDisplayName: (.publisher),
    targetPlatform: "universal",
    preRelease: false
  }
}' package.json > pvmp-dist/package.json
```

## Publishing from CI

### GitHub Actions

```yaml
- run: npx @vscode/vsce package --out extension.vsix
- run: ./scripts/build-pvmp-package.sh
- run: npm publish
  working-directory: pvmp-dist
  env:
    NODE_AUTH_TOKEN: ${{ secrets.REGISTRY_TOKEN }}
```

With an `.npmrc` written beside it:

```
@corp:registry=https://art.corp/artifactory/api/npm/npm-local/
//art.corp/artifactory/api/npm/npm-local/:_authToken=${NODE_AUTH_TOKEN}
```

### GitLab CI

```yaml
publish:
  script:
    - npx @vscode/vsce package --out extension.vsix
    - ./scripts/build-pvmp-package.sh
    - echo "//$REGISTRY_HOST/:_authToken=$REGISTRY_TOKEN" > ~/.npmrc
    - cd pvmp-dist && npm publish
```

### Jenkins

```groovy
stage('publish') {
  steps {
    sh 'npx @vscode/vsce package --out extension.vsix'
    sh './scripts/build-pvmp-package.sh'
    withCredentials([string(credentialsId: 'npm-token', variable: 'TOKEN')]) {
      sh 'echo "//art.corp/artifactory/api/npm/npm-local/:_authToken=$TOKEN" > ~/.npmrc'
      sh 'cd pvmp-dist && npm publish'
    }
  }
}
```

## Checking your package

```bash
tar -tzf @corp-vsc-lint-1.4.0.tgz
```

Expect, in this order:

```
package/package.json
package/icon.png
package/README.md
package/CHANGELOG.md
package/extension.vsix
```

If `extension.vsix` is not last, pvmp still works — it just stops being able to
fetch icons cheaply.
