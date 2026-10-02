# Publishing an extension

pvmp installs extensions from npm packages that contain the `.vsix`. Publish
one to your registry (JFrog Artifactory, Sonatype Nexus, Verdaccio) and every
pvmp user pointed at it can install it. pvmp hands the `.vsix` to VS Code
unchanged.

There is no pvmp CLI. A package takes one short script to build, shown below.

## The package

```
@corp/vsc-lint-1.4.0.tgz
└─ package/
    package.json      metadata from the extension manifest, plus a "pvmp" block
    CHANGELOG.md
    README.md
    icon.png
    extension.vsix    the extension itself, last
```

`extension.vsix` must come after the metadata files. pvmp reads icons by
streaming the tarball and stopping once `icon.png` is complete, so with this
order an icon costs a few KB. If the vsix comes first, pvmp downloads the whole
package for each row in the list.

`npm pack` sorts entries by file extension and puts `package.json` first, which
gives this order on its own. Check the result with `tar -tzf` (see
[Checking a package](#checking-a-package)).

## package.json

Copy the fields from your extension's manifest and add a `pvmp` block. pvmp
never opens `extension.vsixmanifest`, so it only knows what you put here.

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

| Field                       | Required    | Notes                                                           |
| --------------------------- | ----------- | --------------------------------------------------------------- |
| `name`                      | yes         | The npm package name. It need not match the extension id.       |
| `version`                   | yes         | Valid semver, the same as the vsix.                             |
| `engines.vscode`            | recommended | Hides the version from older VS Code. Defaults to `*`.          |
| `categories`                | recommended | Shown on the details page.                                      |
| `pvmp.extensionId`          | **yes**     | `publisher.name` as VS Code knows it. Case does not matter.     |
| `pvmp.displayName`          | **yes**     | Shown in the list and on the details page.                      |
| `pvmp.publisherDisplayName` | recommended | Defaults to the publisher part of the id.                       |
| `pvmp.targetPlatform`       | no          | `universal` (the default) or a VS Code target like `linux-x64`. |
| `pvmp.preRelease`           | no          | Hidden until a user opts in for this extension.                 |

pvmp ignores packages without a `pvmp` block, so you can share a registry with
ordinary npm packages.

## Versions

Publish one npm version per extension version. pvmp reads every published
version and lists them in semver order in the details page's version picker.

For platform-specific builds, publish a separate npm version for each build
with its own `pvmp.targetPlatform`. If two sources offer the same version, a
build for the user's exact platform beats `universal`, and after that the
source listed first in `pvmp.sources` wins.

## Building the package

Save this as `scripts/build-pvmp-package.sh` in the extension's repository. It
expects the `.vsix` from `vsce package` in the working directory.

```bash
#!/usr/bin/env bash
set -euo pipefail

OUT=pvmp-dist
rm -rf "$OUT" && mkdir -p "$OUT"

jq '{
  name: ("@corp/" + .name),
  version, description, categories, license, repository, homepage, bugs,
  engines: { vscode: .engines.vscode },
  keywords: ["vscode-extension", "pvmp"],
  pvmp: {
    extensionId: (.publisher + "." + .name),
    displayName: (.displayName // .name),
    publisherDisplayName: .publisher,
    targetPlatform: "universal",
    preRelease: false
  }
} | with_entries(select(.value != null))' package.json > "$OUT/package.json"

cp media/icon.png "$OUT/icon.png"
cp README.md CHANGELOG.md "$OUT/"
cp ./*.vsix "$OUT/extension.vsix"

cd "$OUT" && npm pack
```

Change the `@corp/` scope and the icon path to match your repository.

## Publishing from CI

Each example runs `vsce package`, builds the package with the script above, and
publishes it with `npm publish`.

### GitHub Actions

```yaml
- run: npx @vscode/vsce package --out extension.vsix
- run: ./scripts/build-pvmp-package.sh
- run: npm publish
  working-directory: pvmp-dist
  env:
    NODE_AUTH_TOKEN: ${{ secrets.REGISTRY_TOKEN }}
```

Write an `.npmrc` next to the package that points the scope at your registry:

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

## Checking a package

```bash
tar -tzf corp-vsc-lint-1.4.0.tgz
```

`npm pack` 12 produces:

```
package/package.json
package/CHANGELOG.md
package/README.md
package/icon.png
package/extension.vsix
```

`package.json` must be present and `extension.vsix` should be last. Any other
order still installs, but every icon then costs a full download.
