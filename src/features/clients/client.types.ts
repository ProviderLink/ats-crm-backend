export interface ClientContact {
  _id: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  isPrimary: boolean;
}

export type ClientNoteMethod =
  | 'call'
  | 'email'
  | 'meeting'
  | 'message'
  | 'other';

export interface ClientNote {
  _id: string;
  method: ClientNoteMethod;
  content: string;
  author: string | null; // User id
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateClientNoteInput {
  method: ClientNoteMethod;
  content: string;
}

export interface UpdateClientNoteInput {
  method?: ClientNoteMethod;
  content?: string;
}

export interface ClientAddress {
  street: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export interface ClientCrmProfile {
  healthStatus: string; // 'green' | 'yellow' | 'red'
  baaSign: boolean;
  baaSignedDate: Date | null;
  emrSystem: string;
  onboardingComplete: boolean;
  sopReceived: boolean;
  satisfactionScore: number; // 1-5
  openIssuesCount: number;
  lastClientCheckin: Date | null;
  notes: string;
}

export interface IClient {
  _id: string;
  companyName: string;
  email: string;
  phone: string;
  website: string;
  logo: string;
  industry: string;
  companySize: string;
  status: string;
  description: string;
  address: ClientAddress;
  contacts: ClientContact[];
  notes: ClientNote[];
  tags: string[];
  crmProfile: ClientCrmProfile | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateClientInput {
  companyName: string;
  email: string;
  phone?: string;
  website?: string;
  industry?: string;
  companySize?: string;
  description?: string;
  address?: Partial<ClientAddress>;
}

export interface UpdateClientInput {
  companyName?: string;
  email?: string;
  phone?: string;
  website?: string;
  logo?: string;
  industry?: string;
  companySize?: string;
  status?: string;
  description?: string;
  address?: Partial<ClientAddress>;
  tags?: string[];
}

export interface CreateContactInput {
  name: string;
  email: string;
  phone?: string;
  position?: string;
  isPrimary?: boolean;
}

export interface UpdateContactInput {
  name?: string;
  email?: string;
  phone?: string;
  position?: string;
  isPrimary?: boolean;
}
