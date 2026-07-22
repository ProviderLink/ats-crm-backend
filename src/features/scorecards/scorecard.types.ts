export interface IScorecard {
  _id: string;
  vaId: string;
  assignmentId: string;
  weekStart: Date;
  weekEnd: Date;
  totalHours: number;
  totalTasksCompleted: number;
  avgTasksPerDay: number;
  eodComplianceRate: number;
  onTimeSubmissionRate: number;
  productivityScore: number;
  categoryDistribution: Record<string, number>;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
