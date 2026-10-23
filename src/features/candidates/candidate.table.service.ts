import Application from '../applications/application.model';
import Client from '../clients/client.model';
import Job from '../jobs/job.model';
import Candidate from './candidate.model';
import { toListCandidate } from './candidate.service';
import type { ICandidate } from './candidate.types';

/**
 * Server-side filtering, sorting and paging for the Candidates page.
 *
 * This is a literal port of the rules the browser used to apply over the full
 * candidate list (tab membership, job filter, search, sort), so the page shows
 * exactly the same rows. Only slim fields are read from the database and only
 * one page of full rows is returned.
 */

export type TableTab = 'pending' | 'approved' | 'hired';
export type TableSort =
  | 'newest'
  | 'oldest'
  | 'a_z'
  | 'z_a'
  | 'highest_score'
  | 'lowest_score';

export interface TableQuery {
  tab: TableTab;
  jobId?: string;
  q?: string;
  sort: TableSort;
  page: number;
  limit: number;
}

interface SlimCandidate {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  inTalentPool: boolean;
  appliedJobId: string | null;
  createdAt: number;
  score: number;
  skills: string[];
  role: { title?: string; company?: string } | null;
}

interface SlimApp {
  candidateId: string;
  jobId: string;
  phase: string;
}

/** Epoch ms of a stored date; missing or unparseable sorts as oldest. */
const toTime = (v: unknown): number => {
  if (!v) return Number.NEGATIVE_INFINITY;
  const t = new Date(v as string | number | Date).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};
const time = (t: number) => t;

async function loadSlimCandidates(): Promise<SlimCandidate[]> {
  const rows = await Candidate.aggregate([
    { $match: { eligibilityStatus: { $ne: 'permanently_ineligible' } } },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        firstName: 1,
        lastName: 1,
        email: 1,
        phone: 1,
        status: 1,
        inTalentPool: 1,
        appliedJobId: 1,
        createdAt: 1,
        aiScore: '$aiScore.score',
        valScore: '$aiValidation.score',
        skills: '$parsedData.skills',
        role: { $arrayElemAt: ['$parsedData.experience', 0] },
      },
    },
  ]);
  return rows.map(r => ({
    _id: String(r._id),
    firstName: r.firstName ?? '',
    lastName: r.lastName ?? '',
    email: r.email ?? '',
    phone: r.phone ?? '',
    status: r.status || 'pending',
    inTalentPool: !!r.inTalentPool,
    appliedJobId: r.appliedJobId ? String(r.appliedJobId) : null,
    createdAt: toTime(r.createdAt),
    score: r.aiScore ?? r.valScore ?? -1,
    skills: Array.isArray(r.skills) ? r.skills : [],
    role: r.role ?? null,
  }));
}

export interface TableData {
  candidates: SlimCandidate[];
  apps: SlimApp[];
  jobs: Map<string, { title: string; clientId: string }>;
  clientNames: Map<string, string>;
}

export async function loadTableData(): Promise<TableData> {
  const [candidates, apps, jobs, clients] = await Promise.all([
    loadSlimCandidates(),
    Application.find({}, 'candidateId jobId phase').lean(),
    Job.find({}, 'title clientId').lean(),
    Client.find({}, 'companyName').lean(),
  ]);
  return {
    candidates,
    apps: apps.map(a => ({
      candidateId: String(a.candidateId),
      jobId: String(a.jobId),
      phase: String(a.phase),
    })),
    jobs: new Map(
      jobs.map(j => [
        String(j._id),
        { title: String(j.title ?? ''), clientId: String(j.clientId ?? '') },
      ])
    ),
    clientNames: new Map(
      clients.map(c => [String(c._id), String(c.companyName ?? '')])
    ),
  };
}

