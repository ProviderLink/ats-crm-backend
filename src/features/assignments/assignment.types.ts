export interface IAssignment {
  _id: string;
  candidateId: string;
  clientId: string;
  status: string;
  serviceType: string;
  startDate: Date;
  endDate: Date | null;
  accountManagerId: string;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAssignmentInput {
  candidateId: string;
  clientId: string;
  serviceType: string;
  startDate: Date | string;
  endDate?: Date | string | null;
  accountManagerId: string;
  status?: string;
  jobId?: string;
  notes?: string | null;
}

export interface UpdateAssignmentInput {
  serviceType?: string;
  startDate?: Date | string;
  endDate?: Date | string | null;
  accountManagerId?: string;
  status?: string;
  notes?: string | null;
}
