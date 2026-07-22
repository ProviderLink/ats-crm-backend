export interface IVaProfile {
  _id: string;
  vaId: string;
  workloadLevel: string;
  satisfactionScore: number | null;
  burnoutRiskFlag: boolean;
  replacementRiskFlag: boolean;
  lastVaCheckin: Date | null;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateVaProfileInput {
  workloadLevel?: string;
  satisfactionScore?: number;
  burnoutRiskFlag?: boolean;
  replacementRiskFlag?: boolean;
  lastVaCheckin?: string | null;
  notes?: string;
}
