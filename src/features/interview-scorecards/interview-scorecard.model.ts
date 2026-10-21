import mongoose, { Document, model, Schema } from 'mongoose';
import type { IInterviewScorecard } from './interview-scorecard.types';
import {
  EXPERIENCE_SELECTIONS,
  FINAL_RECOMMENDATIONS,
  INTERVIEW_TYPES,
} from './interview-scorecard.types';

export interface IInterviewScorecardDocument
  extends
    Omit<
      IInterviewScorecard,
      '_id' | 'candidateId' | 'jobId' | 'interviewId' | 'interviewerId' | 'createdBy'
    >,
    Document {
  candidateId: mongoose.Types.ObjectId;
  jobId: mongoose.Types.ObjectId;
  interviewId: mongoose.Types.ObjectId | null;
  interviewerId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId | null;
  toSafeObject(): IInterviewScorecard;
}

const interviewScorecardSchema = new Schema(
  {
    candidateId: {
      type: Schema.Types.ObjectId,
      ref: 'Candidate',
      required: true,
    },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    // The calendar interview this scorecard is for. Null for scorecards that
    // predate the link or cover an interview held outside the calendar.
    interviewId: { type: Schema.Types.ObjectId, ref: 'Interview', default: null },
    interviewerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    interviewDate: { type: Date, required: true },
    interviewType: {
      type: String,
      enum: INTERVIEW_TYPES,
      required: true,
    },

    // ── Category 1: Communication (weight 30) ──
    commEnglishDiction: { type: Number, min: 1, max: 5, required: true },
    commEnglishComprehension: { type: Number, min: 1, max: 5, required: true },
    // SERVER-COMPUTED on save — see interview-scorecard.service.ts
    communicationRating: { type: Number, min: 1, max: 5, required: true },

    // ── Category 2: Relevant Experience (weight 25) ──
    experienceSelections: {
      type: [String],
      enum: EXPERIENCE_SELECTIONS,
      default: [],
    },
    experienceRating: { type: Number, min: 1, max: 5, required: true },
    // Free-form, interviewer-editable tags (older docs lack them)
    emrTags: { type: [String], default: [] },
    specialtyTags: { type: [String], default: [] },

    // ── Category 3: Professionalism (weight 15) ──
    profPreparedOnTime: { type: Boolean, required: true },
    profAppearanceDemeanor: { type: Boolean, required: true },
    profAttitudeReliability: { type: Boolean, required: true },
    profInterestInPosition: { type: Boolean, required: true },
    professionalismRating: { type: Number, min: 1, max: 5, required: true },

    // ── Category 4: Office & Technology Setup (weight 20) ──
    techInternetSpeed: { type: Boolean, required: true },
    techHeadsetNoiseCancelling: { type: Boolean, required: true },
    techTwoScreens: { type: Boolean, required: true },
    techBackupInternet: { type: Boolean, required: true },
    techBackupGenerator: { type: Boolean, required: true },
    // Free-text internet speed (e.g. "100 Mbps"); optional, older docs lack it
    techInternetSpeedValue: { type: String, default: '' },
    technologyRating: { type: Number, min: 1, max: 5, required: true },

    // ── Category 5: Availability & Overall Fit (weight 10) ──
    availUsHours: { type: Boolean, required: true },
    availCompensationAcceptable: { type: Boolean, required: true },
    availStartAvailability: { type: Boolean, required: true },
    availOverallFit: { type: Boolean, required: true },
    availabilityRating: { type: Number, min: 1, max: 5, required: true },

    // ── Per-category notes (optional; older docs lack them) ──
    commNotes: { type: String, default: '' },
    experienceNotes: { type: String, default: '' },
    professionalismNotes: { type: String, default: '' },
    technologyNotes: { type: String, default: '' },
    availabilityNotes: { type: String, default: '' },

    // ── Server-computed weighted scores (always recomputed on save) ──
    communicationWeighted: { type: Number, required: true },
    experienceWeighted: { type: Number, required: true },
    professionalismWeighted: { type: Number, required: true },
    technologyWeighted: { type: Number, required: true },
    availabilityWeighted: { type: Number, required: true },
    overallScore: { type: Number, required: true },

    // ── Interview notes ──
    strengths: { type: String, default: '' },
    concerns: { type: String, default: '' },
    generalNotes: { type: String, default: '' },
    recommendedPosition: { type: String, default: '' },
    earliestStartDate: { type: Date, default: null },
    compensationExpectation: { type: String, default: '' },

    // ── Final recommendation (REQUIRED) ──
    finalRecommendation: {
      type: String,
      enum: FINAL_RECOMMENDATIONS,
      required: true,
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

interviewScorecardSchema.index({ candidateId: 1, createdAt: -1 });
interviewScorecardSchema.index({ jobId: 1 });
interviewScorecardSchema.index({ interviewId: 1 });

interviewScorecardSchema.methods.toSafeObject =
  function (): IInterviewScorecard {
    const raw = this.toObject({ versionKey: false }) as Record<string, unknown>;
    raw['_id'] = String(raw['_id']);
    raw['candidateId'] = String(raw['candidateId']);
    raw['jobId'] = String(raw['jobId']);
    raw['interviewId'] = raw['interviewId'] ? String(raw['interviewId']) : null;
    raw['interviewerId'] = String(raw['interviewerId']);
    raw['createdBy'] = raw['createdBy'] ? String(raw['createdBy']) : null;
    return raw as unknown as IInterviewScorecard;
  };

export default model<IInterviewScorecardDocument>(
  'InterviewScorecard',
  interviewScorecardSchema
);
