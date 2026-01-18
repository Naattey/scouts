import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requireAction, Actions, isSystemAdmin, logDelete } from '../utils';

const db = admin.firestore();
const bucket = admin.storage().bucket();

interface DeleteRoverRequest {
  roverId: string;
  reason?: string;
  hardDelete?: boolean;
}

export const deleteRover = onCall<DeleteRoverRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 120,
}, async (request) => {
  // 1. Check action permission
  await requireAction(request, Actions.ROVERS_DELETE);

  const { roverId, reason, hardDelete } = request.data;

  if (!roverId) {
    throw new HttpsError('invalid-argument', 'Rover ID is required');
  }

  // 2. Get rover document
  const roverRef = db.doc(`rovers/${roverId}`);
  const roverDoc = await roverRef.get();

  if (!roverDoc.exists) {
    throw new HttpsError('not-found', 'Rover not found');
  }

  const roverData = roverDoc.data()!;

  // 3. Prevent self-deletion
  if (roverData.userId === request.auth!.uid) {
    throw new HttpsError('failed-precondition', 'Cannot delete your own account');
  }

  // 4. Only system admin can hard delete
  if (hardDelete === true) {
    const isSysAdmin = await isSystemAdmin(request.auth!.uid);
    if (!isSysAdmin) {
      throw new HttpsError('permission-denied', 'Only system admins can permanently delete');
    }
  }

  try {
    if (hardDelete === true) {
      // Hard delete (permanent)

      // Delete Auth user
      if (roverData.userId) {
        try {
          await admin.auth().deleteUser(roverData.userId);
        } catch (authError) {
          console.error('Failed to delete Auth user:', authError);
        }
      }

      // Delete profile images from storage
      try {
        await bucket.file(`rovers/${roverId}/profile.jpg`).delete();
        await bucket.file(`rovers/${roverId}/profile_thumb.jpg`).delete();
      } catch (storageError) {
        // Files may not exist
      }

      // Delete user document
      if (roverData.userId) {
        await db.collection('users').doc(roverData.userId).delete();
      }

      // Delete rover document and subcollections
      await deleteDocumentWithSubcollections(roverRef);

    } else {
      // Soft delete (default)

      // Disable Auth user
      if (roverData.userId) {
        await admin.auth().updateUser(roverData.userId, { disabled: true });
      }

      // Mark as deleted
      await roverRef.update({
        isDeleted: true,
        isActive: false,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletedBy: request.auth!.uid,
        deletionReason: reason || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update user document
      if (roverData.userId) {
        await db.collection('users').doc(roverData.userId).update({
          isActive: false,
          disabled: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    // 5. Log activity
    await logDelete(request, 'rover', roverId, roverData);

    console.log(`Rover ${hardDelete ? 'hard' : 'soft'} deleted: ${roverId}`);

    return { success: true, roverId, hardDelete: hardDelete === true };

  } catch (error) {
    console.error('Error deleting rover:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to delete rover');
  }
});

async function deleteDocumentWithSubcollections(
  docRef: FirebaseFirestore.DocumentReference
): Promise<void> {
  // Delete subcollections
  const subcollections = await docRef.listCollections();

  for (const subcollection of subcollections) {
    const docs = await subcollection.listDocuments();
    for (const doc of docs) {
      await deleteDocumentWithSubcollections(doc);
    }
  }

  // Delete the document itself
  await docRef.delete();
}
