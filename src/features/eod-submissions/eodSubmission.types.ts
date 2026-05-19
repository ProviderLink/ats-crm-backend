export interface IEodSubmission {
  _id: string;
  assignmentId: string;
  candidateId: string;
  clientId: string;
  date: Date;
  shiftStart: string;
  shiftEnd: string;
  hoursWorked: number;
  summaryOfWork: string;
  pendingTasks: string;
  blockers: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEodSubmissionInput {
  assignmentId: string;
  date: Date | string;
  shiftStart: string;
  shiftEnd: string;
  hoursWorked: number;
  summaryOfWork: string;
  pendingTasks: string;
  blockers?: string | null;
  notes?: string | null;
}

export interface UpdateEodSubmissionInput {
  shiftStart?: string;
  shiftEnd?: string;
  hoursWorked?: number;
  summaryOfWork?: string;
  pendingTasks?: string;
  blockers?: string | null;
  notes?: string | null;
}
