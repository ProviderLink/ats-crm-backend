import { Request, Response } from 'express';
import catchAsync from '../../shared/utils/catchAsync';
import {
  assertOwnsRecord,
  scopeListFilters,
} from '../../shared/utils/crmScope';
import { sendSuccess } from '../../shared/utils/response';
import { assertManagesAssignment, isAccountManagerOnly } from './assignmentScope';
import * as assignmentService from './assignment.service';

export const getAllAssignments = catchAsync(
  async (req: Request, res: Response) => {
    const { candidateId, clientId, accountManagerId, status, page, limit } =
      req.query as Record<string, string | undefined>;
    const user = req.user!;

    // A VA sees only their own assignments, a client only their own
    const scoped = scopeListFilters(user, { candidateId, clientId });

    const result = await assignmentService.getAllAssignments({
      candidateId: scoped.candidateId,
      clientId: scoped.clientId,
      // An account manager only ever lists their own assignments
      accountManagerId: isAccountManagerOnly(user) ? user._id : accountManagerId,
      status,
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    sendSuccess(res, result.assignments, 'Assignments retrieved', 200, {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
);

export const getAssignmentById = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const assignment = await assignmentService.getAssignmentById(id);
    assertOwnsRecord(req.user!, assignment);
    assertManagesAssignment(req.user!, assignment);
    sendSuccess(res, assignment, 'Assignment retrieved', 200);
  }
);

export const createAssignment = catchAsync(
  async (req: Request, res: Response) => {
    const body = req.body;
    const createdBy = req.user!._id;
    // An account manager can only create assignments they will manage
    assertManagesAssignment(req.user!, { accountManagerId: body.accountManagerId });
    const assignment = await assignmentService.createAssignment(
      body,
      createdBy
    );
    sendSuccess(res, assignment, 'Assignment created', 201);
  }
);

export const updateAssignment = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = req.body;
    const updatedBy = req.user!._id;
    const userRoles = req.user!.roles;
    // ...and cannot hand an assignment over to another account manager
    if (body.accountManagerId !== undefined) {
      assertManagesAssignment(req.user!, {
        accountManagerId: body.accountManagerId,
      });
    }
    const assignment = await assignmentService.updateAssignment(
      id,
      body,
      updatedBy,
      userRoles
    );
    sendSuccess(res, assignment, 'Assignment updated', 200);
  }
);

export const endAssignment = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const updatedBy = req.user!._id;
  const userRoles = req.user!.roles;
  const assignment = await assignmentService.endAssignment(
    id,
    updatedBy,
    userRoles
  );
  sendSuccess(res, assignment, 'Assignment ended', 200);
});
