export {};

declare global {
  namespace Express {
    interface Request {
      /** Optional portfolio attachment on the public apply flow. */
      portfolioFile?: Express.Multer.File;
      user?: {
        _id: string;
        firstName: string;
        lastName: string;
        roles: string[];
        appAccess: string[];
        /** ATS Candidate document ID — only set for VA users */
        candidateRef: string | null;
        /** ATS Client document ID — only set for client users */
        clientRef: string | null;
        permissions: {
          candidates?: { read?: boolean; write?: boolean; manage?: boolean };
          jobs?: { read?: boolean; write?: boolean; manage?: boolean };
          interviews?: { read?: boolean; write?: boolean; schedule?: boolean };
          clients?: { read?: boolean; write?: boolean; manage?: boolean };
          team?: { read?: boolean; write?: boolean; manage?: boolean };
          analytics?: { read?: boolean };
          assignments?: { read?: boolean; write?: boolean; manage?: boolean };
          reports?: { read?: boolean; write?: boolean; manage?: boolean };
          eod?: { read?: boolean; write?: boolean; approve?: boolean };
          performanceReview?: {
            read?: boolean;
            write?: boolean;
            approve?: boolean;
          };
        };
      };
    }
  }
}
