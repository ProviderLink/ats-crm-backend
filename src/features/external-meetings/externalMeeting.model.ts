import mongoose, { Document, model, Schema } from 'mongoose';
import type { IExternalMeeting } from './externalMeeting.types';
import {
  EXTERNAL_MEETING_STATUSES,
  EXTERNAL_MEETING_TYPES,
} from './externalMeeting.types';

export interface IExternalMeetingDocument
  extends
    Omit<IExternalMeeting, '_id' | 'kind' | 'attendeeIds' | 'organizerId'>,
    Document {
  attendeeIds: mongoose.Types.ObjectId[];
  organizerId: mongoose.Types.ObjectId;
  toSafeObject(): IExternalMeeting;
}

const meetingDetailsSchema = new Schema(
  {
    link: { type: String, default: null },
    meetingId: { type: String, default: null },
    password: { type: String, default: null },
    phoneNumber: { type: String, default: null },
    address: { type: String, default: null },
  },
  { _id: false }
);

const externalMeetingSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    personName: { type: String, required: true, trim: true },
    personEmail: { type: String, default: null, trim: true, lowercase: true },
    personPhone: { type: String, default: null, trim: true },
    jobLabel: { type: String, default: null, trim: true },
    type: { type: String, enum: EXTERNAL_MEETING_TYPES, required: true },
    status: {
      type: String,
      enum: EXTERNAL_MEETING_STATUSES,
      default: 'scheduled',
    },
    scheduledAt: { type: Date, required: true },
    duration: { type: Number, required: true },
    timezone: { type: String, required: true },
    meetingDetails: { type: meetingDetailsSchema, default: () => ({}) },
    notes: { type: String, default: null, trim: true },
    attendeeIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    organizerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

externalMeetingSchema.index({ scheduledAt: -1 });
externalMeetingSchema.index({ status: 1 });
externalMeetingSchema.index({ attendeeIds: 1 });

externalMeetingSchema.methods.toSafeObject = function (): IExternalMeeting {
  const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
  raw['_id'] = String(raw['_id']);
  raw['kind'] = 'external';
  raw['organizerId'] = String(raw['organizerId']);
  raw['attendeeIds'] = Array.isArray(raw['attendeeIds'])
    ? (raw['attendeeIds'] as mongoose.Types.ObjectId[]).map(String)
    : [];
  return raw as unknown as IExternalMeeting;
};

export default model<IExternalMeetingDocument>(
  'ExternalMeeting',
  externalMeetingSchema
);
