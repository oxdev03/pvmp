import type { CatalogEntry, EntryStatus, ExtensionVersion, TargetPlatform } from '@pvmp/contract';
import semver from 'semver';

import { isPlatformCompatible } from './platform.ts';

export interface ResolveContext {
  /** e.g. `1.98.2`, or `1.99.0-insider` on Insiders builds. */
  vscodeVersion: string;
  targetPlatform: TargetPlatform;
  /** Extension ids the user has opted into pre-releases for. */
  preReleaseOptIn: ReadonlySet<string>;
}

export interface InstalledExtension {
  extensionId: string;
  version: string;
}

/** `semver.satisfies` with the insider-suffix and wildcard cases handled. */
export function satisfiesEngine(vscodeVersion: string, range: string): boolean {
  if (range === '*' || range === '') return true;
  const version = semver.valid(vscodeVersion) ?? semver.coerce(vscodeVersion)?.version;
  if (!version) return false;
  // includePrerelease so `1.99.0-insider` still matches `^1.96.0`.
  return semver.satisfies(version, range, { includePrerelease: true, loose: true });
}

export function isInstallable(version: ExtensionVersion, ctx: ResolveContext): boolean {
  if (!semver.valid(version.version)) return false;
  if (!isPlatformCompatible(version.targetPlatform, ctx.targetPlatform)) return false;
  if (!satisfiesEngine(ctx.vscodeVersion, version.engine)) return false;
  if (version.preRelease && !ctx.preReleaseOptIn.has(version.extensionId)) return false;
  return true;
}

/**
 * Picks the winner when several sources offer the same extension at the same
 * version: an exact platform build beats a universal one, and otherwise the
 * earlier-configured source wins. Returns true when `challenger` should replace
 * `holder`.
 */
function beats(
  challenger: ExtensionVersion,
  holder: ExtensionVersion,
  ctx: ResolveContext,
  priority: ReadonlyMap<string, number>,
): boolean {
  const exact = (v: ExtensionVersion) => (v.targetPlatform === ctx.targetPlatform ? 0 : 1);
  if (exact(challenger) !== exact(holder)) return exact(challenger) < exact(holder);

  const rank = (v: ExtensionVersion) => priority.get(v.sourceId) ?? Number.MAX_SAFE_INTEGER;
  return rank(challenger) < rank(holder);
}

/**
 * Filters to versions installable on this host and sorts them newest-first,
 * collapsing duplicates offered by more than one source. Losers are returned
 * too, flagged `shadowed`, so the details page can show provenance.
 */
export function resolveVersions(
  versions: readonly ExtensionVersion[],
  ctx: ResolveContext,
  sourcePriority: readonly string[] = [],
): ExtensionVersion[] {
  const priority = new Map(sourcePriority.map((id, index) => [id, index]));
  const winners = new Map<string, ExtensionVersion>();
  const losers: ExtensionVersion[] = [];

  for (const version of versions) {
    if (!isInstallable(version, ctx)) continue;
    const key = `${version.extensionId}@${version.version}`;
    const holder = winners.get(key);
    if (!holder) {
      winners.set(key, version);
    } else if (beats(version, holder, ctx, priority)) {
      winners.set(key, version);
      losers.push({ ...holder, shadowed: true });
    } else {
      losers.push({ ...version, shadowed: true });
    }
  }

  return [...winners.values(), ...losers].toSorted((a, b) => {
    const order = semver.rcompare(a.version, b.version);
    // Shadowed duplicates sort directly after the version that beat them.
    return order !== 0 ? order : Number(a.shadowed ?? false) - Number(b.shadowed ?? false);
  });
}

function statusOf(
  latest: ExtensionVersion | undefined,
  installedVersion: string | undefined,
): EntryStatus {
  if (!installedVersion) return 'available';
  if (latest && semver.valid(installedVersion) && semver.gt(latest.version, installedVersion)) {
    return 'update-available';
  }
  return 'installed';
}

/**
 * Merges every source's versions into one entry per extension id.
 *
 * An extension is listed when a source offers an installable version of it,
 * or when it is installed. An installed extension with no compatible version
 * stays listed so you can uninstall it.
 */
export function buildCatalog(
  versions: readonly ExtensionVersion[],
  installed: readonly InstalledExtension[],
  ctx: ResolveContext,
  sourcePriority: readonly string[] = [],
): CatalogEntry[] {
  const byExtension = new Map<string, ExtensionVersion[]>();
  for (const version of versions) {
    const list = byExtension.get(version.extensionId);
    if (list) list.push(version);
    else byExtension.set(version.extensionId, [version]);
  }

  // VS Code reports the manifest's casing, `Acme.lint`; catalog ids are lowercase.
  const installedBy = new Map(installed.map((e) => [e.extensionId.toLowerCase(), e.version]));
  const entries: CatalogEntry[] = [];

  for (const [extensionId, all] of byExtension) {
    const resolved = resolveVersions(all, ctx, sourcePriority);
    const installedVersion = installedBy.get(extensionId);
    if (resolved.length === 0 && installedVersion === undefined) continue;

    const latest = resolved.find((v) => !v.shadowed);
    // Fall back to any known version so an entry that is only installed still
    // has a name and publisher to render.
    const display = latest ?? resolved[0] ?? all[0];
    if (!display) continue;

    entries.push({
      extensionId,
      displayName: display.displayName,
      publisher: display.publisher,
      publisherDisplayName: display.publisherDisplayName,
      description: display.description,
      categories: display.categories,
      versions: resolved,
      ...(latest ? { latest } : {}),
      ...(installedVersion === undefined
        ? {}
        : {
            installed: {
              version: installedVersion,
              external: !all.some((v) => v.version === installedVersion),
            },
          }),
      status: statusOf(latest, installedVersion),
      preReleaseOptIn: ctx.preReleaseOptIn.has(extensionId),
    });
  }

  return entries.toSorted((a, b) =>
    a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' }),
  );
}
