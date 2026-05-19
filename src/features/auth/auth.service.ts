import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import AppError from '../../shared/utils/AppError';
import { sendEmail } from '../../shared/utils/email';
import User from '../users/user.model';
import type { AuthTokenPayload, LoginInput } from './auth.types';

export const login = async (input: LoginInput) => {
  const user = await User.findOne({ email: input.email.toLowerCase() });
  if (!user) {
    throw new AppError(
      401,
      'AUTH_INVALID_CREDENTIALS',
      'Invalid email or password'
    );
  }

  if (!user.isActive) {
    throw new AppError(401, 'USER_INACTIVE', 'Account is deactivated');
  }

  const match = await bcrypt.compare(input.password, user.passwordHash);
  if (!match) {
    throw new AppError(
      401,
      'AUTH_INVALID_CREDENTIALS',
      'Invalid email or password'
    );
  }

  const payload: AuthTokenPayload = {
    _id: String(user._id),
    roles: user.roles,
    appAccess: user.appAccess,
    permissions: user.permissions as unknown as Record<
      string,
      Record<string, boolean>
    >,
  };

  const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn:
      env.JWT_ACCESS_EXPIRES as unknown as jwt.SignOptions['expiresIn'],
  });
  const refreshToken = jwt.sign(
    { _id: String(user._id) },
    env.JWT_REFRESH_SECRET,
    {
      expiresIn:
        env.JWT_REFRESH_EXPIRES as unknown as jwt.SignOptions['expiresIn'],
    }
  );

  user.refreshTokenAts = refreshToken;
  user.lastLoginAts = new Date();
  await user.save();

  return { user: user.toSafeObject(), accessToken, refreshToken };
};

export const logout = async (userId: string) => {
  const user = await User.findById(userId);
  if (user) {
    user.refreshTokenAts = null;
    await user.save();
  }
};

export const refreshToken = async (token: string) => {
  let decoded: jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
  } catch {
    throw new AppError(401, 'AUTH_TOKEN_INVALID', 'Invalid refresh token');
  }

  const user = await User.findById(decoded._id);
  if (!user || user.refreshTokenAts !== token) {
    throw new AppError(401, 'AUTH_TOKEN_INVALID', 'Invalid refresh token');
  }

  const payload: AuthTokenPayload = {
    _id: String(user._id),
    roles: user.roles,
    appAccess: user.appAccess,
    permissions: user.permissions as unknown as Record<
      string,
      Record<string, boolean>
    >,
  };

  const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn:
      env.JWT_ACCESS_EXPIRES as unknown as jwt.SignOptions['expiresIn'],
  });

  return { user: user.toSafeObject(), accessToken };
};

export const forgotPassword = async (email: string) => {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return;

  const resetToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetToken = resetToken;
  user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();

  const resetUrl = `${env.ATS_FRONTEND_URL}/reset-password?token=${resetToken}`;
  await sendEmail({
    to: [user.email],
    subject: 'Reset your password',
    html: `<p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 1 hour.</p>`,
  });
};

export const resetPassword = async (token: string, password: string) => {
  const user = await User.findOne({
    passwordResetToken: token,
    passwordResetExpires: { $gt: new Date() },
  });
  if (!user) {
    throw new AppError(
      400,
      'AUTH_TOKEN_INVALID',
      'Reset link is invalid or has expired'
    );
  }

  user.passwordHash = await bcrypt.hash(password, 12);
  user.passwordResetToken = null;
  user.passwordResetExpires = null;
  user.refreshTokenAts = null;
  user.refreshTokenCrm = null;
  await user.save();
};
