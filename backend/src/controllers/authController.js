import { z } from 'zod';
import { User } from '../models/index.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../middleware/auth.js';
import { ROLES } from '../utils/constants.js';

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
export const demoSchema = z.object({ role: z.enum(Object.values(ROLES)) });
export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

const DEMO_EMAILS = {
  MANAGER: 'manager@lotflow.demo',
  LOT_ASSOCIATE: 'associate@lotflow.demo',
  SERVICE_ADVISOR: 'advisor@lotflow.demo',
};

async function session(user) {
  user.lastLoginAt = new Date();
  await user.save();
  return {
    user: { _id: user._id, name: user.name, email: user.email, role: user.role, title: user.title, storeCode: user.storeCode },
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

export async function login(req, res) {
  const user = await User.findOne({ email: req.body.email }).select('+password');
  if (!user || !(await user.comparePassword(req.body.password))) throw ApiError.unauthorized('Email or password is incorrect.');
  res.json(await session(user));
}

export async function demoLogin(req, res) {
  if (!env.demoMode) throw ApiError.forbidden('Demo sign-in is turned off. Use your email and password.');
  const user = await User.findOne({ email: DEMO_EMAILS[req.body.role] });
  if (!user) throw new ApiError(503, 'Demo users are missing. Run "npm run seed" in the backend folder.');
  res.json(await session(user));
}

export async function refresh(req, res) {
  let payload;
  try {
    payload = verifyRefreshToken(req.body.refreshToken);
  } catch {
    throw ApiError.unauthorized('Session expired. Sign in again.');
  }
  const user = await User.findById(payload.sub);
  if (!user || (user.tokenVersion ?? 0) !== payload.v) throw ApiError.unauthorized('Session expired. Sign in again.');
  res.json({ accessToken: signAccessToken(user), refreshToken: signRefreshToken(user) });
}

export async function logout(req, res) {
  // Rotating the token version revokes every refresh token for this user.
  if (req.user) await User.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 } });
  res.json({ ok: true });
}

export async function me(req, res) {
  const user = await User.findById(req.user.id).lean();
  if (!user) throw ApiError.unauthorized();
  res.json({ user: { _id: user._id, name: user.name, email: user.email, role: user.role, title: user.title, storeCode: user.storeCode } });
}
