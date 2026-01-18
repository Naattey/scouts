import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();

interface CancelRegistrationRequest {
  eventId: string;
  roverId?: string;
  reason?: string;
}

interface CancelRegistrationResponse {
  success: boolean;
  eventId: string;
  roverId: string;
}

export const cancelEventRegistration = onCall<CancelRegistrationRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request): Promise<CancelRegistrationResponse> => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }

  const { eventId, reason } = request.data;
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

  // Find registration
  const regQuery = await db.collection(`events/${eventId}/registrations`)
    .where('roverId', '==', roverId)
    .limit(1)
    .get();

  if (regQuery.empty) {
    throw new HttpsError('not-found', 'Registration not found');
  }

  const registrationDoc = regQuery.docs[0];

  try {
    // Update registration status
    await registrationDoc.ref.update({
      status: 'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      cancelledBy: request.auth.uid,
      cancellationReason: reason || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Decrement participant count
    await eventRef.update({
      currentParticipants: admin.firestore.FieldValue.increment(-1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Add to rover's activities
    await db.collection(`rovers/${roverId}/activities_history`).add({
      type: 'event_registration_cancelled',
      entityType: 'event',
      entityId: eventId,
      entityTitle: eventData.title,
      description: `Cancelled registration for event: ${eventData.title}`,
      activityDate: admin.firestore.FieldValue.serverTimestamp(),
      recordedAt: admin.firestore.FieldValue.serverTimestamp(),
      metadata: {
        reason: reason || null,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      eventId,
      roverId,
    };

  } catch (error) {
    console.error('Error cancelling registration:', error);
    throw new HttpsError('internal', 'Failed to cancel registration');
  }
});
