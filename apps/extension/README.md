# Private Marketplace

Install and update your organisation's extensions from the npm registry you
already run (JFrog Artifactory, Sonatype Nexus or Verdaccio), or from a folder
of packages.

![The Private Marketplace sidebar next to the details page for an extension](https://github.com/oxdev03/pvmp/raw/HEAD/docs/images/overview-dark.png)

## Getting started

1. Open **Private Marketplace** in the activity bar.
2. Click the folder button to add a directory of `.tgz` packages, or add a
   registry to `pvmp.sources` in your settings:

   ```jsonc
   "pvmp.sources": [
     {
       "type": "npm",
       "registry": "https://art.corp/artifactory/api/npm/npm-local/",
       "scope": "@corp"
     }
   ]
   ```

3. If the registry needs a token, run **Private Marketplace: Sign in to
   Source**. For Nexus, enter `username:password` instead. pvmp keeps both
   in the OS keychain.

Outdated extensions appear under **Updates Available** and on the activity-bar
badge. **Private Marketplace: Update All Extensions** installs them all and
then offers a single reload.

## Publishing

Each extension is an npm package containing its `.vsix`. The
[publishing guide](https://github.com/oxdev03/pvmp/blob/HEAD/docs/publishing.md)
has the package format, a build script and CI examples.

## Requirements

VS Code 1.96 or later, on desktop or in a devcontainer, over Remote SSH or in
code-server. VS Code for the Web is not supported.

Documentation, settings and source code:
[github.com/oxdev03/pvmp](https://github.com/oxdev03/pvmp).
