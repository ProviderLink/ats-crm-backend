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
  /**
   * The company business day, serialised to clients as `YYYY-MM-DD`.
   *
   * Internally the persisted `date` is the UTC instant at which that company
   * day began, and `dateKey` holds the day itself. The wire type stays a plain
   * date string so consumers format it without timezone drift.
   */
  date: string; // 'YYYY-MM-DD' (company business day)
  /** Company business day as `YYYY-MM-DD` — same value as `date`. */
  dateKey: string;
  /** IANA timezone that defined the business day (audit field). */
  dateTimezone: string | null;
  /** Company-local wall clock, `HH:MM`. */
  shiftStart: string;
  shiftEnd: string;
  /** Derived server-side from `shiftStart`/`shiftEnd`. */
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
  createdAt: string;
  updatedAt: string;
}

export interface CreateEodSubmissionInput {
  assignmentId: string;
  /**
   * Company business day, `YYYY-MM-DD`.
   *
   * Optional on purpose: when omitted the server resolves the company's current
   * day from the configured timezone. Clients are encouraged to omit it, so a VA
   * working from another timezone cannot file against the wrong day.
   */
  date?: string;
  shiftStart: string;
  shiftEnd: string;
  /**
   * Accepted but ignored — the server recomputes hours from the shift times so
   * the stored value is always consistent with the company clock.
   */
  hoursWorked?: number;
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
