import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requireAction, Actions, isSystemAdmin, logDelete } from '../utils';

const db = admin.firestore();

interface DeleteMeetingRequest {
  meetingId: string;
  reason?: string;
  hardDelete?: boolean;
}

export const deleteMeeting = onCall<DeleteMeetingRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request) => {
  // 1. Check action permission
  await requireAction(request, Actions.MEETINGS_DELETE);

  const { meetingId, reason, hardDelete } = request.data;

  if (!meetingId) {
    throw new HttpsError('invalid-argument', 'Meeting ID is required');
  }

  // 2. Get meeting document
  const meetingRef = db.doc(`meetings/${meetingId}`);
  const meetingDoc = await meetingRef.get();

  if (!meetingDoc.exists) {
    throw new HttpsError('not-found', 'Meeting not found');
  }

  const meetingData = meetingDoc.data()!;

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
      const subcollections = ['attendance', 'notes'];

      for (const subcol of subcollections) {
        const docs = await db.collection(`meetings/${meetingId}/${subcol}`).listDocuments();
        const batch = db.batch();
        docs.forEach(doc => batch.delete(doc));
        if (docs.length > 0) {
          await batch.commit();
        }
      }

      await meetingRef.delete();

    } else {
      // Soft delete
      await meetingRef.update({
        isDeleted: true,
        status: 'cancelled',
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletedBy: request.auth!.uid,
        deletionReason: reason || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 4. Log audit event
    await logDelete(request, 'meeting', meetingId, meetingData);

    return { success: true, meetingId, hardDelete: hardDelete === true };

  } catch (error) {
    console.error('Error deleting meeting:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to delete meeting');
  }
});
