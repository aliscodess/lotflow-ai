import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';

export function signAccessToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role, name: user.name }, env.jwt.secret, {
    expiresIn: env.jwt.accessTtl,
  });
}

export function signRefreshToken(user) {
  return jwt.sign({ sub: String(user._id), v: user.tokenVersion ?? 0 }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshTtl,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.secret);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}

/** Requires a valid Bearer access token. Attaches req.user. */
export async function protect(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(ApiError.unauthorized());
  try {
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).lean();
    if (!user) return next(ApiError.unauthorized('Your account no longer exists. Sign in again.'));
    req.user = { id: String(user._id), name: user.name, role: user.role, email: user.email, storeCode: user.storeCode };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return next(new ApiError(401, 'Session expired.', { code: 'TOKEN_EXPIRED' }));
    return next(ApiError.unauthorized('Invalid session. Sign in again.'));
  }
}

/** Role-based access control. Usage: requireRole('MANAGER', 'SERVICE_ADVISOR') */
export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    return next();
  };

export const actorOf = (req) => ({ name: req.user?.name || 'System', role: req.user?.role || 'SYSTEM' });
