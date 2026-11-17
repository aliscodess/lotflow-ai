import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { env, cloudinaryEnabled } from '../config/env.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

let cloudinary = null;
async function getCloudinary() {
  if (!cloudinaryEnabled) return null;
  if (cloudinary) return cloudinary;
  const mod = await import('cloudinary');
  cloudinary = mod.v2;
  if (env.cloudinary.url) cloudinary.config({ secure: true });
  else cloudinary.config({ cloud_name: env.cloudinary.cloudName, api_key: env.cloudinary.apiKey, api_secret: env.cloudinary.apiSecret, secure: true });
  return cloudinary;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif' };

/**
 * Stores an uploaded image. Uses Cloudinary when configured, otherwise the local
 * uploads/ folder (served by Express at /uploads).
 */
export async function saveImage(file, { baseUrl, folder = 'lotflow' } = {}) {
  const cld = await getCloudinary();
  if (cld) {
    try {
      const result = await new Promise((resolve, reject) => {
        const stream = cld.uploader.upload_stream({ folder, resource_type: 'image' }, (err, res) => (err ? reject(err) : resolve(res)));
        stream.end(file.buffer);
      });
      return { url: result.secure_url, storage: 'cloudinary' };
    } catch (err) {
      logger.warn(`[storage] Cloudinary upload failed, storing locally: ${err.message}`);
    }
  }
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${EXT[file.mimetype] || 'jpg'}`;
  await fs.writeFile(path.join(UPLOAD_DIR, name), file.buffer);
  return { url: `${baseUrl || env.serverUrl}/uploads/${name}`, storage: 'local' };
}
