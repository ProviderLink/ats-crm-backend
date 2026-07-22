export interface IClientAccount {
  id: string;
  clientId: string;
  companyName: string;
  accountOwnerId: string | null;
  serviceStartDate: Date | null;
  emrSystem: string;
  baaSigned: boolean;
  baaSignedDate: Date | null;
  onboardingComplete: boolean;
  sopReceived: boolean;
  primaryContact: string;
  secondaryContact: string;
  lastClientCheckin: Date | null;
  satisfactionScore: number | null;
  healthStatus: string;
  openIssuesCount: number;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateClientAccountInput {
  healthStatus?: string;
  baaSigned?: boolean;
  baaSignedDate?: string | null;
  emrSystem?: string;
  onboardingComplete?: boolean;
  sopReceived?: boolean;
  satisfactionScore?: number;
  openIssuesCount?: number;
  lastClientCheckin?: string | null;
  notes?: string;
  accountOwnerId?: string | null;
  serviceStartDate?: string | null;
  primaryContact?: string;
  secondaryContact?: string;
}
