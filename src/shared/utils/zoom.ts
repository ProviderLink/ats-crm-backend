import { AppError } from './AppError';

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

const getZoomToken = async (): Promise<string> => {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const accountId = process.env.ZOOM_ACCOUNT_ID ?? '';
  const clientId = process.env.ZOOM_CLIENT_ID ?? '';
  const clientSecret = process.env.ZOOM_CLIENT_SECRET ?? '';
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    'base64'
  );

  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=account_credentials&account_id=${accountId}`,
  });

  if (!response.ok) {
    throw new AppError(
      500,
      'ZOOM_API_ERROR',
      'Failed to authenticate with Zoom'
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
};

export const createZoomMeeting = async (params: {
  topic: string;
  scheduledAt: string;
  duration: number;
  timezone: string;
}): Promise<{ meetingId: string; link: string; password: string }> => {
  try {
    const token = await getZoomToken();

    const response = await fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic: params.topic,
        type: 2,
        start_time: params.scheduledAt,
        duration: params.duration,
        timezone: params.timezone,
        settings: {
          waiting_room: false,
          join_before_host: true,
        },
      }),
    });

    if (!response.ok) {
      throw new AppError(
        500,
        'ZOOM_API_ERROR',
        'Failed to create Zoom meeting'
      );
    }

    const data = (await response.json()) as {
      id: number;
      join_url: string;
      password: string;
    };

    return {
      meetingId: String(data.id),
      link: data.join_url,
      password: data.password ?? '',
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'ZOOM_API_ERROR', 'Failed to create Zoom meeting');
  }
};

export const updateZoomMeeting = async (
  meetingId: string,
  params: {
    topic?: string;
    scheduledAt?: string;
    duration?: number;
    timezone?: string;
  }
): Promise<void> => {
  try {
    const token = await getZoomToken();

    const body: Record<string, unknown> = {};
    if (params.topic !== undefined) body['topic'] = params.topic;
    if (params.scheduledAt !== undefined)
      body['start_time'] = params.scheduledAt;
    if (params.duration !== undefined) body['duration'] = params.duration;
    if (params.timezone !== undefined) body['timezone'] = params.timezone;

    const response = await fetch(
      `https://api.zoom.us/v2/meetings/${meetingId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `Failed to update Zoom meeting ${meetingId}: ${response.status}`,
        errorBody
      );
      throw new AppError(
        500,
        'ZOOM_API_ERROR',
        'Failed to update Zoom meeting'
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error(`Error updating Zoom meeting ${meetingId}:`, err);
    throw new AppError(500, 'ZOOM_API_ERROR', 'Failed to update Zoom meeting');
  }
};

export const deleteZoomMeeting = async (meetingId: string): Promise<void> => {
  try {
    const token = await getZoomToken();

    const response = await fetch(
      `https://api.zoom.us/v2/meetings/${meetingId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      console.error(
        `Failed to delete Zoom meeting ${meetingId}: ${response.status}`
      );
    }
  } catch (err) {
    console.error(`Error deleting Zoom meeting ${meetingId}:`, err);
  }
};
