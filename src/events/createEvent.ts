import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requirePermission, logCreate } from '../utils';

const db = admin.firestore();

interface CreateEventRequest {
  title: string;
  description?: string;
  eventType: string;
  startDate: string;
  endDate: string;
  location?: string;
  maxParticipants?: number;
  registrationRequired?: boolean;
  registrationDeadline?: string;
  points?: number;
  metadata?: Record<string, unknown>;
}

interface CreateEventResponse {
  success: boolean;
  eventId: string;
}

export const createEvent = onCall<CreateEventRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request): Promise<CreateEventResponse> => {
  // 1. Check permission
  await requirePermission(request, 'events', 'write');

  const data = request.data;

  // 2. Validate required fields
  if (!data.title || data.title.trim().length < 3) {
    throw new HttpsError('invalid-argument', 'Event title must be at least 3 characters');
  }

  if (!data.eventType) {
    throw new HttpsError('invalid-argument', 'Event type is required');
  }

  if (!data.startDate || !data.endDate) {
    throw new HttpsError('invalid-argument', 'Start and end dates are required');
  }

  // 3. Parse and validate dates
  const startDate = new Date(data.startDate);
  const endDate = new Date(data.endDate);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new HttpsError('invalid-argument', 'Invalid date format');
  }

  if (endDate < startDate) {
    throw new HttpsError('invalid-argument', 'End date must be after start date');
  }

  try {
    // 4. Create event document
    const eventRef = db.collection('events').doc();

    const eventData = {
      title: data.title.trim(),
      description: data.description?.trim() || null,
      eventType: data.eventType,
      startDate: admin.firestore.Timestamp.fromDate(startDate),
      endDate: admin.firestore.Timestamp.fromDate(endDate),
      location: data.location?.trim() || null,
      maxParticipants: data.maxParticipants || null,
      currentParticipants: 0,
      registrationRequired: data.registrationRequired || false,
      registrationDeadline: data.registrationDeadline
        ? admin.firestore.Timestamp.fromDate(new Date(data.registrationDeadline))
        : null,
      points: data.points || 0,
      status: 'draft',
      isPublished: false,
      metadata: data.metadata || {},

      // IMPORTANT: createdBy uses request.auth.uid
      // This is the Firebase Auth UID of the authenticated user
      createdBy: request.auth!.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await eventRef.set(eventData);

    // 5. Log audit event
    await logCreate(request, 'event', eventRef.id, eventData);

    console.log(`Event created: ${eventRef.id} by ${request.auth!.uid}`);

    return {
      success: true,
      eventId: eventRef.id,
    };

  } catch (error) {
    console.error('Error creating event:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to create event');
  }
});
