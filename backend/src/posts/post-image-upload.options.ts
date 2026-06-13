import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { diskStorage } from 'multer';
import type { Options } from 'multer';
import { getUploadLocalRoot } from '../common/upload/upload-paths';
import {
  assertAllowedImageMimeType,
  createStoredWebpImageFilename,
} from '../common/upload/image-upload';

const MAX_POST_IMAGE_SIZE = 5 * 1024 * 1024;

export const postImageUploadOptions: Options = {
  storage: diskStorage({
    destination: (_req, _file, callback) => {
      const POST_IMAGE_DIRECTORY = join(getUploadLocalRoot(), 'posts');

      mkdirSync(POST_IMAGE_DIRECTORY, { recursive: true });
      callback(null, POST_IMAGE_DIRECTORY);
    },
    filename: (_req, _file, callback) => {
      callback(null, createStoredWebpImageFilename());
    },
  }),
  fileFilter: (_req, file, callback) => {
    try {
      assertAllowedImageMimeType(file.mimetype);
      callback(null, true);
    } catch (error) {
      callback(error as Error);
    }
  },
  limits: {
    fileSize: MAX_POST_IMAGE_SIZE,
    files: 1,
  },
};
