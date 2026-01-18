import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requireAction, Actions, logPermissionAction } from '../utils';

const db = admin.firestore();

interface RejectRoverRequest {
  roverId: string;
  reason: string;
  deleteAccount?: boolean;
}

export const rejectRover = onCall<RejectRoverRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request) => {
  // 1. Check action permission
  await requireAction(request, Actions.ROVERS_REJECT);

  const { roverId, reason, deleteAccount } = request.data;

  if (!roverId) {
    throw new HttpsError('invalid-argument', 'Rover ID is required');
  }

  if (!reason || reason.trim().length < 10) {
    throw new HttpsError('invalid-argument', 'Rejection reason must be at least 10 characters');
  }

  // 2. Get rover document
  const roverRef = db.doc(`rovers/${roverId}`);
  const roverDoc = await roverRef.get();

  if (!roverDoc.exists) {
    throw new HttpsError('not-found', 'Rover not found');
  }

  const roverData = roverDoc.data()!;

  try {
    if (deleteAccount === true) {
      // Delete the account entirely
      if (roverData.userId) {
        await admin.auth().deleteUser(roverData.userId);
        await db.collection('users').doc(roverData.userId).delete();
      }
      await roverRef.delete();

    } else {
      // Soft delete: Mark as rejected but keep in database for audit
      await roverRef.update({
        status: 'rejected',
        rejectedBy: request.auth!.uid,
        rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
        rejectionReason: reason.trim(),
        passwordHash: null, // Clear stored password
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Disable Auth account if exists
      if (roverData.userId) {
        await admin.auth().updateUser(roverData.userId, { disabled: true });
      }
    }

    // 3. Send rejection email
    if (roverData.email) {
      try {
        await db.collection('mail').add({
          to: roverData.email.toLowerCase(),
          template: {
            name: 'registration_rejected',
            data: {
              name: roverData.fullName,
              reason: reason.trim(),
              contactEmail: 'support@scouts.mv', // Update with actual support email
            },
          },
        });
      } catch (emailError) {
        console.error('Failed to send rejection email:', emailError);
      }
    }

    // 4. Send FCM push notification
    if (roverData.fcmToken && !deleteAccount) {
      try {
        await admin.messaging().send({
          token: roverData.fcmToken,
          notification: {
            title: 'Account Status Update',
            body: `Your account application was not approved. Reason: ${reason}`,
          },
          data: {
            roverId,
            type: 'account_rejected',
          },
        });
      } catch (fcmError) {
        console.error('Failed to send FCM notification:', fcmError);
      }
    }

    // 5. Log audit event
    await logPermissionAction(request, deleteAccount ? 'reject_and_delete' : 'reject', 'rover', roverId, {
      reason,
      deleteAccount,
    });

    return { success: true, roverId, deleted: deleteAccount === true };

  } catch (error) {
    console.error('Error rejecting rover:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to reject rover');
  }
});
