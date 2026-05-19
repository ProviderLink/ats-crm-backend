import { Request, Response } from 'express';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as userService from './user.service';

export const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const {
    role,
    isActive: isActiveRaw,
    page,
    limit,
  } = req.query as Record<string, string | undefined>;

  const isActive =
    isActiveRaw === 'true' ? true : isActiveRaw === 'false' ? false : undefined;

  const result = await userService.getAllUsers({
    role,
    isActive,
    page: page !== undefined ? Number(page) : undefined,
    limit: limit !== undefined ? Number(limit) : undefined,
  });

  sendSuccess(res, result.users, 'Users retrieved', 200, {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
});

export const getUserById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = await userService.getUserById(id);
  sendSuccess(res, user, 'User retrieved', 200);
});

export const createUser = catchAsync(async (req: Request, res: Response) => {
  const body = req.body;
  const createdBy = req.user!._id;
  const { user, inviteToken } = await userService.createUser(body, createdBy);
  sendSuccess(
    res,
    { user, inviteToken },
    'User created successfully. Invite email will be sent.',
    201
  );
});

export const updateUser = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body;
  const user = await userService.updateUser(id, body);
  sendSuccess(res, user, 'User updated', 200);
});

export const deactivateUser = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    if (id === req.user!._id) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'You cannot deactivate your own account'
      );
    }

    const user = await userService.deactivateUser(id);
    sendSuccess(res, user, 'User deactivated', 200);
  }
);

export const updatePermissions = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = req.body;
    const user = await userService.updatePermissions(id, body.permissions);
    sendSuccess(res, user, 'Permissions updated', 200);
  }
);
