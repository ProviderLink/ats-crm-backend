import mongoose from 'mongoose';
import EodSubmission, {
  type IEodSubmissionDocument,
} from '../eod-submissions/eodSubmission.model';
import WorkEntry from '../work-entries/workEntry.model';

export interface WorkActivity {
  totalMinutes: number;
  tasksCompleted: number;
  categoryDistribution: Record<string, number>;
  eods: IEodSubmissionDocument[];
}

/**
 * What a VA did on some assignments between two company days (inclusive).
 *
 * Work is usually logged as work entries and summarised in the EOD. A day that
 * has work entries counts those; a day with only an EOD counts the EOD, so a VA
 * who reports only there is not shown as having done nothing, and no day is
 * ever counted twice.
 */
export async function loadWorkActivity(
  assignmentIds: mongoose.Types.ObjectId[],
  fromKey: string,
  toKey: string
): Promise<WorkActivity> {
  const [workEntries, eods] = await Promise.all([
    // entryDate holds the chosen day at UTC midnight.
    WorkEntry.find({
      assignmentId: { $in: assignmentIds },
      isDeleted: { $ne: true },
      entryDate: {
        $gte: new Date(`${fromKey}T00:00:00.000Z`),
        $lte: new Date(`${toKey}T23:59:59.999Z`),
      },
    }),
    EodSubmission.find({
      assignmentId: { $in: assignmentIds },
      dateKey: { $gte: fromKey, $lte: toKey },
    }),
  ]);

  let totalMinutes = 0;
  let tasksCompleted = 0;
  const categoryDistribution: Record<string, number> = {};
  const count = (category: string) => {
    categoryDistribution[category] = (categoryDistribution[category] ?? 0) + 1;
  };

  const loggedDays = new Set<string>();
  for (const entry of workEntries) {
    const day = entry.entryDate.toISOString().slice(0, 10);
    loggedDays.add(`${entry.assignmentId}:${day}`);
    totalMinutes += entry.timeSpent ?? 0;
    if (entry.status === 'completed') tasksCompleted++;
    count(entry.taskCategory ?? 'Other');
  }

  for (const eod of eods) {
    if (loggedDays.has(`${eod.assignmentId}:${eod.dateKey}`)) continue;
    const entries = eod.workEntries ?? [];
    if (entries.length === 0) {
      // Older reports have only a free-text summary and the shift length.
      totalMinutes += (eod.hoursWorked ?? 0) * 60;
      continue;
    }
    for (const entry of entries) {
      totalMinutes += entry.timeSpent ?? 0;
      if (entry.status === 'completed') tasksCompleted++;
      count('Other');
    }
  }

  return { totalMinutes, tasksCompleted, categoryDistribution, eods };
}
