import mongoose, { Document, Schema, model } from 'mongoose'
import type { IAssignment } from './assignment.types'

export interface IAssignmentDocument
  extends Omit<IAssignment, '_id' | 'candidateId' | 'clientId' | 'accountManagerId' | 'createdBy' | 'updatedBy'>,
    Document {
  candidateId: mongoose.Types.ObjectId
  clientId: mongoose.Types.ObjectId
  accountManagerId: mongoose.Types.ObjectId
  createdBy: mongoose.Types.ObjectId | null
  updatedBy: mongoose.Types.ObjectId | null
  toSafeObject(): IAssignment
}

const assignmentSchema = new Schema(
  {
    candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    status: {
      type: String,
      enum: ['active', 'on_hold', 'ended'],
      default: 'active',
    },
    serviceType: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    accountManagerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

assignmentSchema.index({ candidateId: 1 })
assignmentSchema.index({ clientId: 1 })
assignmentSchema.index({ status: 1 })
assignmentSchema.index({ candidateId: 1, clientId: 1 })
assignmentSchema.index({ accountManagerId: 1 })
assignmentSchema.index({ createdAt: -1 })

assignmentSchema.methods.toSafeObject = function (): IAssignment {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>
  raw['_id'] = String(raw['_id'])
  raw['candidateId'] = String(raw['candidateId'])
  raw['clientId'] = String(raw['clientId'])
  raw['accountManagerId'] = String(raw['accountManagerId'])
  raw['createdBy'] = raw['createdBy'] ? String(raw['createdBy']) : null
  raw['updatedBy'] = raw['updatedBy'] ? String(raw['updatedBy']) : null
  return raw as unknown as IAssignment
}

export default model<IAssignmentDocument>('Assignment', assignmentSchema)
