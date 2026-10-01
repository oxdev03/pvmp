#!/usr/bin/env bash
# Regenerates the Playwright visual goldens inside the Playwright container,
# which renders the same pixels as CI. Goldens made on macOS would never match
# CI's fonts, so always regenerate through this script (SPEC.md §7.3).
#
#   ./scripts/update-visual-goldens.sh          # regenerate
#   ./scripts/update-visual-goldens.sh --check  # compare, change nothing
set -euo pipefail

MODE="${1:---update}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PLAYWRIGHT_VERSION="$(node -p "require('./package.json').devDependencies['@playwright/test']")"
IMAGE="mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble"
CONTAINER="pvmp-goldens-$$"

echo "==> image: ${IMAGE}"
docker pull --quiet "${IMAGE}"

cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker create --name "${CONTAINER}" -w /work "${IMAGE}" sleep infinity >/dev/null
docker start "${CONTAINER}" >/dev/null

echo "==> copying sources (excluding node_modules, dist)"
# --others --exclude-standard includes uncommitted files but not ignored ones.
git -C "${REPO_ROOT}" ls-files -z --cached --others --exclude-standard \
  | tar --null -T - -cf - -C "${REPO_ROOT}" \
  | docker cp - "${CONTAINER}:/work"

echo "==> installing"
docker exec "${CONTAINER}" bash -lc '
  corepack enable &&
  corepack prepare pnpm@11.17.0 --activate &&
  pnpm install --frozen-lockfile
'

if [[ "${MODE}" == "--check" ]]; then
  echo "==> comparing against committed goldens"
  docker exec "${CONTAINER}" bash -lc \
    'cd apps/webview && pnpm exec playwright test e2e/themes.spec.ts'
  echo "==> goldens match"
  exit 0
fi

echo "==> updating goldens"
docker exec "${CONTAINER}" bash -lc '
  cd apps/webview && pnpm exec playwright test e2e/themes.spec.ts --update-snapshots
'

echo "==> copying goldens back"
rm -rf "${REPO_ROOT}/apps/webview/e2e/__screenshots__"
docker cp "${CONTAINER}:/work/apps/webview/e2e/__screenshots__" \
  "${REPO_ROOT}/apps/webview/e2e/__screenshots__"

echo "==> done"
ls -1 "${REPO_ROOT}/apps/webview/e2e/__screenshots__" 2>/dev/null || true
