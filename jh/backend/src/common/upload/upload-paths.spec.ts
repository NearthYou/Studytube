import { join } from 'node:path';
import {
  getUploadLocalRoot,
  getUploadPublicPrefix,
  isPathInsideUploadRoot,
  toUploadLocalPath,
  toUploadPublicPath,
} from './upload-paths';

const originalEnv = process.env;

describe('upload paths', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.UPLOAD_LOCAL_ROOT;
    delete process.env.UPLOAD_PUBLIC_PREFIX;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses uploads under the backend working directory by default', () => {
    expect(getUploadLocalRoot()).toBe(join(process.cwd(), 'uploads'));
    expect(getUploadPublicPrefix()).toBe('/uploads');
    expect(toUploadPublicPath('posts', 'image.webp')).toBe(
      '/uploads/posts/image.webp',
    );
    expect(toUploadLocalPath('/uploads/posts/image.webp')).toBe(
      join(process.cwd(), 'uploads', 'posts', 'image.webp'),
    );
  });

  it('maps public paths to a configured persistent local root', () => {
    process.env.UPLOAD_LOCAL_ROOT = '/mnt/tailtalk-uploads';
    process.env.UPLOAD_PUBLIC_PREFIX = '/media';

    expect(toUploadPublicPath('profiles', 'avatar.webp')).toBe(
      '/media/profiles/avatar.webp',
    );
    expect(toUploadLocalPath('/media/profiles/avatar.webp')).toBe(
      '/mnt/tailtalk-uploads/profiles/avatar.webp',
    );
  });

  it('detects paths outside the upload root', () => {
    process.env.UPLOAD_LOCAL_ROOT = '/mnt/tailtalk-uploads';

    expect(
      isPathInsideUploadRoot('/mnt/tailtalk-uploads/posts/image.webp'),
    ).toBe(true);
    expect(isPathInsideUploadRoot('/tmp/image.webp')).toBe(false);
  });

  it('rejects public paths that escape the upload root', () => {
    process.env.UPLOAD_LOCAL_ROOT = '/mnt/tailtalk-uploads';

    expect(() => toUploadLocalPath('/uploads/../secret.txt')).toThrow(
      'Upload path escapes UPLOAD_LOCAL_ROOT.',
    );
  });
});
