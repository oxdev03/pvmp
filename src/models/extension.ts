/**
 * Represents an extension in Visual Studio Code.
 */
export class Extension {
  /**
   * The unique identifier of the extension.
   */
  id: string = '';

  /**
   * The name of the extension.
   */
  name: string = '';

  /**
   * The path to the extension on the file system.
   */
  extensionPath: string = '';

  /**
   * Information about the identity of the extension.
   */
  identity: Identity = new Identity();

  /**
   * Metadata information about the extension.
   */
  metadata: Metadata = new Metadata();

  /**
   * Assets associated with the extension, such as images, readme files, and changelogs.
   */
  assets: Assets = new Assets();

  /**
   * Links to external resources related to the extension.
   */
  links: Links = new Links();
}

/**
 * Represents the identity information of an extension.
 */
export class Identity {
  /**
   * The version of the extension.
   */
  version: string = '';

  /**
   * The target environment for the extension (default is 'any').
   */
  target: string = 'any';

  /**
   * The compatible engine version of Visual Studio Code (default is '*').
   */
  engine: string = '*';

  /**
   * Indicates whether the extension is a pre-release version.
   */
  preRelease: boolean = false;

  /**
   * Indicates whether the extension is a preview version.
   */
  preview: boolean = false;
}

/**
 * Represents metadata information about an extension.
 */
export class Metadata {
  /**
   * The unique identifier of the extension.
   */
  identifier: string = '';

  /**
   * The language of the extension (default is 'en-US').
   */
  language: string = 'en-US';

  /**
   * A description of the extension.
   */
  description: string = '';

  /**
   * The publisher of the extension.
   */
  publisher: string = '';

  /**
   * Categories that the extension belongs to.
   */
  categories: string[] = [];

  /**
   * The date when the extension was published.
   */
  publishedAt: Date = new Date();
}

/**
 * Represents assets associated with an extension.
 */
export class Assets {
  /**
   * The path to the image asset for the extension.
   */
  image: string = '';

  /**
   * The path to the readme file for the extension.
   */
  readme: string = '';

  /**
   * The path to the changelog file for the extension.
   */
  changelog: string = '';
}

/**
 * Represents links to external resources related to an extension.
 */
export class Links {
  /**
   * The link to get started with the extension.
   */
  getStarted: string = '';

  /**
   * The link to the repository of the extension.
   */
  repository: string = '';

  /**
   * The link to support resources for the extension.
   */
  support: string = '';

  /**
   * The link to learning resources for the extension.
   */
  learn: string = '';
}
