export interface IEodReminder {
  _id: string;
  assignmentId: string;
  candidateId: string;
  reminderDate: Date;
  reminderType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEodReminderInput {
  assignmentId: string;
  candidateId: string;
  reminderDate: Date;
  reminderType: string;
  status: string;
}
