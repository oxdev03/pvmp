/**
 * How the host tells a webview document which extension it is showing.
 *
 * It lives in the contract because both sides must agree on the exact
 * spelling, and getting it wrong fails silently: the HTML parser lowercases
 * attribute names, so a camelCase `data-extensionId` becomes
 * `data-extensionid` and `dataset.extensionId` reads back undefined. Only a
 * kebab-case attribute maps to a camelCase dataset key.
 */
export const ROOT_EXTENSION_ID_ATTRIBUTE = 'data-extension-id';

/** The matching `dataset` key for ROOT_EXTENSION_ID_ATTRIBUTE. */
export const ROOT_EXTENSION_ID_DATASET_KEY = 'extensionId';

/** Structural, not DOMStringMap: contract is typechecked for node too. */
export interface HasDataset {
  dataset: Record<string, string | undefined>;
}

export function readExtensionId(root: HasDataset): string | undefined {
  const value = root.dataset[ROOT_EXTENSION_ID_DATASET_KEY];
  return value !== undefined && value.length > 0 ? value : undefined;
}