/** Ids matching the query in display order, plus the three tab counts. */
export function computeTable(
  data: TableData,
  query: TableQuery
): {
  ids: string[];
  counts: Record<TableTab, number>;
} {
  const { candidates, apps: slimApps } = data;

  const appsByCandidate = new Map<string, SlimApp[]>();
  for (const a of slimApps) {
    const list = appsByCandidate.get(a.candidateId) ?? [];
    list.push(a);
    appsByCandidate.set(a.candidateId, list);
  }

  const pipelineIds = new Set(
    slimApps.filter(a => a.phase === 'approved').map(a => a.candidateId)
  );
  // Same defensive fallback the browser used: when no approved application
  // exists at all, fall back to approved candidates that hold no application.
  const fallbackIds = new Set(
    candidates
      .filter(
        c =>
          c.status === 'approved' &&
          !c.inTalentPool &&
          !appsByCandidate.has(c._id)
      )
      .map(c => c._id)
  );
  const effectivePipelineIds =
    pipelineIds.size > 0
      ? pipelineIds
      : fallbackIds.size > 0
        ? fallbackIds
        : pipelineIds;

  const isInReview = (c: SlimCandidate) =>
    c.status === 'pending' && !c.inTalentPool;

  const jobIdsForTab = (c: SlimCandidate, tab: TableTab): Set<string> => {
    const ids = new Set<string>();
    for (const a of appsByCandidate.get(c._id) ?? []) {
      if (tab === 'pending') {
        if (a.phase === 'pending') ids.add(a.jobId);
      } else if (tab === 'approved') {
        if (a.phase === 'approved') ids.add(a.jobId);
      } else if (a.phase !== 'rejected') {
        ids.add(a.jobId);
      }
    }
    if (tab === 'pending' && c.appliedJobId) ids.add(c.appliedJobId);
    return ids;
  };

  const inJob = (c: SlimCandidate, tab: TableTab) =>
    !query.jobId || jobIdsForTab(c, tab).has(query.jobId);

  const counts: Record<TableTab, number> = {
    pending: candidates.filter(c => isInReview(c) && inJob(c, 'pending'))
      .length,
    approved: candidates.filter(
      c => effectivePipelineIds.has(c._id) && inJob(c, 'approved')
    ).length,
    hired: candidates.filter(c => c.status === 'hired' && inJob(c, 'hired'))
      .length,
  };

  let result = candidates.filter(c => {
    if (query.tab === 'approved') return effectivePipelineIds.has(c._id);
    if (query.tab === 'pending') return isInReview(c);
    return c.status === query.tab;
  });
  if (query.jobId) result = result.filter(c => inJob(c, query.tab));

  const q = (query.q ?? '').trim().toLowerCase();
  if (q) {
    const jobById = data.jobs;
    const clientNameById = data.clientNames;
    result = result.filter(c => {
      if (`${c.firstName} ${c.lastName}`.toLowerCase().includes(q)) return true;
      if (c.email.toLowerCase().includes(q)) return true;
      if (c.phone.toLowerCase().includes(q)) return true;
      if (c.skills.join(' ').toLowerCase().includes(q)) return true;
      if (c.role?.title?.toLowerCase().includes(q)) return true;
      if (c.role?.company?.toLowerCase().includes(q)) return true;
      for (const jobId of jobIdsForTab(c, query.tab)) {
        const job = jobById.get(jobId);
        if (!job) continue;
        if (job.title.toLowerCase().includes(q)) return true;
        if (clientNameById.get(job.clientId)?.toLowerCase().includes(q))
          return true;
      }
      return false;
    });
  }

  const name = (c: SlimCandidate) =>
    `${c.firstName} ${c.lastName}`.toLowerCase();
  const sorted = [...result].sort((a, b) => {
    switch (query.sort) {
      case 'newest':
        return time(b.createdAt) - time(a.createdAt);
      case 'oldest':
        return time(a.createdAt) - time(b.createdAt);
      case 'a_z':
        return name(a).localeCompare(name(b));
      case 'z_a':
        return name(b).localeCompare(name(a));
      case 'highest_score':
        return b.score !== a.score
          ? b.score - a.score
          : time(b.createdAt) - time(a.createdAt);
      case 'lowest_score':
        return a.score !== b.score
          ? a.score - b.score
          : time(b.createdAt) - time(a.createdAt);
    }
  });

  return { ids: sorted.map(c => c._id), counts };
}

export async function resolveTable(query: TableQuery) {
  return computeTable(await loadTableData(), query);
}

export async function getCandidateTable(query: TableQuery): Promise<{
  candidates: ICandidate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: Record<TableTab, number>;
}> {
  const { ids, counts } = await resolveTable(query);
  const start = (query.page - 1) * query.limit;
  const pageIds = ids.slice(start, start + query.limit);
  const docs = await Candidate.find({ _id: { $in: pageIds } }).select(
    '-resumeRawText'
  );
  const byId = new Map(docs.map(d => [String(d._id), d]));
  const candidates = pageIds
    .map(id => byId.get(id))
    .filter((d): d is NonNullable<typeof d> => !!d)
    .map(d => toListCandidate(d));
  return {
    candidates,
    total: ids.length,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(ids.length / query.limit),
    counts,
  };
}
