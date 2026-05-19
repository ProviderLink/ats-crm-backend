export interface IWorkEntry {
  _id: string;
  assignmentId: string;
  candidateId: string;
  clientId: string;
  entryDate: Date;
  entryTime: string;
  taskCategory: string;
  taskDescription: string;
  timeSpent: number;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkEntryInput {
  assignmentId: string;
  entryDate: Date | string;
  entryTime: string;
  taskCategory: string;
  taskDescription: string;
  timeSpent: number;
  status?: string;
  notes?: string | null;
}

export interface UpdateWorkEntryInput {
  entryDate?: Date | string;
  entryTime?: string;
  taskCategory?: string;
  taskDescription?: string;
  timeSpent?: number;
  status?: string;
  notes?: string | null;
}
