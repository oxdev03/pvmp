import type { TargetPlatform } from '@pvmp/contract';
import { TARGET_PLATFORMS } from '@pvmp/contract';

export function isTargetPlatform(value: string): value is TargetPlatform {
  return (TARGET_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Maps a Node `process.platform`/`process.arch` pair to VS Code's
 * `targetPlatform` vocabulary.
 *
 * `isAlpine` must be supplied by the caller: musl cannot be detected from
 * `process.platform`, which reports plain `linux` on Alpine.
 */
export function detectTargetPlatform(
  platform: string,
  arch: string,
  isAlpine = false,
): TargetPlatform {
  const os = platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux';

  if (os === 'linux' && arch === 'arm') return 'linux-armhf';

  const cpu = arch === 'arm64' ? 'arm64' : 'x64';
  const prefix = os === 'linux' && isAlpine ? 'alpine' : os;
  const candidate = `${prefix}-${cpu}`;

  return isTargetPlatform(candidate) ? candidate : 'universal';
}

/** A universal build runs anywhere; anything else must match the host exactly. */
export function isPlatformCompatible(target: TargetPlatform, host: TargetPlatform): boolean {
  return target === 'universal' || target === host;
}
