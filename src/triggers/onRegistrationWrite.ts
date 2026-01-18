import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Trigger: onRegistrationWrite
 * Fires when any registration document is created, updated, or deleted.
 *
 * Cost Optimization:
 * - Aggregates registration counts into parent event document
 * - Reduces reads from N (registration docs) to 1 (event doc)
 */
export const onRegistrationWrite = onDocumentWritten({
  document: 'events/{eventId}/registrations/{registrationId}',
  region: 'us-central1',
}, async (event) => {
  const eventId = event.params.eventId;

  console.log(`Aggregating registration counts for event: ${eventId}`);

  try {
    const eventRef = db.collection('events').doc(eventId);
    const registrationsSnapshot = await eventRef.collection('registrations').get();

    // Count by status
    let confirmed = 0;
    let pending = 0;
    let cancelled = 0;
    let waitlisted = 0;

    registrationsSnapshot.docs.forEach(doc => {
      const status = doc.data().status;
      switch (status) {
        case 'confirmed':
          confirmed++;
          break;
        case 'pending':
          pending++;
          break;
        case 'cancelled':
          cancelled++;
          break;
        case 'waitlisted':
          waitlisted++;
          break;
      }
    });

    // Update event document with aggregated counts
    await eventRef.update({
      registrationCounts: {
        confirmed,
        pending,
        cancelled,
        waitlisted,
        total: registrationsSnapshot.size,
      },
      registrationCount: confirmed, // Quick access to confirmed count
      lastRegistrationUpdate: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Updated event ${eventId} with registration counts:`, {
      confirmed, pending, cancelled, waitlisted, total: registrationsSnapshot.size,
    });

  } catch (error) {
    console.error('Error aggregating registration counts:', error);
    throw error;
  }
});
