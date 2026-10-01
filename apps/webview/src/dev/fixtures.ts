import type {
  CatalogEntry,
  CatalogSnapshot,
  ExtensionVersion,
  SourceError,
  TargetPlatform,
} from '@pvmp/contract';

const HOST_PLATFORM: TargetPlatform = 'darwin-arm64';

interface EntrySpec {
  id: string;
  name: string;
  publisher?: string;
  description?: string;
  categories?: string[];
  versions: string[];
  installed?: string;
  external?: boolean;
  sourceId?: string;
  preRelease?: boolean;
  hue?: number;
}

function makeVersion(spec: EntrySpec, version: string, index: number): ExtensionVersion {
  return {
    extensionId: spec.id,
    packageName: `@corp/${spec.id.split('.')[1] ?? spec.id}`,
    version,
    targetPlatform: 'universal',
    preRelease: spec.preRelease === true && index === 0,
    engine: '^1.96.0',
    displayName: spec.name,
    publisher: spec.id.split('.')[0] ?? 'acme',
    publisherDisplayName: spec.publisher ?? 'Acme Corp',
    description: spec.description ?? '',
    categories: spec.categories ?? ['Other'],
    publishedAt: new Date(Date.UTC(2026, 8, 19 - index * 11)).toISOString(),
    sourceId: spec.sourceId ?? 'corp-artifactory',
    locator: `@corp/${spec.id}@${version}`,
  };
}

function makeEntry(spec: EntrySpec): CatalogEntry {
  const versions = spec.versions.map((v, i) => makeVersion(spec, v, i));
  const latest = versions[0];
  const status = !spec.installed
    ? 'available'
    : latest && latest.version !== spec.installed
      ? 'update-available'
      : 'installed';

  return {
    extensionId: spec.id,
    displayName: spec.name,
    publisher: spec.id.split('.')[0] ?? 'acme',
    publisherDisplayName: spec.publisher ?? 'Acme Corp',
    description: spec.description ?? '',
    categories: spec.categories ?? ['Other'],
    versions,
    ...(latest ? { latest } : {}),
    ...(spec.installed
      ? { installed: { version: spec.installed, external: spec.external === true } }
      : {}),
    status,
    preReleaseOptIn: false,
  };
}

/** A deterministic placeholder icon, so list rows have something to render. */
export function fixtureIcon(extensionId: string): string {
  let hash = 0;
  for (const char of extensionId) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
  const initials = (extensionId.split('.')[1] ?? 'x').slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="hsl(${hash} 55% 45%)"/><text x="32" y="42" font-family="sans-serif" font-size="28" font-weight="600" fill="white" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

const SPECS: EntrySpec[] = [
  {
    id: 'acme.lint',
    name: 'Corp Lint',
    description: 'Company lint rules with autofix for internal style conventions.',
    categories: ['Linters', 'Formatters'],
    versions: ['1.10.0', '1.9.0', '1.2.0'],
    installed: '1.9.0',
  },
  {
    id: 'acme.theme',
    name: 'Corp Theme',
    description: 'The official dark and light themes.',
    categories: ['Themes'],
    versions: ['2.1.0', '2.0.0'],
    installed: '2.1.0',
  },
  {
    id: 'acme.deploy',
    name: 'Corp Deploy',
    description: 'One-click deploys to the internal platform.',
    categories: ['Other'],
    versions: ['4.0.0', '3.9.1'],
    installed: '3.8.0',
    external: true,
  },
  {
    id: 'acme.snippets',
    name: 'Corp Snippets',
    description: 'Shared snippets for internal frameworks.',
    categories: ['Snippets'],
    versions: ['1.0.0'],
  },
  {
    id: 'acme.secrets',
    name: 'Secret Scanner',
    description: 'Blocks commits containing credentials.',
    categories: ['Linters'],
    versions: ['0.9.0'],
    sourceId: 'local',
  },
  {
    id: 'platform.tooling',
    name: 'Platform Tooling',
    description: 'CLI integration for the platform team toolchain.',
    publisher: 'Platform Team',
    categories: ['Other'],
    versions: ['3.0.0-rc.2', '2.8.0'],
    preRelease: true,
  },
];

export const README = `# Corp Lint

Company lint rules with autofix for internal style conventions.

## Features

- Enforces the internal naming convention
- Autofix on save
- Shares configuration through \`@corp/lint-config\`

## Requirements

Requires VS Code 1.96 or newer.

| Setting | Default | Description |
| --- | --- | --- |
| \`corpLint.autofix\` | \`true\` | Fix on save |
| \`corpLint.strict\` | \`false\` | Treat warnings as errors |
`;

export const CHANGELOG = `## 1.10.0

- Added autofix for the naming convention rule
- Fixed a crash on empty files

## 1.9.0

- Initial public release
`;

/** A README with script-injection vectors, for the sanitizer test (SPEC.md §7.7). */
export const UNSAFE_README = `# Unsafe

<script>window.__pvmpXss = true;</script>

<img src="x" onerror="window.__pvmpXss = true" alt="broken">

<a href="javascript:window.__pvmpXss = true">click me</a>

[normal link](https://example.com)
`;

export type ScenarioName =
  | 'default'
  | 'empty'
  | 'auth'
  | 'unreachable'
  | 'slow-install'
  | 'install-fails'
  | 'no-icons'
  | 'unsafe-readme'
  | 'many';

export interface Scenario {
  entries: CatalogEntry[];
  errors: SourceError[];
  /** Milliseconds each install phase takes. */
  installDelayMs: number;
  installFails: boolean;
  icons: boolean;
  readme: string;
}

const AUTH_ERROR: SourceError = {
  sourceId: 'corp-artifactory',
  kind: 'auth',
  message: 'Sign-in required: the registry returned 401 Unauthorized.',
};

const UNREACHABLE_ERROR: SourceError = {
  sourceId: 'corp-artifactory',
  kind: 'unreachable',
  message: 'Could not reach https://art.corp/artifactory (ETIMEDOUT).',
};

export function buildScenario(name: ScenarioName): Scenario {
  const base: Scenario = {
    entries: SPECS.map(makeEntry),
    errors: [],
    installDelayMs: 0,
    installFails: false,
    icons: true,
    readme: README,
  };

  switch (name) {
    case 'empty':
      return { ...base, entries: [] };
    case 'auth':
      return { ...base, entries: [], errors: [AUTH_ERROR] };
    case 'unreachable':
      return { ...base, errors: [UNREACHABLE_ERROR] };
    case 'slow-install':
      return { ...base, installDelayMs: 400 };
    case 'install-fails':
      return { ...base, installFails: true };
    case 'no-icons':
      return { ...base, icons: false };
    case 'unsafe-readme':
      return { ...base, readme: UNSAFE_README };
    case 'many':
      return {
        ...base,
        entries: Array.from({ length: 40 }, (_, index) =>
          makeEntry({
            id: `acme.pkg${String(index).padStart(2, '0')}`,
            name: `Package ${index}`,
            description: `Generated fixture extension number ${index}.`,
            versions: ['1.0.0'],
          }),
        ),
      };
    default:
      return base;
  }
}

export function snapshot(scenario: Scenario): CatalogSnapshot {
  return {
    entries: scenario.entries,
    errors: scenario.errors,
    vscodeVersion: '1.98.0',
    targetPlatform: HOST_PLATFORM,
  };
}
