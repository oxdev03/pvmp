---
'pvmp': major
---

pvmp 2.0: complete rewrite.

Extensions are now distributed as npm packages carrying a `.vsix`, so any
registry you already run works as the transport — JFrog Artifactory, Sonatype
Nexus, Verdaccio — alongside a local folder of `.tgz` packages.

- React webview UI cloning VS Code's Extensions view, replacing the tree view
- Correct semver ordering, `engines.vscode` range checks and target-platform
  filtering; 1.x compared versions as strings, so 1.10.0 ranked below 1.9.0
- Reload is offered only when one is required, not after every install
- Tokens live in SecretStorage, and scratch state in globalState; 1.x wrote
  its failed-update list into synced user settings
- Metadata and icons are cached on disk instead of re-unzipped on every refresh

Breaking: 1.x settings are not read. Reconfigure `pvmp.sources`, and republish
extensions in the pvmp package format — see `docs/publishing.md`.
