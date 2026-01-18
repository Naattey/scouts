import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requirePermission, logUpdate } from '../utils';

const db = admin.firestore();

interface UpdateEventRequest {
  eventId: string;
  updates: {
    title?: string;
    description?: string;
    eventType?: string;
    startDate?: string;
    endDate?: string;
    location?: string;
    maxParticipants?: number;
    registrationRequired?: boolean;
    registrationDeadline?: string;
    points?: number;
    status?: string;
    isPublished?: boolean;
    metadata?: Record<string, unknown>;
  };
}

export const updateEvent = onCall<UpdateEventRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request) => {
  // 1. Check permission
  await requirePermission(request, 'events', 'write');

  const { eventId, updates } = request.data;

  if (!eventId) {
    throw new HttpsError('invalid-argument', 'Event ID is required');
  }

  // 2. Get existing event
  const eventRef = db.doc(`events/${eventId}`);
  const eventDoc = await eventRef.get();

  if (!eventDoc.exists) {
    throw new HttpsError('not-found', 'Event not found');
  }

  const existingData = eventDoc.data()!;

  // 3. Build update object
  const updateData: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: request.auth!.uid,  // Track who made the update
  };

  // Validate and add fields
  if (updates.title !== undefined) {
    if (updates.title.trim().length < 3) {
      throw new HttpsError('invalid-argument', 'Title must be at least 3 characters');
    }
    updateData.title = updates.title.trim();
  }

  if (updates.description !== undefined) {
    updateData.description = updates.description?.trim() || null;
  }

  if (updates.eventType !== undefined) {
    updateData.eventType = updates.eventType;
  }

  if (updates.startDate !== undefined) {
    const startDate = new Date(updates.startDate);
    if (isNaN(startDate.getTime())) {
      throw new HttpsError('invalid-argument', 'Invalid start date format');
    }
    updateData.startDate = admin.firestore.Timestamp.fromDate(startDate);
  }

  if (updates.endDate !== undefined) {
    const endDate = new Date(updates.endDate);
    if (isNaN(endDate.getTime())) {
      throw new HttpsError('invalid-argument', 'Invalid end date format');
    }
    updateData.endDate = admin.firestore.Timestamp.fromDate(endDate);
  }

  if (updates.location !== undefined) {
    updateData.location = updates.location?.trim() || null;
  }

  if (updates.maxParticipants !== undefined) {
    updateData.maxParticipants = updates.maxParticipants;
  }

  if (updates.registrationRequired !== undefined) {
    updateData.registrationRequired = updates.registrationRequired;
  }

  if (updates.registrationDeadline !== undefined) {
    updateData.registrationDeadline = updates.registrationDeadline
      ? admin.firestore.Timestamp.fromDate(new Date(updates.registrationDeadline))
      : null;
  }

  if (updates.points !== undefined) {
    updateData.points = updates.points;
  }

  if (updates.status !== undefined) {
    updateData.status = updates.status;
  }

  if (updates.isPublished !== undefined) {
    updateData.isPublished = updates.isPublished;
    if (updates.isPublished && !existingData.publishedAt) {
      updateData.publishedAt = admin.firestore.FieldValue.serverTimestamp();
      updateData.publishedBy = request.auth!.uid;
    }
  }

  if (updates.metadata !== undefined) {
    updateData.metadata = updates.metadata;
  }

  try {
    // 4. Update event
    await eventRef.update(updateData);

    // 5. Log audit event
    await logUpdate(request, 'event', eventId, existingData, updateData);

    return { success: true, eventId };

  } catch (error) {
    console.error('Error updating event:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to update event');
  }
});
