/**
 * The attribute on #root that tells a details webview which extension to show.
 *
 * Both sides import it because a misspelling fails silently. The HTML parser
 * lowercases attribute names, so `data-extensionId` arrives as
 * `data-extensionid` and `dataset.extensionId` reads undefined. Only a
 * kebab-case attribute maps to a camelCase dataset key.
 */
export const ROOT_EXTENSION_ID_ATTRIBUTE = 'data-extension-id';

/** The matching `dataset` key for ROOT_EXTENSION_ID_ATTRIBUTE. */
export const ROOT_EXTENSION_ID_DATASET_KEY = 'extensionId';

/** Structural, because contract also typechecks without the DOM lib. */
export interface HasDataset {
  dataset: Record<string, string | undefined>;
}

export function readExtensionId(root: HasDataset): string | undefined {
  const value = root.dataset[ROOT_EXTENSION_ID_DATASET_KEY];
  return value !== undefined && value.length > 0 ? value : undefined;
}
