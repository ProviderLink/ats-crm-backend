export interface ITag {
  _id: string;
  name: string;
  color: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTagInput {
  name: string;
  color: string;
}

export interface UpdateTagInput {
  name?: string;
  color?: string;
}
