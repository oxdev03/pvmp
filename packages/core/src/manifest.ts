import type { ExtensionLinks, ExtensionVersion, TargetPlatform } from '@pvmp/contract';

import { ManifestError } from './errors.ts';
import { isTargetPlatform } from './platform.ts';

/** The published `package.json` of a pvmp-format npm package (SPEC.md §2). */
export interface PvmpPackageJson {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  keywords?: unknown;
  categories?: unknown;
  engines?: unknown;
  repository?: unknown;
  homepage?: unknown;
  bugs?: unknown;
  license?: unknown;
  pvmp?: unknown;
}

export interface ManifestContext {
  sourceId: string;
  /** Opaque string the owning source uses to fetch this package's bytes. */
  locator: string;
  /** ISO 8601 publish time, when the source can determine one. */
  publishedAt?: string;
}

const EXTENSION_ID = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i;

/** The value if it is a non-empty string, otherwise undefined. */
export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** `{ url }` objects and bare strings both appear in the wild. */
function urlish(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  return nonEmptyString(record(value)?.['url']);
}

/**
 * Validates and converts a published package.json into an ExtensionVersion.
 *
 * The input comes from a registry, so every field is checked. Throws
 * ManifestError when the package does not follow the pvmp format.
 */
export function toExtensionVersion(raw: PvmpPackageJson, ctx: ManifestContext): ExtensionVersion {
  const packageName = nonEmptyString(raw.name);
  if (!packageName) throw new ManifestError(ctx.locator, 'package.json has no "name"');

  const version = nonEmptyString(raw.version);
  if (!version) throw new ManifestError(ctx.locator, 'package.json has no "version"');

  const pvmp = record(raw.pvmp);
  if (!pvmp) {
    throw new ManifestError(ctx.locator, 'package.json has no "pvmp" block; not a pvmp package');
  }

  const rawId = nonEmptyString(pvmp['extensionId']);
  if (!rawId) throw new ManifestError(ctx.locator, 'pvmp.extensionId is missing');
  if (!EXTENSION_ID.test(rawId)) {
    throw new ManifestError(ctx.locator, `pvmp.extensionId "${rawId}" is not publisher.name`);
  }
  // VS Code compares ids case-insensitively, so pvmp keys everything by the
  // lowercase form (SPEC.md §2).
  const extensionId = rawId.toLowerCase();

  const rawTarget = nonEmptyString(pvmp['targetPlatform']) ?? 'universal';
  if (!isTargetPlatform(rawTarget)) {
    throw new ManifestError(
      ctx.locator,
      `pvmp.targetPlatform "${rawTarget}" is not a known platform`,
    );
  }
  const targetPlatform: TargetPlatform = rawTarget;

  const publisher = rawId.slice(0, rawId.indexOf('.'));
  const engines = record(raw.engines);

  return {
    extensionId,
    packageName,
    version,
    targetPlatform,
    preRelease: pvmp['preRelease'] === true,
    engine: nonEmptyString(engines?.['vscode']) ?? '*',
    displayName: nonEmptyString(pvmp['displayName']) ?? extensionId,
    publisher,
    publisherDisplayName: nonEmptyString(pvmp['publisherDisplayName']) ?? publisher,
    description: nonEmptyString(raw.description) ?? '',
    categories: strArray(raw.categories),
    sourceId: ctx.sourceId,
    locator: ctx.locator,
    ...(ctx.publishedAt ? { publishedAt: ctx.publishedAt } : {}),
  };
}

export function toExtensionLinks(raw: PvmpPackageJson): ExtensionLinks {
  const repository = urlish(raw.repository);
  const homepage = nonEmptyString(raw.homepage);
  const bugs = urlish(raw.bugs);
  const license = nonEmptyString(raw.license);
  return {
    ...(repository ? { repository } : {}),
    ...(homepage ? { homepage } : {}),
    ...(bugs ? { bugs } : {}),
    ...(license ? { license } : {}),
  };
}
