import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requireAction, Actions, isSystemAdmin, logDelete } from '../utils';

const db = admin.firestore();

interface DeleteEventRequest {
  eventId: string;
  reason?: string;
  hardDelete?: boolean;
}

export const deleteEvent = onCall<DeleteEventRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request) => {
  // 1. Check action permission
  await requireAction(request, Actions.EVENTS_DELETE);

  const { eventId, reason, hardDelete } = request.data;

  if (!eventId) {
    throw new HttpsError('invalid-argument', 'Event ID is required');
  }

  // 2. Get event document
  const eventRef = db.doc(`events/${eventId}`);
  const eventDoc = await eventRef.get();

  if (!eventDoc.exists) {
    throw new HttpsError('not-found', 'Event not found');
  }

  const eventData = eventDoc.data()!;

  // 3. Only system admin can hard delete
  if (hardDelete === true) {
    const isSysAdmin = await isSystemAdmin(request.auth!.uid);
    if (!isSysAdmin) {
      throw new HttpsError('permission-denied', 'Only system admins can permanently delete');
    }
  }

  try {
    if (hardDelete === true) {
      // Hard delete - remove permanently
      // First delete subcollections
      const subcollections = ['registrations', 'attendance', 'feedback'];

      for (const subcol of subcollections) {
        const docs = await db.collection(`events/${eventId}/${subcol}`).listDocuments();
        const batch = db.batch();
        docs.forEach(doc => batch.delete(doc));
        if (docs.length > 0) {
          await batch.commit();
        }
      }

      // Delete the event document
      await eventRef.delete();

    } else {
      // Soft delete - mark as deleted
      await eventRef.update({
        isDeleted: true,
        isPublished: false,
        status: 'cancelled',
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletedBy: request.auth!.uid,
        deletionReason: reason || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 4. Log audit event
    await logDelete(request, 'event', eventId, eventData);

    console.log(`Event ${hardDelete ? 'hard' : 'soft'} deleted: ${eventId}`);

    return { success: true, eventId, hardDelete: hardDelete === true };

  } catch (error) {
    console.error('Error deleting event:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to delete event');
  }
});
