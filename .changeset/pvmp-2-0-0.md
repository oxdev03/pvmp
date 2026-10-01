---
'pvmp': major
---

pvmp 2.0 is a rewrite.

Extensions now ship as npm packages that carry a `.vsix`, so the registry you
already run (JFrog Artifactory, Sonatype Nexus or Verdaccio) serves them. A
local folder of `.tgz` packages works too.

- A webview that copies VS Code's Extensions view replaces the tree view.
- Versions compare as semver, so 1.10.0 now ranks above 1.9.0. Extensions
  that need a newer VS Code or another platform are hidden.
- pvmp offers a reload only when an update needs one, and once after Update All.
- Tokens are stored in the OS keychain. Install bookkeeping moved out of your
  synced user settings.
- Metadata and icons are cached on disk instead of re-read on every refresh.

Breaking: 1.x settings are not read. Reconfigure `pvmp.sources`, and republish
your extensions in the package format described in `docs/publishing.md`.
