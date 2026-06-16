import {
  assertAllowedImageMimeType,
  createStoredImageFilename,
  createStoredWebpImageFilename,
  reencodeImageFileToWebp,
} from './image-upload';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

describe('image upload helpers', () => {
  it('creates stored filenames from trusted server-side mime mappings', () => {
    expect(createStoredImageFilename('image/jpeg')).toMatch(
      /^[0-9a-f-]+\.jpg$/,
    );
    expect(createStoredImageFilename('image/png')).toMatch(/^[0-9a-f-]+\.png$/);
    expect(createStoredImageFilename('image/webp')).toMatch(
      /^[0-9a-f-]+\.webp$/,
    );
    expect(createStoredWebpImageFilename()).toMatch(/^[0-9a-f-]+\.webp$/);
  });

  it('rejects unsupported image mime types', () => {
    expect(() => assertAllowedImageMimeType('text/html')).toThrow(
      'jpg, png, webp 이미지만 첨부할 수 있습니다.',
    );
    expect(() => createStoredImageFilename('text/html')).toThrow(
      'jpg, png, webp 이미지만 첨부할 수 있습니다.',
    );
  });

  it('re-encodes valid image bytes to webp', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tail-talk-image-'));
    const filePath = join(directory, 'profile.webp');

    try {
      await sharp({
        create: {
          background: '#1f8a70',
          channels: 3,
          height: 16,
          width: 16,
        },
      })
        .png()
        .toFile(filePath);

      await reencodeImageFileToWebp(filePath, {
        maxHeight: 8,
        maxInputPixels: 1_000,
        maxWidth: 8,
        quality: 80,
      });

      const metadata = await sharp(filePath).metadata();

      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(8);
      expect(metadata.height).toBe(8);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects invalid image bytes during re-encoding', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tail-talk-image-'));
    const filePath = join(directory, 'profile.webp');

    try {
      await writeFile(filePath, '<html></html>');

      await expect(
        reencodeImageFileToWebp(filePath, {
          maxHeight: 8,
          maxInputPixels: 1_000,
          maxWidth: 8,
          quality: 80,
        }),
      ).rejects.toThrow('이미지 파일을 처리할 수 없습니다.');
      await expect(readFile(filePath, 'utf8')).resolves.toBe('<html></html>');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects images that exceed the configured pixel limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tail-talk-image-'));
    const filePath = join(directory, 'profile.webp');

    try {
      await sharp({
        create: {
          background: '#1f8a70',
          channels: 3,
          height: 16,
          width: 16,
        },
      })
        .png()
        .toFile(filePath);

      await expect(
        reencodeImageFileToWebp(filePath, {
          maxHeight: 16,
          maxInputPixels: 100,
          maxWidth: 16,
          quality: 80,
        }),
      ).rejects.toThrow('이미지 파일을 처리할 수 없습니다.');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
