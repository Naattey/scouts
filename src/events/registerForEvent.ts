import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();

interface RegisterEventRequest {
  eventId: string;
  roverId?: string; // Optional - defaults to caller's roverId
  notes?: string;
}

interface RegisterEventResponse {
  success: boolean;
  registrationId: string;
  eventId: string;
  roverId: string;
}

export const registerForEvent = onCall<RegisterEventRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request): Promise<RegisterEventResponse> => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }

  const { eventId, notes } = request.data;
  let { roverId } = request.data;

  if (!eventId) {
    throw new HttpsError('invalid-argument', 'Event ID is required');
  }

  // Default to caller's rover profile
  if (!roverId) {
    const roverQuery = await db.collection('rovers')
      .where('userId', '==', request.auth.uid)
      .limit(1)
      .get();

    if (roverQuery.empty) {
      throw new HttpsError('failed-precondition', 'No rover profile found');
    }
    roverId = roverQuery.docs[0].id;
  }

  // Get event
  const eventRef = db.doc(`events/${eventId}`);
  const eventDoc = await eventRef.get();

  if (!eventDoc.exists) {
    throw new HttpsError('not-found', 'Event not found');
  }

  const eventData = eventDoc.data()!;

  // Check if event is published
  if (!eventData.isPublished) {
    throw new HttpsError('failed-precondition', 'Event is not published');
  }

  // Check if event is cancelled
  if (eventData.status === 'cancelled') {
    throw new HttpsError('failed-precondition', 'Event has been cancelled');
  }

  // Check registration deadline
  if (eventData.registrationDeadline) {
    const deadline = eventData.registrationDeadline.toDate();
    if (new Date() > deadline) {
      throw new HttpsError('failed-precondition', 'Registration deadline has passed');
    }
  }

  // Check capacity
  if (eventData.maxParticipants) {
    const currentCount = eventData.currentParticipants || 0;
    if (currentCount >= eventData.maxParticipants) {
      throw new HttpsError('failed-precondition', 'Event is at full capacity');
    }
  }

  // Check if already registered
  const existingReg = await db.collection(`events/${eventId}/registrations`)
    .where('roverId', '==', roverId)
    .limit(1)
    .get();

  if (!existingReg.empty) {
    throw new HttpsError('already-exists', 'Already registered for this event');
  }

  // Get rover data
  const roverDoc = await db.doc(`rovers/${roverId}`).get();
  if (!roverDoc.exists) {
    throw new HttpsError('not-found', 'Rover not found');
  }
  const roverData = roverDoc.data()!;

  try {
    // Create registration
    const registrationRef = db.collection(`events/${eventId}/registrations`).doc();

    const registrationData = {
      roverId,
      roverName: roverData.fullName,
      roverEmail: roverData.email,
      roverScoutId: roverData.scoutId,
      status: 'registered',
      notes: notes || null,
      registeredAt: admin.firestore.FieldValue.serverTimestamp(),
      registeredBy: request.auth.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await registrationRef.set(registrationData);

    // Update participant count
    await eventRef.update({
      currentParticipants: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Add to rover's activities
    await db.collection(`rovers/${roverId}/activities_history`).add({
      type: 'event_registered',
      entityType: 'event',
      entityId: eventId,
      entityTitle: eventData.title,
      description: `Registered for event: ${eventData.title}`,
      activityDate: admin.firestore.FieldValue.serverTimestamp(),
      recordedAt: admin.firestore.FieldValue.serverTimestamp(),
      metadata: {
        eventType: eventData.eventType,
        startDate: eventData.startDate,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      registrationId: registrationRef.id,
      eventId,
      roverId,
    };

  } catch (error) {
    console.error('Error registering for event:', error);
    throw new HttpsError('internal', 'Failed to register for event');
  }
});
