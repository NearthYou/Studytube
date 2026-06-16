import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const DEFAULT_UPLOAD_PUBLIC_PREFIX = '/uploads';

export function getUploadLocalRoot() {
  const configuredRoot = process.env.UPLOAD_LOCAL_ROOT?.trim();

  if (!configuredRoot) {
    return join(process.cwd(), 'uploads');
  }

  return isAbsolute(configuredRoot)
    ? resolve(configuredRoot)
    : resolve(process.cwd(), configuredRoot);
}

export function getUploadPublicPrefix() {
  return normalizeUploadPublicPrefix(
    process.env.UPLOAD_PUBLIC_PREFIX ?? DEFAULT_UPLOAD_PUBLIC_PREFIX,
  );
}

export function getUploadStaticPrefix() {
  return `${getUploadPublicPrefix()}/`;
}

export function toUploadPublicPath(...segments: string[]) {
  return [
    getUploadPublicPrefix(),
    ...segments.map((segment) => trimSlashes(segment)),
  ]
    .filter(Boolean)
    .join('/');
}

export function toUploadLocalPath(publicPath: string) {
  const publicPrefix = getUploadPublicPrefix();
  const normalizedPublicPath = `/${trimSlashes(publicPath)}`;
  const relativePath = normalizedPublicPath.startsWith(`${publicPrefix}/`)
    ? normalizedPublicPath.slice(publicPrefix.length + 1)
    : trimSlashes(normalizedPublicPath);
  const localPath = resolve(getUploadLocalRoot(), relativePath);

  if (!isPathInsideUploadRoot(localPath)) {
    throw new Error('Upload path escapes UPLOAD_LOCAL_ROOT.');
  }

  return localPath;
}

export function isPathInsideUploadRoot(path: string) {
  const uploadRoot = getUploadLocalRoot();
  const relativePath = relative(uploadRoot, path);

  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  );
}

export function normalizeUploadPublicPrefix(prefix: string) {
  const trimmedPrefix = prefix.trim().replace(/\/+$/, '');

  if (!trimmedPrefix.startsWith('/')) {
    throw new Error('UPLOAD_PUBLIC_PREFIX must start with /.');
  }

  if (trimmedPrefix === '/') {
    throw new Error('UPLOAD_PUBLIC_PREFIX must not be /.');
  }

  if (trimmedPrefix.includes('..') || trimmedPrefix.includes(sep + sep)) {
    throw new Error(
      'UPLOAD_PUBLIC_PREFIX must not contain traversal segments.',
    );
  }

  return trimmedPrefix;
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '');
}
