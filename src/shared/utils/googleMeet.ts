/**
 * Google Meet utility — manual link mode.
 *
 * Unlike Zoom (which has a simple API), creating Google Meet links via API
 * requires Google Workspace + domain-wide delegation + admin setup.
 *
 * For simplicity, Google Meet interviews accept a manually-entered link.
 * The user creates a Meet link at https://meet.google.com/ and pastes it in.
 * All scheduling data lives in our interview record — the link is just a URL.
 *
 * These functions exist as no-ops to maintain the same interface as Zoom,
 * so the interview service doesn't need branching logic.
 */

export const createGoogleMeetMeeting = async (_params: {
  topic: string;
  scheduledAt: string;
  duration: number;
  timezone: string;
  attendees?: string[];
}): Promise<{
  meetingId: string;
  link: string;
  password: string;
}> => {
  // No auto-creation — the meeting link comes from the user's manual input.
  return {
    meetingId: '',
    link: '',
    password: '',
  };
};

export const updateGoogleMeetMeeting = async (
  _eventId: string,
  _params: {
    topic?: string;
    scheduledAt?: string;
    duration?: number;
    timezone?: string;
  }
): Promise<void> => {
  // No-op — there's no API-managed meeting to update.
};

export const deleteGoogleMeetMeeting = async (
  _spaceName: string
): Promise<void> => {
  // No-op — there's no API-managed meeting to delete.
};
