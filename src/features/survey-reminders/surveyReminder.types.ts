export interface ISurveyReminder {
  _id: string;
  relatedType: string;
  relatedId: string;
  surveyType: string;
  dueDate: Date;
  completedDate: Date | null;
  status: string;
  assignedTo: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSurveyReminderInput {
  relatedType: 'client' | 'va' | 'assignment';
  relatedId: string;
  surveyType: string;
  dueDate: Date | string;
  assignedTo: string;
}

export interface UpdateSurveyReminderInput {
  status?: string;
  completedDate?: Date | null;
  dueDate?: Date | string;
  assignedTo?: string;
}
