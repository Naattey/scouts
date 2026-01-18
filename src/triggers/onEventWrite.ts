import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { notifyEventUpdate } from '../notifications';

const db = admin.firestore();

/**
 * Trigger: onEventWrite
 * Fires when an event document is created, updated, or deleted.
 *
 * Responsibilities:
 * - Update event statistics
 * - Send notifications for published events
 * - Handle cascading updates
 */
export const onEventWrite = onDocumentWritten({
  document: 'events/{eventId}',
  region: 'us-central1',
}, async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const eventId = event.params.eventId;

  // Document was deleted
  if (!afterData && beforeData) {
    console.log(`Event deleted: ${eventId}`);
    await handleEventDeleted(eventId, beforeData);
    return;
  }

  // Document was created
  if (!beforeData && afterData) {
    console.log(`Event created: ${eventId}`);
    await handleEventCreated(eventId, afterData);
    return;
  }

  // Document was updated
  if (beforeData && afterData) {
    console.log(`Event updated: ${eventId}`);
    await handleEventUpdated(eventId, beforeData, afterData);
    return;
  }
});

async function handleEventCreated(
  eventId: string,
  data: FirebaseFirestore.DocumentData
): Promise<void> {
  // Update event stats
  const statsRef = db.doc('stats/events');
  await statsRef.set({
    totalCount: admin.firestore.FieldValue.increment(1),
    draftCount: data.status === 'draft' ? admin.firestore.FieldValue.increment(1) : 0,
    publishedCount: data.isPublished ? admin.firestore.FieldValue.increment(1) : 0,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Update event type counts
  if (data.eventType) {
    await db.doc('stats/eventTypes').set({
      [data.eventType]: admin.firestore.FieldValue.increment(1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}

async function handleEventUpdated(
  eventId: string,
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData
): Promise<void> {
  const batch = db.batch();
  const statsRef = db.doc('stats/events');

  // Track publish status change
  if (!before.isPublished && after.isPublished) {
    batch.set(statsRef, {
      publishedCount: admin.firestore.FieldValue.increment(1),
      draftCount: admin.firestore.FieldValue.increment(-1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Send notification to all active rovers about new event
    await sendNewEventNotification(eventId, after);

    // Notify admins about published event
    await notifyEventUpdate(eventId, after.title, 'published', after.updatedBy);
  }

  if (before.isPublished && !after.isPublished) {
    batch.set(statsRef, {
      publishedCount: admin.firestore.FieldValue.increment(-1),
      draftCount: admin.firestore.FieldValue.increment(1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // Track status changes
  if (before.status !== after.status) {
    if (after.status === 'cancelled') {
      // Notify registered participants about cancellation
      await notifyEventCancellation(eventId, after);

      // Notify admins about cancelled event
      await notifyEventUpdate(eventId, after.title, 'cancelled', after.updatedBy);
    }
  }

  // Notify admins about modified event (if already published and significant changes)
  if (before.isPublished && after.isPublished && before.status !== 'cancelled') {
    const hasSignificantChanges =
      before.title !== after.title ||
      before.startDate !== after.startDate ||
      before.endDate !== after.endDate ||
      before.location !== after.location;

    if (hasSignificantChanges) {
      await notifyEventUpdate(eventId, after.title, 'modified', after.updatedBy);
    }
  }

  await batch.commit();
}

async function handleEventDeleted(
  eventId: string,
  data: FirebaseFirestore.DocumentData
): Promise<void> {
  const statsRef = db.doc('stats/events');
  await statsRef.set({
    totalCount: admin.firestore.FieldValue.increment(-1),
    draftCount: data.status === 'draft' ? admin.firestore.FieldValue.increment(-1) : 0,
    publishedCount: data.isPublished ? admin.firestore.FieldValue.increment(-1) : 0,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Update event type counts
  if (data.eventType) {
    await db.doc('stats/eventTypes').set({
      [data.eventType]: admin.firestore.FieldValue.increment(-1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}

async function sendNewEventNotification(
  eventId: string,
  eventData: FirebaseFirestore.DocumentData
): Promise<void> {
  // Get all active rovers with FCM tokens
  const roversQuery = await db.collection('rovers')
    .where('isActive', '==', true)
    .where('isApproved', '==', true)
    .select('fcmToken', 'fullName')
    .get();

  const tokens: string[] = [];
  roversQuery.forEach(doc => {
    const token = doc.data().fcmToken;
    if (token) tokens.push(token);
  });

  if (tokens.length === 0) return;

  // Send multicast notification (max 500 tokens per batch)
  const batchSize = 500;
  for (let i = 0; i < tokens.length; i += batchSize) {
    const batchTokens = tokens.slice(i, i + batchSize);

    try {
      await admin.messaging().sendEachForMulticast({
        tokens: batchTokens,
        notification: {
          title: 'New Event Available',
          body: `${eventData.title} - ${eventData.eventType}`,
        },
        data: {
          type: 'new_event',
          eventId,
        },
      });
    } catch (error) {
      console.error('Failed to send event notifications:', error);
    }
  }
}

async function notifyEventCancellation(
  eventId: string,
  eventData: FirebaseFirestore.DocumentData
): Promise<void> {
  // Get all registered participants
  const registrations = await db.collection(`events/${eventId}/registrations`)
    .where('status', '==', 'registered')
    .get();

  for (const regDoc of registrations.docs) {
    const reg = regDoc.data();
    const roverId = reg.roverId;

    // Get rover's FCM token
    const roverDoc = await db.doc(`rovers/${roverId}`).get();
    const roverData = roverDoc.data();

    if (roverData?.fcmToken) {
      try {
        await admin.messaging().send({
          token: roverData.fcmToken,
          notification: {
            title: 'Event Cancelled',
            body: `${eventData.title} has been cancelled`,
          },
          data: {
            type: 'event_cancelled',
            eventId,
          },
        });
      } catch (error) {
        console.error('Failed to send cancellation notification:', error);
      }
    }
  }
}
