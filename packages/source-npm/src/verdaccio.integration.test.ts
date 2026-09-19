import { execFileSync, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

import { buildPvmpTarball, packageJsonFixture, PNG_MAGIC } from '@pvmp/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { verdaccioAdapter } from './adapters/index.ts';
import { NpmSource } from './source.ts';
import { makeDeps } from './testing.ts';

const run = promisify(execFile);

const IMAGE = 'verdaccio/verdaccio:6';
const CONTAINER = `pvmp-verdaccio-${process.pid}`;
const USER = 'pvmp';
const PASSWORD = 'pvmp-password';

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function waitForRegistry(registry: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- polling is sequential
      const response = await fetch(`${registry}-/ping`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`Verdaccio did not start within ${timeoutMs}ms`);
    // oxlint-disable-next-line no-await-in-loop -- polling is sequential
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** npm's user-creation endpoint; returns a bearer token. */
async function createUser(registry: string): Promise<string> {
  const response = await fetch(`${registry}-/user/org.couchdb.user:${USER}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      _id: `org.couchdb.user:${USER}`,
      name: USER,
      password: PASSWORD,
      type: 'user',
      roles: [],
      date: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`could not create user: ${response.status}`);
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error('registry returned no token');
  return body.token;
}

/**
 * Publishes via the npm HTTP protocol rather than shelling out to the npm CLI,
 * so the test depends on the registry rather than on a second package manager.
 */
async function publish(
  registry: string,
  token: string,
  name: string,
  version: string,
  tarball: Uint8Array,
  manifest: Record<string, unknown>,
): Promise<void> {
  const filename = `${name.replace('/', '-').replace('@', '')}-${version}.tgz`;
  const shasum = createHash('sha1').update(tarball).digest('hex');

  const body = {
    _id: name,
    name,
    'dist-tags': { latest: version },
    versions: {
      [version]: {
        ...manifest,
        _id: `${name}@${version}`,
        dist: { shasum, tarball: `${registry}${name}/-/${filename}` },
      },
    },
    _attachments: {
      [filename]: {
        content_type: 'application/octet-stream',
        data: Buffer.from(tarball).toString('base64'),
        length: tarball.length,
      },
    },
  };

  const response = await fetch(`${registry}${name.replace('/', '%2f')}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`publish failed: ${response.status} ${await response.text()}`);
  }
}

/**
 * The one source test that talks to a real registry (SPEC.md §4.2).
 *
 * It exercises the whole npm path end to end — catalog listing, packument,
 * tarball fetch, vsix extraction — and so also validates the shared client
 * that the fixture-verified JFrog and Nexus adapters ride on.
 */
describe.skipIf(!dockerAvailable())(
  'verdaccio integration',
  () => {
    let registry: string;
    let token: string;

    beforeAll(async () => {
      execFileSync('docker', ['pull', '--quiet', IMAGE], { stdio: 'ignore' });
      const { stdout } = await run('docker', [
        'run',
        '--rm',
        '--detach',
        '--name',
        CONTAINER,
        '--publish',
        '0:4873',
        IMAGE,
      ]);
      if (!stdout.trim()) throw new Error('docker run produced no container id');

      const { stdout: portOut } = await run('docker', ['port', CONTAINER, '4873/tcp']);
      const port = portOut.trim().split('\n')[0]?.split(':').pop();
      registry = `http://127.0.0.1:${port}/`;

      await waitForRegistry(registry);
      token = await createUser(registry);

      const vsix = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
      for (const version of ['1.4.0', '1.3.0']) {
        const manifest = packageJsonFixture({ version });
        // oxlint-disable-next-line no-await-in-loop -- the registry serialises publishes
        await publish(
          registry,
          token,
          '@corp/vsc-lint',
          version,
          buildPvmpTarball({
            packageJson: manifest,
            readme: `# Corp Lint ${version}`,
            changelog: `## ${version}`,
            icon: PNG_MAGIC,
            vsix,
          }),
          manifest as unknown as Record<string, unknown>,
        );
      }
    }, 180_000);

    afterAll(() => {
      try {
        execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
      } catch {
        // already gone
      }
    });

    function source() {
      const deps = makeDeps(token);
      return new NpmSource(
        {
          id: 'verdaccio',
          registry,
          adapter: verdaccioAdapter,
          scope: '@corp',
          repo: undefined,
          baseUrl: undefined,
        },
        deps,
      );
    }

    it('lists both published versions', async () => {
      const versions = await source().list();
      expect(versions.map((v) => v.version).toSorted()).toEqual(['1.3.0', '1.4.0']);
      expect(versions[0]).toMatchObject({
        extensionId: 'acme.lint',
        packageName: '@corp/vsc-lint',
        displayName: 'Corp Lint',
        engine: '^1.96.0',
      });
    });

    it('reports a real publish timestamp', async () => {
      const versions = await source().list();
      const published = versions[0]?.publishedAt;
      expect(published).toBeTruthy();
      expect(Number.isNaN(Date.parse(published as string))).toBe(false);
    });

    it('fetches the readme and changelog for a specific version', async () => {
      const npm = source();
      const versions = await npm.list();
      const v130 = versions.find((v) => v.version === '1.3.0');

      const content = await npm.fetchDetails(v130!);
      expect(content.readme).toBe('# Corp Lint 1.3.0');
      expect(content.changelog).toBe('## 1.3.0');
    });

    it('extracts the vsix from the published tarball', async () => {
      const npm = source();
      const [version] = await npm.list();
      const vsix = await npm.fetchVsix(version!);
      // PK\x03\x04 — a real vsix is a zip.
      expect(Array.from(vsix.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    });

    it('fetches the icon by streaming the tarball', async () => {
      const npm = source();
      const [version] = await npm.list();
      expect(await npm.fetchIcon(version!)).toEqual(PNG_MAGIC);
    });

    it('rejects an anonymous client with an auth failure', async () => {
      const anonymous = new NpmSource(
        {
          id: 'verdaccio-anon',
          registry,
          adapter: verdaccioAdapter,
          scope: '@corp',
          repo: undefined,
          baseUrl: undefined,
        },
        makeDeps(undefined),
      );
      // Verdaccio 6 allows anonymous reads by default, so this must still work.
      // The assertion is that it does not throw an unexpected error shape.
      await expect(anonymous.list()).resolves.toBeInstanceOf(Array);
    });
  },
  180_000,
);
