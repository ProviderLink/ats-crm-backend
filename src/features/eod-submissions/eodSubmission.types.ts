export type EodWorkStatus = 'completed' | 'in_progress' | 'pending';

export type CommunicatedWithClient = 'yes' | 'no' | 'other';

export interface IEodWorkEntry {
  task: string;
  description: string;
  quantity: number;
  status: EodWorkStatus;
  timeSpent: number; // minutes
}

export interface IEodSubmission {
  _id: string;
  assignmentId: string;
  candidateId: string;
  clientId: string;
  date: Date;
  shiftStart: string;
  shiftEnd: string;
  hoursWorked: number;
  summaryOfWork?: string | null; // legacy free-text; preserved for historical records
  workEntries?: IEodWorkEntry[]; // structured per-work entries (new submissions)
  pendingTasks: string;
  blockers: string | null;
  notes: string | null;
  // Q2: Did you communicate with the client today? (boss EOD export)
  communicatedWithClient?: CommunicatedWithClient | null;
  // Q3: Additional notes/updates the VA wants the client to know (boss EOD export)
  clientNote?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEodSubmissionInput {
  assignmentId: string;
  date: Date | string;
  shiftStart: string;
  shiftEnd: string;
  hoursWorked: number;
  summaryOfWork?: string | null; // legacy; optional when workEntries is provided
  workEntries?: IEodWorkEntry[];
  pendingTasks: string;
  blockers?: string | null;
  notes?: string | null;
  communicatedWithClient?: CommunicatedWithClient | null;
  clientNote?: string | null;
}

export interface UpdateEodSubmissionInput {
  shiftStart?: string;
  shiftEnd?: string;
  hoursWorked?: number;
  summaryOfWork?: string | null;
  workEntries?: IEodWorkEntry[];
  pendingTasks?: string;
  blockers?: string | null;
  notes?: string | null;
  communicatedWithClient?: CommunicatedWithClient | null;
  clientNote?: string | null;
}
