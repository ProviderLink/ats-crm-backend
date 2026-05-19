import { Request, Response } from 'express';
import {
  deleteFromCloudinary,
  uploadToCloudinary,
} from '../../config/cloudinary';
import AppError from '../../shared/utils/AppError';
import catchAsync from '../../shared/utils/catchAsync';
import { sendSuccess } from '../../shared/utils/response';
import * as clientService from './client.service';

function extractPublicIdFromUrl(url: string): string | null {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
  return match ? match[1] : null;
}

export const getAllClients = catchAsync(async (req: Request, res: Response) => {
  const { status, search, page, limit } = req.query as Record<
    string,
    string | undefined
  >;
  const result = await clientService.getAllClients({
    status,
    search,
    page: page !== undefined ? Number(page) : undefined,
    limit: limit !== undefined ? Number(limit) : undefined,
  });
  sendSuccess(res, result.clients, 'Clients retrieved', 200, {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
});

export const getClientById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await clientService.getClientById(id);
  sendSuccess(res, client, 'Client retrieved', 200);
});

export const createClient = catchAsync(async (req: Request, res: Response) => {
  const body = req.body;
  const createdBy = req.user!._id;
  const client = await clientService.createClient(body, createdBy);
  sendSuccess(res, client, 'Client created', 201);
});

export const updateClient = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = req.body;
  const updatedBy = req.user!._id;
  const client = await clientService.updateClient(id, body, updatedBy);
  sendSuccess(res, client, 'Client updated', 200);
});

export const deleteClient = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  await clientService.deleteClient(id);
  sendSuccess(res, { deleted: true }, 'Client deleted', 200);
});

export const uploadLogo = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new AppError(400, 'VALIDATION_ERROR', 'No file provided');
  }
  const { id } = req.params;
  const updatedBy = req.user!._id;
  const client = await clientService.getClientById(id);
  const { url } = await uploadToCloudinary(req.file, 'logos');
  if (client.logo) {
    const oldPublicId = extractPublicIdFromUrl(client.logo);
    if (oldPublicId) {
      await deleteFromCloudinary(oldPublicId, 'image');
    }
  }
  const updatedClient = await clientService.updateClient(
    id,
    { logo: url },
    updatedBy
  );
  sendSuccess(res, updatedClient, 'Logo uploaded', 200);
});

export const addContact = catchAsync(async (req: Request, res: Response) => {
  const clientId = req.params.id;
  const body = req.body;
  const updatedBy = req.user!._id;
  const client = await clientService.addContact(clientId, body, updatedBy);
  sendSuccess(res, client, 'Contact added', 201);
});

export const updateContact = catchAsync(async (req: Request, res: Response) => {
  const clientId = req.params.id;
  const { contactId } = req.params;
  const body = req.body;
  const updatedBy = req.user!._id;
  const client = await clientService.updateContact(
    clientId,
    contactId,
    body,
    updatedBy
  );
  sendSuccess(res, client, 'Contact updated', 200);
});

export const deleteContact = catchAsync(async (req: Request, res: Response) => {
  const clientId = req.params.id;
  const { contactId } = req.params;
  const updatedBy = req.user!._id;
  const client = await clientService.removeContact(
    clientId,
    contactId,
    updatedBy
  );
  sendSuccess(res, client, 'Contact deleted', 200);
});

export const updateCrmProfile = catchAsync(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const body = req.body;
    const updatedBy = req.user!._id;
    const client = await clientService.updateCrmProfile(id, body, updatedBy);
    sendSuccess(res, client, 'CRM profile updated', 200);
  }
);
