import mongoose from 'mongoose';
import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`No API route for ${req.method} ${req.originalUrl}`));
}

/** Rejects requests with a clear message while MongoDB is unavailable. */
export function requireDb(_req, _res, next) {
  if (mongoose.connection.readyState !== 1) {
    return next(new ApiError(503, 'Database is unavailable. Check that MongoDB is running, then retry.'));
  }
  return next();
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  let status = err.status || 500;
  let message = err.message || 'Something went wrong.';
  let details = err.details;

  if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    message = 'Some fields are invalid.';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    message = `Invalid value for ${err.path}.`;
  } else if (err?.code === 11000) {
    status = 409;
    message = 'A record with that value already exists.';
  } else if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'Photo is too large (max 8 MB).' : err.message;
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    message = 'Request body is not valid JSON.';
  }

  if (status >= 500) logger.error(err.stack || err);

  res.status(status).json({
    error: { message: status >= 500 && !(err instanceof ApiError) ? 'Internal server error.' : message, details },
  });
}
