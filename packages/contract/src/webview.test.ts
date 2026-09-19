import { describe, expect, it } from 'vitest';

import {
  readExtensionId,
  ROOT_EXTENSION_ID_ATTRIBUTE,
  ROOT_EXTENSION_ID_DATASET_KEY,
} from './webview.ts';

describe('root extension id attribute', () => {
  /*
   * This pairing is the whole point of the constants.
   *
   * The HTML parser lowercases attribute names, and `dataset` only maps
   * kebab-case back to camelCase. A camelCase attribute therefore round-trips
   * to a key nobody reads, with no error anywhere — which is exactly how the
   * details panel shipped broken once.
   */
  it('is lowercase kebab-case, which is what dataset can read back', () => {
    expect(ROOT_EXTENSION_ID_ATTRIBUTE).toBe(ROOT_EXTENSION_ID_ATTRIBUTE.toLowerCase());
    expect(ROOT_EXTENSION_ID_ATTRIBUTE).toMatch(/^data-[a-z0-9-]+$/);
  });

  it('names the dataset key the attribute actually produces', () => {
    const derived = ROOT_EXTENSION_ID_ATTRIBUTE.slice('data-'.length).replaceAll(
      /-([a-z])/g,
      (_match, letter: string) => letter.toUpperCase(),
    );
    expect(derived).toBe(ROOT_EXTENSION_ID_DATASET_KEY);
  });
});

describe('readExtensionId', () => {
  it('reads the id the host stamped', () => {
    expect(readExtensionId({ dataset: { extensionId: 'acme.lint' } })).toBe('acme.lint');
  });

  it('returns undefined when the attribute is absent', () => {
    expect(readExtensionId({ dataset: {} })).toBeUndefined();
  });

  it('treats an empty value as absent, not as extension ""', () => {
    expect(readExtensionId({ dataset: { extensionId: '' } })).toBeUndefined();
  });

  it('does not read a lowercased camelCase attribute', () => {
    // What `data-extensionId` actually becomes after parsing.
    expect(readExtensionId({ dataset: { extensionid: 'acme.lint' } })).toBeUndefined();
  });
});
