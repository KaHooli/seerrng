import fs from 'node:fs';
import path from 'node:path';

// A caller that doesn't own a directory (common when a container runs as a
// fixed non-root UID against a bind mount, NFS share, or read-only layer
// owned by the host) gets EPERM/EROFS/ENOSYS from chmod even though the
// existing permissions may already be adequate. Hardening chmod calls are
// best-effort in that case, not a reason to crash the process.
const TOLERABLE_CHMOD_ERROR_CODES = new Set(['EPERM', 'EROFS', 'ENOSYS']);

export const isTolerableChmodError = (error: unknown): boolean =>
  TOLERABLE_CHMOD_ERROR_CODES.has((error as NodeJS.ErrnoException)?.code ?? '');

// A chmod the process is not permitted to perform fails identically every time:
// the ownership of a bind mount does not change while the container runs. The
// settings file alone is hardened on every read, write and lock acquisition, so
// a background scan that saves settings in a loop would otherwise repeat the
// same line hundreds of times. Report each path once and stay quiet after that.
const reportedChmodFailures = new Set<string>();

export const shouldReportChmodFailure = (target: string): boolean => {
  if (reportedChmodFailures.has(target)) {
    return false;
  }
  reportedChmodFailures.add(target);
  return true;
};

// Exposed for tests, which need each case to start from a clean slate.
export const resetReportedChmodFailures = (): void => {
  reportedChmodFailures.clear();
};

export const CHMOD_FAILURE_HINT =
  'Reported once per path. Expected when the directory is a bind mount owned by another user; data is still stored correctly. To silence it, make the mount owned by the user the container runs as.';

export const assertNoSymlinkDirectoryComponents = (
  directory: string,
  options: { allowMissing?: boolean; label?: string } = {}
): void => {
  const resolved = path.resolve(directory);
  const root = path.parse(resolved).root;
  const components = resolved
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean);
  let current = root;

  for (const component of components) {
    current = path.join(current, component);

    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (
        options.allowMissing &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }

    if (stat.isSymbolicLink()) {
      throw new Error(
        `${options.label ?? 'Directory path'} must not contain symlinks: ${current}`
      );
    }
    if (!stat.isDirectory()) {
      throw new Error(
        `${options.label ?? 'Directory path'} contains a non-directory component: ${current}`
      );
    }
  }
};
