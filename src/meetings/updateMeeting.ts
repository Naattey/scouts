import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requirePermission, logUpdate } from '../utils';

const db = admin.firestore();

interface UpdateMeetingRequest {
  meetingId: string;
  updates: {
    title?: string;
    description?: string;
    meetingType?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    location?: string;
    isOnline?: boolean;
    meetingLink?: string;
    agenda?: string[];
    status?: string;
    metadata?: Record<string, unknown>;
  };
}

export const updateMeeting = onCall<UpdateMeetingRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request) => {
  // 1. Check permission
  await requirePermission(request, 'meetings', 'write');

  const { meetingId, updates } = request.data;

  if (!meetingId) {
    throw new HttpsError('invalid-argument', 'Meeting ID is required');
  }

  // 2. Get existing meeting
  const meetingRef = db.doc(`meetings/${meetingId}`);
  const meetingDoc = await meetingRef.get();

  if (!meetingDoc.exists) {
    throw new HttpsError('not-found', 'Meeting not found');
  }

  const existingData = meetingDoc.data()!;

  // 3. Build update object
  const updateData: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: request.auth!.uid,
  };

  if (updates.title !== undefined) {
    if (updates.title.trim().length < 3) {
      throw new HttpsError('invalid-argument', 'Title must be at least 3 characters');
    }
    updateData.title = updates.title.trim();
  }

  if (updates.description !== undefined) {
    updateData.description = updates.description?.trim() || null;
  }

  if (updates.meetingType !== undefined) {
    updateData.meetingType = updates.meetingType;
  }

  if (updates.date !== undefined) {
    const date = new Date(updates.date);
    if (isNaN(date.getTime())) {
      throw new HttpsError('invalid-argument', 'Invalid date format');
    }
    updateData.date = admin.firestore.Timestamp.fromDate(date);
  }

  if (updates.startTime !== undefined) {
    updateData.startTime = updates.startTime;
  }

  if (updates.endTime !== undefined) {
    updateData.endTime = updates.endTime;
  }

  if (updates.location !== undefined) {
    updateData.location = updates.location?.trim() || null;
  }

  if (updates.isOnline !== undefined) {
    updateData.isOnline = updates.isOnline;
  }

  if (updates.meetingLink !== undefined) {
    updateData.meetingLink = updates.meetingLink;
  }

  if (updates.agenda !== undefined) {
    updateData.agenda = updates.agenda;
  }

  if (updates.status !== undefined) {
    updateData.status = updates.status;
  }

  if (updates.metadata !== undefined) {
    updateData.metadata = updates.metadata;
  }

  try {
    // 4. Update meeting
    await meetingRef.update(updateData);

    // 5. Log audit event
    await logUpdate(request, 'meeting', meetingId, existingData, updateData);

    return { success: true, meetingId };

  } catch (error) {
    console.error('Error updating meeting:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to update meeting');
  }
});
