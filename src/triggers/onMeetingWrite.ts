import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { notifyMeetingUpdate } from '../notifications';

const db = admin.firestore();

/**
 * Trigger: onMeetingWrite
 * Fires when a meeting document is created, updated, or deleted.
 *
 * Responsibilities:
 * - Update meeting statistics
 * - Send admin notifications for meeting changes
 */
export const onMeetingWrite = onDocumentWritten({
  document: 'meetings/{meetingId}',
  region: 'us-central1',
}, async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const meetingId = event.params.meetingId;

  // Document was deleted
  if (!afterData && beforeData) {
    console.log(`Meeting deleted: ${meetingId}`);
    await handleMeetingDeleted(meetingId, beforeData);
    return;
  }

  // Document was created
  if (!beforeData && afterData) {
    console.log(`Meeting created: ${meetingId}`);
    await handleMeetingCreated(meetingId, afterData);
    return;
  }

  // Document was updated
  if (beforeData && afterData) {
    console.log(`Meeting updated: ${meetingId}`);
    await handleMeetingUpdated(meetingId, beforeData, afterData);
    return;
  }
});

async function handleMeetingCreated(
  meetingId: string,
  data: FirebaseFirestore.DocumentData
): Promise<void> {
  // Update meeting stats
  const statsRef = db.doc('stats/meetings');
  await statsRef.set({
    totalCount: admin.firestore.FieldValue.increment(1),
    scheduledCount: data.status === 'scheduled' ? admin.firestore.FieldValue.increment(1) : 0,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Update meeting type counts
  if (data.meetingType) {
    await db.doc('stats/meetingTypes').set({
      [data.meetingType]: admin.firestore.FieldValue.increment(1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // Notify admins about new meeting
  await notifyMeetingUpdate(
    meetingId,
    data.title,
    'created',
    data.createdBy
  );
}

async function handleMeetingUpdated(
  meetingId: string,
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData
): Promise<void> {
  const statsRef = db.doc('stats/meetings');

  // Track status changes
  if (before.status !== after.status) {
    if (after.status === 'cancelled') {
      await statsRef.set({
        scheduledCount: admin.firestore.FieldValue.increment(-1),
        cancelledCount: admin.firestore.FieldValue.increment(1),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Notify admins about cancelled meeting
      await notifyMeetingUpdate(meetingId, after.title, 'cancelled', after.updatedBy);
    }
  }

  // Notify admins about modified meeting (significant changes only)
  if (before.status !== 'cancelled' && after.status !== 'cancelled') {
    const hasSignificantChanges =
      before.title !== after.title ||
      before.date !== after.date ||
      before.startTime !== after.startTime ||
      before.location !== after.location;

    if (hasSignificantChanges) {
      await notifyMeetingUpdate(meetingId, after.title, 'modified', after.updatedBy);
    }
  }
}

async function handleMeetingDeleted(
  meetingId: string,
  data: FirebaseFirestore.DocumentData
): Promise<void> {
  const statsRef = db.doc('stats/meetings');
  await statsRef.set({
    totalCount: admin.firestore.FieldValue.increment(-1),
    scheduledCount: data.status === 'scheduled' ? admin.firestore.FieldValue.increment(-1) : 0,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Update meeting type counts
  if (data.meetingType) {
    await db.doc('stats/meetingTypes').set({
      [data.meetingType]: admin.firestore.FieldValue.increment(-1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}
