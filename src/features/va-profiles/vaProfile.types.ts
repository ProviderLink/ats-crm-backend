export interface IVaNote {
  _id: string;
  method: 'call' | 'email' | 'meeting' | 'message' | 'other';
  content: string;
  author: string | null; // User id
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateVaNoteInput {
  method: IVaNote['method'];
  content: string;
}

export interface IVaProfile {
  _id: string;
  vaId: string;
  workloadLevel: string;
  satisfactionScore: number | null;
  burnoutRiskFlag: boolean;
  replacementRiskFlag: boolean;
  lastVaCheckin: Date | null;
  notes: string;
  noteThread?: IVaNote[];
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
