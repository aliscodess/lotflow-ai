import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|heic|heif|gif)$/i.test(file.mimetype)) {
      return cb(ApiError.badRequest('Only image files (JPG, PNG, WEBP, HEIC) can be uploaded.'));
    }
    return cb(null, true);
  },
});
