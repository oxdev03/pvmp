export class Extension {
  id: string = '';
  name: string = '';
  extensionPath: string = '';
  identity: Identity = new Identity();
  metadata: Metadata = new Metadata();
  assets: Assets = new Assets();
  links: Links = new Links();
}

export class Identity {
  version: string = '';
  target: string = 'any';
  engine: string = '*';
  preRelease: boolean = false;
  preview: boolean = false;
}

export class Metadata {
  identifier: string = '';
  language: string = 'en-US';
  description: string = '';
  publisher: string = '';
  categories: string[] = [];
  publishedAt: Date = new Date();
}

export class Assets {
  image: string = '';
  readme: string = '';
  changelog: string = '';
}

export class Links {
  getStarted: string = '';
  repository: string = '';
  support: string = '';
  learn: string = '';
}
