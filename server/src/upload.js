import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { HttpError } from './errors.js';

export const UPLOADS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const MAX_PHOTOS = 5;
const EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

export const uploadPhotos = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + EXTENSIONS[file.mimetype]),
  }),
  limits: { fileSize: 3 * 1024 * 1024, files: MAX_PHOTOS },
  fileFilter: (req, file, cb) => {
    if (EXTENSIONS[file.mimetype]) cb(null, true);
    else cb(new HttpError(400, 'Photos must be JPG, PNG, WEBP or GIF'));
  },
}).array('photos', MAX_PHOTOS);

export function photoUrl(file) {
  return `/uploads/${file.filename}`;
}

export function deletePhotoFiles(urls) {
  for (const url of urls) {
    fs.rm(path.join(UPLOADS_DIR, path.basename(url)), { force: true }, () => {});
  }
}
