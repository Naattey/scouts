import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requireAction, Actions, generateTempPassword, logPermissionAction } from '../utils';

const db = admin.firestore();

interface ResetPasswordRequest {
  roverId: string;
  sendEmail?: boolean;
}

interface ResetPasswordResponse {
  success: boolean;
  tempPassword?: string;
  message: string;
}

export const resetPassword = onCall<ResetPasswordRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request): Promise<ResetPasswordResponse> => {
  // 1. Check action permission
  await requireAction(request, Actions.ROVERS_RESET_PASSWORD);

  const { roverId, sendEmail } = request.data;

  if (!roverId) {
    throw new HttpsError('invalid-argument', 'Rover ID is required');
  }

  // 2. Get rover document
  const roverDoc = await db.doc(`rovers/${roverId}`).get();

  if (!roverDoc.exists) {
    throw new HttpsError('not-found', 'Rover not found');
  }

  const roverData = roverDoc.data()!;

  if (!roverData.userId) {
    throw new HttpsError('failed-precondition', 'Rover has no linked user account');
  }

  try {
    // 3. Generate temporary password
    const tempPassword = generateTempPassword(12);

    // 4. Update Firebase Auth password
    await admin.auth().updateUser(roverData.userId, {
      password: tempPassword,
    });

    // 5. Send email with new password (if enabled)
    if (sendEmail !== false) {
      await db.collection('mail').add({
        to: roverData.email,
        template: {
          name: 'password_reset',
          data: {
            name: roverData.fullName,
            tempPassword: tempPassword,
            loginUrl: 'https://scout-app.web.app/login',
          },
        },
      });
    }

    // 6. Log activity to rover's history
    await db.collection(`rovers/${roverId}/activities_history`).add({
      type: 'password_reset',
      entityType: 'system',
      entityId: roverId,
      entityTitle: 'Password Reset',
      description: 'Password was reset by administrator',
      activityDate: admin.firestore.FieldValue.serverTimestamp(),
      recordedAt: admin.firestore.FieldValue.serverTimestamp(),
      metadata: {
        resetBy: request.auth!.uid,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 7. Log audit event
    await logPermissionAction(request, 'password_reset', 'rover', roverId);

    return {
      success: true,
      tempPassword: tempPassword,
      message: sendEmail !== false
        ? 'Password reset. Email sent to rover.'
        : 'Password reset. Please share the temporary password securely.',
    };

  } catch (error) {
    console.error('Error resetting password:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to reset password');
  }
});
