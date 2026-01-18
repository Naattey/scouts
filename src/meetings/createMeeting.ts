import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requirePermission, logCreate } from '../utils';

const db = admin.firestore();

interface CreateMeetingRequest {
  title: string;
  description?: string;
  meetingType: string;
  date: string;
  startTime: string;
  endTime: string;
  location?: string;
  isOnline?: boolean;
  meetingLink?: string;
  agenda?: string[];
  expectedAttendees?: string[];
  metadata?: Record<string, unknown>;
}

interface CreateMeetingResponse {
  success: boolean;
  meetingId: string;
}

export const createMeeting = onCall<CreateMeetingRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request): Promise<CreateMeetingResponse> => {
  // 1. Check permission
  await requirePermission(request, 'meetings', 'write');

  const data = request.data;

  // 2. Validate required fields
  if (!data.title || data.title.trim().length < 3) {
    throw new HttpsError('invalid-argument', 'Meeting title must be at least 3 characters');
  }

  if (!data.meetingType) {
    throw new HttpsError('invalid-argument', 'Meeting type is required');
  }

  if (!data.date) {
    throw new HttpsError('invalid-argument', 'Meeting date is required');
  }

  // 3. Parse date
  const meetingDate = new Date(data.date);
  if (isNaN(meetingDate.getTime())) {
    throw new HttpsError('invalid-argument', 'Invalid date format');
  }

  try {
    // 4. Create meeting document
    const meetingRef = db.collection('meetings').doc();

    const meetingData = {
      title: data.title.trim(),
      description: data.description?.trim() || null,
      meetingType: data.meetingType,
      date: admin.firestore.Timestamp.fromDate(meetingDate),
      startTime: data.startTime || null,
      endTime: data.endTime || null,
      location: data.location?.trim() || null,
      isOnline: data.isOnline || false,
      meetingLink: data.meetingLink || null,
      agenda: data.agenda || [],
      expectedAttendees: data.expectedAttendees || [],
      status: 'scheduled',
      attendanceFinalized: false,
      metadata: data.metadata || {},

      // IMPORTANT: createdBy uses request.auth.uid
      // This is the Firebase Auth UID of the authenticated user
      createdBy: request.auth!.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await meetingRef.set(meetingData);

    // 5. Log audit event
    await logCreate(request, 'meeting', meetingRef.id, meetingData);

    console.log(`Meeting created: ${meetingRef.id} by ${request.auth!.uid}`);

    return {
      success: true,
      meetingId: meetingRef.id,
    };

  } catch (error) {
    console.error('Error creating meeting:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to create meeting');
  }
});
