import { JFROG_MARKER, jfrogAdapter } from './jfrog.ts';
import { NEXUS_MARKER, nexusAdapter } from './nexus.ts';
import type { CatalogAdapter } from './types.ts';
import { verdaccioAdapter } from './verdaccio.ts';

export * from './types.ts';
export { jfrogAdapter } from './jfrog.ts';
export { nexusAdapter } from './nexus.ts';
export { verdaccioAdapter } from './verdaccio.ts';

export const CATALOG_ADAPTERS: Record<string, CatalogAdapter> = {
  [verdaccioAdapter.id]: verdaccioAdapter,
  [jfrogAdapter.id]: jfrogAdapter,
  [nexusAdapter.id]: nexusAdapter,
};

/**
 * Guesses the adapter from the registry URL shape.
 *
 * Only a convenience: `adapter` in settings always wins, and an unrecognised
 * URL is a config error rather than a silent default, because picking the
 * wrong listing API produces an empty catalog with no visible cause.
 */
export function detectAdapter(registry: string): CatalogAdapter | undefined {
  if (registry.includes(JFROG_MARKER)) return jfrogAdapter;
  if (registry.includes(NEXUS_MARKER)) return nexusAdapter;
  return undefined;
}
