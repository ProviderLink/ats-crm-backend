import mongoose from 'mongoose';
import { connectDB } from '../config/db';
import DispositionReason from '../features/disposition-reasons/dispositionReason.model';
import logger from '../shared/utils/logger';

interface SeedReason {
  label: string;
  category: string;
  order: number;
  defaultEligibility: 'eligible' | 'permanently_ineligible';
}

const seedReasons: SeedReason[] = [
  // ── Experience and Qualifications ──
  {
    label: 'Insufficient overall experience',
    category: 'experience_and_qualifications',
    order: 0,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Insufficient healthcare experience',
    category: 'experience_and_qualifications',
    order: 1,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Insufficient medical practice experience',
    category: 'experience_and_qualifications',
    order: 2,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Insufficient BPO experience',
    category: 'experience_and_qualifications',
    order: 3,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Insufficient role-specific experience',
    category: 'experience_and_qualifications',
    order: 4,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Missing required technical skills',
    category: 'experience_and_qualifications',
    order: 5,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Missing required education or credentials',
    category: 'experience_and_qualifications',
    order: 6,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Experience could not be verified',
    category: 'experience_and_qualifications',
    order: 7,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Candidate does not meet minimum job requirements',
    category: 'experience_and_qualifications',
    order: 8,
    defaultEligibility: 'eligible',
  },

  // ── Interview Performance ──
  {
    label: 'Communication skills did not meet requirements',
    category: 'interview_performance',
    order: 0,
    defaultEligibility: 'eligible',
  },
  {
    label: 'English proficiency did not meet requirements',
    category: 'interview_performance',
    order: 1,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Interview responses lacked sufficient detail',
    category: 'interview_performance',
    order: 2,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Candidate was unable to explain previous responsibilities',
    category: 'interview_performance',
    order: 3,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Professionalism concerns',
    category: 'interview_performance',
    order: 4,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Candidate was not prepared for the interview',
    category: 'interview_performance',
    order: 5,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Technology or internet concerns',
    category: 'interview_performance',
    order: 6,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Work environment did not meet requirements',
    category: 'interview_performance',
    order: 7,
    defaultEligibility: 'eligible',
  },

  // ── Availability and Employment Requirements ──
  {
    label: 'Schedule mismatch',
    category: 'availability_and_employment',
    order: 0,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Time-zone availability mismatch',
    category: 'availability_and_employment',
    order: 1,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Compensation mismatch',
    category: 'availability_and_employment',
    order: 2,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Start-date mismatch',
    category: 'availability_and_employment',
    order: 3,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Full-time or part-time availability mismatch',
    category: 'availability_and_employment',
    order: 4,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Unable to meet required working hours',
    category: 'availability_and_employment',
    order: 5,
    defaultEligibility: 'eligible',
  },

  // ── Recruiter or Client Selection ──
  {
    label: 'Stronger candidate selected',
    category: 'recruiter_or_client_selection',
    order: 0,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Client selected another candidate',
    category: 'recruiter_or_client_selection',
    order: 1,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Client did not approve the candidate',
    category: 'recruiter_or_client_selection',
    order: 2,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Candidate did not meet client expectations',
    category: 'recruiter_or_client_selection',
    order: 3,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Candidate was not selected after Initial Zoom',
    category: 'recruiter_or_client_selection',
    order: 4,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Candidate was not selected after Client Interview',
    category: 'recruiter_or_client_selection',
    order: 5,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Position requirements changed',
    category: 'recruiter_or_client_selection',
    order: 6,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Position was filled',
    category: 'recruiter_or_client_selection',
    order: 7,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Position was cancelled or placed on hold',
    category: 'recruiter_or_client_selection',
    order: 8,
    defaultEligibility: 'eligible',
  },

  // ── Candidate Actions ──
  {
    label: 'Candidate withdrew',
    category: 'candidate_actions',
    order: 0,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Candidate declined to continue',
    category: 'candidate_actions',
    order: 1,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Candidate stopped responding',
    category: 'candidate_actions',
    order: 2,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Candidate missed the interview',
    category: 'candidate_actions',
    order: 3,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Candidate declined the offer',
    category: 'candidate_actions',
    order: 4,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Candidate accepted another position',
    category: 'candidate_actions',
    order: 5,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Candidate did not complete required screening',
    category: 'candidate_actions',
    order: 6,
    defaultEligibility: 'eligible',
  },
  {
    label: 'Candidate did not provide required documentation',
    category: 'candidate_actions',
    order: 7,
    defaultEligibility: 'eligible',
  },

  // ── Permanently Ineligible Reasons ──
  {
    label: 'Resume falsification',
    category: 'permanently_ineligible_reasons',
    order: 0,
    defaultEligibility: 'permanently_ineligible',
  },
  {
    label: 'False employment history',
    category: 'permanently_ineligible_reasons',
    order: 1,
    defaultEligibility: 'permanently_ineligible',
  },
  {
    label: 'False credentials',
    category: 'permanently_ineligible_reasons',
    order: 2,
    defaultEligibility: 'permanently_ineligible',
  },
  {
    label: 'Identity verification concern',
    category: 'permanently_ineligible_reasons',
    order: 3,
    defaultEligibility: 'permanently_ineligible',
  },
  {
    label: 'Fraudulent documentation',
    category: 'permanently_ineligible_reasons',
    order: 4,
    defaultEligibility: 'permanently_ineligible',
  },
  {
    label: 'Serious dishonesty during recruitment',
    category: 'permanently_ineligible_reasons',
    order: 5,
    defaultEligibility: 'permanently_ineligible',
  },
  {
    label: 'Harassment or threatening behavior',
    category: 'permanently_ineligible_reasons',
    order: 6,
    defaultEligibility: 'permanently_ineligible',
  },
  {
    label: 'Serious confidentiality concern',
    category: 'permanently_ineligible_reasons',
    order: 7,
    defaultEligibility: 'permanently_ineligible',
  },
  {
    label: 'Serious security concern',
    category: 'permanently_ineligible_reasons',
    order: 8,
    defaultEligibility: 'permanently_ineligible',
  },
  {
    label: 'Previous termination for misconduct',
    category: 'permanently_ineligible_reasons',
    order: 9,
    defaultEligibility: 'permanently_ineligible',
  },
  {
    label: 'Repeated offer acceptance followed by job abandonment',
    category: 'permanently_ineligible_reasons',
    order: 10,
    defaultEligibility: 'permanently_ineligible',
  },
  {
    label: 'Other serious policy violation',
    category: 'permanently_ineligible_reasons',
    order: 11,
    defaultEligibility: 'permanently_ineligible',
  },
];

export async function seedDispositionReasons(): Promise<void> {
  for (const reason of seedReasons) {
    const exists = await DispositionReason.findOne({
      label: reason.label,
      category: reason.category,
    });
    if (!exists) {
      await DispositionReason.create(reason);
    }
  }
}

/**
 * CLI entry point: `pnpm seed:disposition-reasons`
 *
 * Guarded by `require.main` so the module can also be imported (e.g. from the
 * startup chain in `app.ts`) without opening a second connection.
 *
 * Idempotent — each reason is matched on (label, category), so a re-run only
 * inserts what is missing. It never duplicates a reason and never overwrites
 * one that has been edited in Settings.
 */
if (require.main === module) {
  (async () => {
    await connectDB();
    const before = await DispositionReason.countDocuments();
    await seedDispositionReasons();
    const after = await DispositionReason.countDocuments();
    logger.info('Disposition reasons seeded', {
      before,
      after,
      inserted: after - before,
    });
    await mongoose.disconnect();
  })().catch(err => {
    logger.error('Disposition reasons seed failed', err);
    process.exit(1);
  });
}
