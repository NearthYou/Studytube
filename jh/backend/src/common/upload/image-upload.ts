import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { rename, stat, unlink } from 'node:fs/promises';
import sharp from 'sharp';

interface ReencodeImageFileOptions {
  maxHeight: number;
  maxInputPixels?: number;
  maxWidth: number;
  quality: number;
}

const IMAGE_EXTENSION_BY_MIME_TYPE = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

export const allowedImageMimeTypes = new Set(
  IMAGE_EXTENSION_BY_MIME_TYPE.keys(),
);

export function createStoredImageFilename(mimeType: string) {
  const extension = IMAGE_EXTENSION_BY_MIME_TYPE.get(mimeType);

  if (!extension) {
    throw new BadRequestException(
      'jpg, png, webp 이미지만 첨부할 수 있습니다.',
    );
  }

  return `${randomUUID()}${extension}`;
}

export function createStoredWebpImageFilename() {
  return `${randomUUID()}.webp`;
}

export function assertAllowedImageMimeType(mimeType: string) {
  if (!allowedImageMimeTypes.has(mimeType)) {
    throw new BadRequestException(
      'jpg, png, webp 이미지만 첨부할 수 있습니다.',
    );
  }
}

export async function reencodeImageFileToWebp(
  filePath: string,
  options: ReencodeImageFileOptions,
) {
  const outputPath = `${filePath}.${randomUUID()}.tmp`;
  const image = options.maxInputPixels
    ? sharp(filePath, { limitInputPixels: options.maxInputPixels })
    : sharp(filePath);

  try {
    await image
      .rotate()
      .resize({
        fit: 'inside',
        height: options.maxHeight,
        width: options.maxWidth,
        withoutEnlargement: true,
      })
      .webp({ quality: options.quality })
      .toFile(outputPath);
    await rename(outputPath, filePath);

    return {
      fileSize: (await stat(filePath)).size,
    };
  } catch {
    await unlink(outputPath).catch(() => undefined);
    throw new BadRequestException('이미지 파일을 처리할 수 없습니다.');
  }
}
