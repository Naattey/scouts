import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { notifyNewRoverRegistration, notifyRoverApproved } from '../notifications';

const db = admin.firestore();

/**
 * Trigger: onRoverWrite
 * Fires when a rover document is created, updated, or deleted.
 *
 * Responsibilities:
 * - Sync rover data to user document
 * - Update statistics/counters
 * - Handle cascading updates
 */
export const onRoverWrite = onDocumentWritten({
  document: 'rovers/{roverId}',
  region: 'us-central1',
}, async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const roverId = event.params.roverId;

  // Document was deleted
  if (!afterData && beforeData) {
    console.log(`Rover deleted: ${roverId}`);
    await handleRoverDeleted(roverId, beforeData);
    return;
  }

  // Document was created
  if (!beforeData && afterData) {
    console.log(`Rover created: ${roverId}`);
    await handleRoverCreated(roverId, afterData);
    return;
  }

  // Document was updated
  if (beforeData && afterData) {
    console.log(`Rover updated: ${roverId}`);
    await handleRoverUpdated(roverId, beforeData, afterData);
    return;
  }
});

async function handleRoverCreated(
  roverId: string,
  data: FirebaseFirestore.DocumentData
): Promise<void> {
  // Update rover count stats
  const statsRef = db.doc('stats/rovers');
  await statsRef.set({
    totalCount: admin.firestore.FieldValue.increment(1),
    pendingApprovalCount: data.isApproved ? 0 : admin.firestore.FieldValue.increment(1),
    activeCount: data.isActive ? admin.firestore.FieldValue.increment(1) : 0,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Update role counts
  if (data.role) {
    await db.doc('stats/roles').set({
      [data.role]: admin.firestore.FieldValue.increment(1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // Notify admins of new rover registration if pending approval
  if (data.status === 'pending' && !data.isApproved) {
    const roverName = data.fullName || data.email || 'New rover';
    await notifyNewRoverRegistration(roverId, roverName);
  }
}

async function handleRoverUpdated(
  roverId: string,
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData
): Promise<void> {
  const batch = db.batch();
  const statsRef = db.doc('stats/rovers');
  const roleStatsRef = db.doc('stats/roles');

  // Track approval status change
  if (before.isApproved !== after.isApproved) {
    batch.set(statsRef, {
      pendingApprovalCount: admin.firestore.FieldValue.increment(after.isApproved ? -1 : 1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // Notify admins when a rover is approved (status changes from pending to active)
  if (before.status === 'pending' && after.status === 'active') {
    const roverName = after.fullName || after.email || 'A rover';
    // Get the approving admin's rover ID if available
    const approvedByRoverId = after.approvedBy;
    await notifyRoverApproved(roverId, roverName, approvedByRoverId);
  }

  // Track active status change
  if (before.isActive !== after.isActive) {
    batch.set(statsRef, {
      activeCount: admin.firestore.FieldValue.increment(after.isActive ? 1 : -1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // Track role change
  if (before.role !== after.role) {
    if (before.role) {
      batch.set(roleStatsRef, {
        [before.role]: admin.firestore.FieldValue.increment(-1),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    if (after.role) {
      batch.set(roleStatsRef, {
        [after.role]: admin.firestore.FieldValue.increment(1),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }

  // Sync key fields to user document
  if (after.userId) {
    const userRef = db.collection('users').doc(after.userId);

    const syncFields: Record<string, unknown> = {};

    if (before.fullName !== after.fullName) {
      syncFields.displayName = after.fullName;
    }
    if (before.email !== after.email) {
      syncFields.email = after.email;
    }
    if (before.profileImageUrl !== after.profileImageUrl) {
      syncFields.photoURL = after.profileImageUrl;
    }
    if (before.role !== after.role) {
      syncFields.role = after.role;
    }
    if (before.isActive !== after.isActive) {
      syncFields.isActive = after.isActive;
    }

    if (Object.keys(syncFields).length > 0) {
      syncFields.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      batch.update(userRef, syncFields);
    }
  }

  await batch.commit();
}

async function handleRoverDeleted(
  roverId: string,
  data: FirebaseFirestore.DocumentData
): Promise<void> {
  const batch = db.batch();
  const statsRef = db.doc('stats/rovers');
  const roleStatsRef = db.doc('stats/roles');

  // Update rover count stats
  batch.set(statsRef, {
    totalCount: admin.firestore.FieldValue.increment(-1),
    pendingApprovalCount: data.isApproved ? 0 : admin.firestore.FieldValue.increment(-1),
    activeCount: data.isActive ? admin.firestore.FieldValue.increment(-1) : 0,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Update role counts
  if (data.role) {
    batch.set(roleStatsRef, {
      [data.role]: admin.firestore.FieldValue.increment(-1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  await batch.commit();
}
