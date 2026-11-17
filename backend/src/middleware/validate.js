import { ApiError } from '../utils/ApiError.js';

/**
 * Validates req.body (or another source) with a zod schema.
 * On success the parsed value replaces the source so controllers receive clean data.
 */
export const validate =
  (schema, source = 'body') =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      return next(ApiError.badRequest(details[0]?.message ? `${details[0].field || 'input'}: ${details[0].message}` : 'Invalid input.', details));
    }
    if (source === 'body') req.body = result.data;
    else req.validated = result.data;
    return next();
  };
