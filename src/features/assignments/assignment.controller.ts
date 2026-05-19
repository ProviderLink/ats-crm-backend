import { Request, Response } from 'express'
import catchAsync from '../../shared/utils/catchAsync'
import { sendSuccess } from '../../shared/utils/response'
import * as assignmentService from './assignment.service'

export const getAllAssignments = catchAsync(async (req: Request, res: Response) => {
  const { candidateId, clientId, accountManagerId, status, page, limit } = req.query as Record<
    string,
    string | undefined
  >
  const result = await assignmentService.getAllAssignments({
    candidateId,
    clientId,
    accountManagerId,
    status,
    page: page !== undefined ? Number(page) : undefined,
    limit: limit !== undefined ? Number(limit) : undefined,
  })
  sendSuccess(res, result.assignments, 'Assignments retrieved', 200, {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  })
})

export const getAssignmentById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const assignment = await assignmentService.getAssignmentById(id)
  sendSuccess(res, assignment, 'Assignment retrieved', 200)
})

export const createAssignment = catchAsync(async (req: Request, res: Response) => {
  const body = req.body
  const createdBy = req.user!._id
  const assignment = await assignmentService.createAssignment(body, createdBy)
  sendSuccess(res, assignment, 'Assignment created', 201)
})

export const updateAssignment = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const body = req.body
  const updatedBy = req.user!._id
  const assignment = await assignmentService.updateAssignment(id, body, updatedBy)
  sendSuccess(res, assignment, 'Assignment updated', 200)
})

export const endAssignment = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params
  const updatedBy = req.user!._id
  const assignment = await assignmentService.endAssignment(id, updatedBy)
  sendSuccess(res, assignment, 'Assignment ended', 200)
})
