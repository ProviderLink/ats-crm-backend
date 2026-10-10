import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import AppError from '../../shared/utils/AppError';
import { sendEmail } from '../../shared/utils/email';
import { createLog } from '../activity-logs/activityLog.service';
import User from '../users/user.model';
import type { AuthTokenPayload, LoginInput } from './auth.types';

/** Record a sign-in attempt against the account it was for. */
const logSignIn = (
  action: 'login' | 'login_failed',
  userId: string,
  app: 'ats' | 'crm',
  ip?: string,
  reason?: string
): void => {
  createLog({
    action,
    resourceType: 'user',
    resourceId: userId,
    metadata: { app, ...(ip ? { ip } : {}), ...(reason ? { reason } : {}) },
    performedBy: action === 'login' ? userId : null,
  });
};

export const login = async (input: LoginInput, ip?: string) => {
  const app = input.app ?? 'ats';
  const user = await User.findOne({ email: input.email.toLowerCase() });
  // An unknown email is not logged: there is no account to attach it to and
  // anyone could fill the log with made-up addresses.
  if (!user) {
    throw new AppError(
      401,
      'AUTH_INVALID_CREDENTIALS',
      'Invalid email or password'
    );
  }

  if (!user.isActive) {
    logSignIn('login_failed', String(user._id), app, ip, 'inactive');
    throw new AppError(401, 'USER_INACTIVE', 'Account is deactivated');
  }

  const match = await bcrypt.compare(input.password, user.passwordHash);
  if (!match) {
    logSignIn('login_failed', String(user._id), app, ip, 'wrong_password');
    throw new AppError(
      401,
      'AUTH_INVALID_CREDENTIALS',
      'Invalid email or password'
    );
  }

  const payload: AuthTokenPayload = {
    _id: String(user._id),
    firstName: user.firstName,
    lastName: user.lastName,
    roles: user.roles,
    appAccess: user.appAccess,
    permissions: user.permissions as unknown as Record<
      string,
      Record<string, boolean>
    >,
    candidateRef: user.candidateRef ? String(user.candidateRef) : null,
    clientRef: user.clientRef ? String(user.clientRef) : null,
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

  // Store refresh token and last login in the app-specific fields
  if (app === 'crm') {
    user.refreshTokenCrm = refreshToken;
    user.lastLoginCrm = new Date();
  } else {
    user.refreshTokenAts = refreshToken;
    user.lastLoginAts = new Date();
  }
  await user.save();

  logSignIn('login', String(user._id), app, ip);

  return { user: user.toSafeObject(), accessToken, refreshToken, app };
};

export const logout = async (userId: string, app?: 'ats' | 'crm') => {
  const user = await User.findById(userId);
  if (user) {
    if (app === 'crm') {
      user.refreshTokenCrm = null;
    } else if (app === 'ats') {
      user.refreshTokenAts = null;
    } else {
      // No app specified — clear both
      user.refreshTokenAts = null;
      user.refreshTokenCrm = null;
    }
    await user.save();
  }
};

export const refreshToken = async (
  token: string,
  app: 'ats' | 'crm' = 'ats'
) => {
  let decoded: jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
  } catch {
    throw new AppError(401, 'AUTH_TOKEN_INVALID', 'Invalid refresh token');
  }

  const user = await User.findById(decoded._id);
  if (!user) {
    throw new AppError(401, 'AUTH_TOKEN_INVALID', 'Invalid refresh token');
  }
  // A deactivated user must not keep minting access tokens on a refresh
  // cookie issued before they were deactivated.
  if (!user.isActive) {
    throw new AppError(401, 'USER_INACTIVE', 'Account is deactivated');
  }

  // Check the correct app-specific refresh token
  const storedToken =
    app === 'crm' ? user.refreshTokenCrm : user.refreshTokenAts;
  if (storedToken !== token) {
    throw new AppError(401, 'AUTH_TOKEN_INVALID', 'Invalid refresh token');
  }

  const payload: AuthTokenPayload = {
    _id: String(user._id),
    firstName: user.firstName,
    lastName: user.lastName,
    roles: user.roles,
    appAccess: user.appAccess,
    permissions: user.permissions as unknown as Record<
      string,
      Record<string, boolean>
    >,
    candidateRef: user.candidateRef ? String(user.candidateRef) : null,
    clientRef: user.clientRef ? String(user.clientRef) : null,
  };

  const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn:
      env.JWT_ACCESS_EXPIRES as unknown as jwt.SignOptions['expiresIn'],
  });

  return { user: user.toSafeObject(), accessToken };
};

export const forgotPassword = async (email: string) => {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || !user.isActive) return;

  const resetToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetToken = resetToken;
  user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();

  const resetUrl = `${env.ATS_FRONTEND_URL}/ats/reset-password?token=${resetToken}`;
  await sendEmail({
    to: [user.email],
    subject: 'Reset your Arista ATS password',
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:#1a1a2e;padding:32px 40px;text-align:center;">
              <h1 style="color:#ffffff;font-size:24px;margin:0;font-weight:700;">Arista ATS</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="color:#1a1a2e;font-size:20px;margin:0 0 16px;">Password Reset Request</h2>
              <p style="color:#4a4a5a;font-size:15px;line-height:1.6;margin:0 0 24px;">
                You recently requested to reset your password for your Arista ATS account.
                Click the button below to set a new password:
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
                <tr>
                  <td align="center" style="background-color:#4361ee;border-radius:6px;padding:14px 36px;">
                    <a href="${resetUrl}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">Reset Your Password</a>
                  </td>
                </tr>
              </table>
              <p style="color:#4a4a5a;font-size:14px;line-height:1.5;margin:0 0 8px;">
                Or copy and paste this link into your browser:
              </p>
              <p style="color:#4361ee;font-size:13px;line-height:1.5;margin:0 0 24px;word-break:break-all;">
                ${resetUrl}
              </p>
              <div style="border-top:1px solid #e8e8ec;padding-top:20px;">
                <p style="color:#8a8a9a;font-size:13px;line-height:1.5;margin:0 0 8px;">
                  ⏱ This link expires in <strong>1 hour</strong>.
                </p>
                <p style="color:#8a8a9a;font-size:13px;line-height:1.5;margin:0;">
                  If you did not request this, you can safely ignore this email.
                </p>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#fafafa;padding:24px 40px;text-align:center;">
              <p style="color:#8a8a9a;font-size:12px;margin:0;">
                &copy; ${new Date().getFullYear()} Arista ATS. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  });
};

export const resetPassword = async (token: string, password: string) => {
  // Accept both passwordResetToken (forgot password flow) and inviteToken (invitation flow)
  const user = await User.findOne({
    $or: [
      {
        passwordResetToken: token,
        passwordResetExpires: { $gt: new Date() },
      },
      {
        inviteToken: token,
        inviteTokenExpires: { $gt: new Date() },
      },
    ],
  });
  if (!user) {
    throw new AppError(
      400,
      'AUTH_TOKEN_INVALID',
      'Reset link is invalid or has expired'
    );
  }

  // Only an invitation (issued by an admin) may activate an account. A plain
  // password-reset token must never bring a deactivated user back.
  const viaInvite = user.inviteToken === token;

  user.passwordHash = await bcrypt.hash(password, 12);
  user.passwordResetToken = null;
  user.passwordResetExpires = null;
  user.inviteToken = null;
  user.inviteTokenExpires = null;
  user.emailVerified = true;
  user.isInviteAccepted = true;
  if (viaInvite) user.isActive = true;
  user.refreshTokenAts = null;
  user.refreshTokenCrm = null;
  await user.save();

  createLog({
    action: viaInvite ? 'invite_accepted' : 'password_reset',
    resourceType: 'user',
    resourceId: String(user._id),
    performedBy: String(user._id),
  });
};

export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isMatch) {
    throw new AppError(
      400,
      'AUTH_INVALID_CREDENTIALS',
      'Current password is incorrect'
    );
  }

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.refreshTokenAts = null;
  user.refreshTokenCrm = null;
  await user.save();

  createLog({
    action: 'password_changed',
    resourceType: 'user',
    resourceId: String(user._id),
    performedBy: String(user._id),
  });
};

export const verifyEmail = async (token: string) => {
  const user = await User.findOne({
    inviteToken: token,
    inviteTokenExpires: { $gt: new Date() },
  });
  if (!user) {
    throw new AppError(
      400,
      'AUTH_TOKEN_INVALID',
      'Verification link is invalid or has expired'
    );
  }

  // Mark email as verified and invitation as accepted, but do NOT consume
  // the inviteToken — it's still needed for the subsequent set-password call.
  user.emailVerified = true;
  user.isInviteAccepted = true;
  await user.save();
};

export const setPassword = async (token: string, password: string) => {
  const user = await User.findOne({
    inviteToken: token,
    inviteTokenExpires: { $gt: new Date() },
  });
  if (!user) {
    throw new AppError(
      400,
      'AUTH_TOKEN_INVALID',
      'Invite link is invalid or has expired'
    );
  }

  user.passwordHash = await bcrypt.hash(password, 12);
  user.emailVerified = true;
  user.isInviteAccepted = true;
  user.isActive = true;
  user.inviteToken = null;
  user.inviteTokenExpires = null;
  await user.save();

  createLog({
    action: 'invite_accepted',
    resourceType: 'user',
    resourceId: String(user._id),
    performedBy: String(user._id),
  });
};
