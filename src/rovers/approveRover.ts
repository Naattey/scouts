import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import {
  requireAction,
  Actions,
  logPermissionAction,
  generateTempPassword,
  generateScoutId,
} from '../utils';

const db = admin.firestore();

interface ApproveRoverRequest {
  roverId: string;
  welcomeMessage?: string;
}

export const approveRover = onCall<ApproveRoverRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request) => {
  // 1. Check action permission
  await requireAction(request, Actions.ROVERS_APPROVE);

  const { roverId, welcomeMessage } = request.data;

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

  // 3. Check if already approved
  if (roverData.status === 'active') {
    throw new HttpsError('failed-precondition', 'Rover is already approved');
  }

  // Check if rover is pending
  if (roverData.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'Rover is not in pending status');
  }

  let userId = roverData.userId;
  let tempPassword: string | null = null;
  let scoutId = roverData.scoutId;

  // 4. Create Firebase Auth user if not exists
  if (!userId && roverData.email) {
    const email = roverData.email.toLowerCase();

    try {
      // First, check if user already exists with this email
      let existingUser: admin.auth.UserRecord | null = null;
      try {
        existingUser = await admin.auth().getUserByEmail(email);
      } catch {
        // User doesn't exist, which is expected
      }

      if (existingUser) {
        // User already exists in Firebase Auth - link to this rover
        userId = existingUser.uid;
        console.log(`Linking existing auth user ${userId} to rover ${roverId}`);

        // Update custom claims
        await admin.auth().setCustomUserClaims(userId, {
          role: roverData.role || 'rover',
          roverId: roverId,
          isApproved: true,
        });

        // Enable the user if disabled
        await admin.auth().updateUser(userId, { disabled: false });
      } else {
        // Create new Firebase Auth user
        // Use stored password or generate a new temporary password
        const password = roverData.passwordHash || generateTempPassword(12);

        // Track if we generated a new password (to send via email)
        if (!roverData.passwordHash) {
          tempPassword = password;
        }

        const userRecord = await admin.auth().createUser({
          email: email,
          password: password,
          displayName: roverData.fullName,
          disabled: false,
        });

        userId = userRecord.uid;
        console.log(`Created new auth user ${userId} for rover ${roverId}`);

        // Set custom claims
        await admin.auth().setCustomUserClaims(userId, {
          role: roverData.role || 'rover',
          roverId: roverId,
          isApproved: true,
        });

        // Create user document for the new auth user
        await db.collection('users').doc(userId).set({
          uid: userId,
          email: email,
          displayName: roverData.fullName,
          role: roverData.role || 'rover',
          roverId: roverId,
          isActive: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Generate Scout ID if not exists
      if (!scoutId) {
        scoutId = await generateScoutId();
      }
    } catch (authError: unknown) {
      console.error('Failed to create/link Firebase Auth user:', authError);
      const errorMessage = authError instanceof Error ? authError.message : 'Unknown error';
      throw new HttpsError('internal', `Failed to create user account: ${errorMessage}`);
    }
  } else if (userId) {
    // Update existing user's custom claims
    try {
      const user = await admin.auth().getUser(userId);
      const currentClaims = user.customClaims || {};
      await admin.auth().setCustomUserClaims(userId, {
        ...currentClaims,
        role: roverData.role || currentClaims.role || 'rover',
        roverId: roverId,
        isApproved: true,
      });
      // Enable the user if disabled
      await admin.auth().updateUser(userId, { disabled: false });
    } catch (authError) {
      console.error('Failed to update custom claims:', authError);
    }
  }

  // 5. Update rover document
  const updateData: Record<string, unknown> = {
    status: 'active',
    userId: userId, // Link Firebase Auth user
    approvedBy: request.auth!.uid,
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    rejectionReason: null,
    passwordHash: null, // Clear stored password for security
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Add scoutId if it was generated
  if (scoutId && !roverData.scoutId) {
    updateData.scoutId = scoutId;
  }

  await roverRef.update(updateData);

  // 6. Send approval email
  if (roverData.email) {
    try {
      // Include temporary password in email if one was generated
      const emailData: Record<string, unknown> = {
        name: roverData.fullName,
        email: roverData.email,
        scoutId: scoutId || roverData.scoutId,
        loginUrl: 'https://scout-app.web.app/login',
        message: welcomeMessage || 'Your scout account has been approved. Welcome to the team!',
      };

      // Add temporary password if it was generated (for admin-created rovers)
      if (tempPassword) {
        emailData.tempPassword = tempPassword;
        emailData.passwordGenerated = true;
      }

      await db.collection('mail').add({
        to: roverData.email.toLowerCase(),
        template: {
          name: 'registration_approved',
          data: emailData,
        },
      });
    } catch (emailError) {
      console.error('Failed to send approval email:', emailError);
    }
  }

  // 7. Send FCM push notification
  if (roverData.fcmToken) {
    try {
      await admin.messaging().send({
        token: roverData.fcmToken,
        notification: {
          title: 'Account Approved!',
          body: welcomeMessage || 'Your scout account has been approved. Welcome to the team!',
        },
        data: {
          roverId,
          type: 'account_approved',
        },
      });
    } catch (fcmError) {
      console.error('Failed to send FCM notification:', fcmError);
    }
  }

  // 8. Log activity to rover's history
  await db.collection(`rovers/${roverId}/activities_history`).add({
    type: 'profile_approved',
    entityType: 'system',
    entityId: roverId,
    entityTitle: 'Account Approved',
    description: 'Account was approved by administrator',
    activityDate: admin.firestore.FieldValue.serverTimestamp(),
    recordedAt: admin.firestore.FieldValue.serverTimestamp(),
    metadata: {
      approvedBy: request.auth!.uid,
      welcomeMessage,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // 9. Log audit event
  await logPermissionAction(request, 'approve', 'rover', roverId, {
    welcomeMessage,
    authUserCreated: !!userId && !roverData.userId,
    passwordGenerated: !!tempPassword,
  });

  return {
    success: true,
    roverId,
    userId,
    scoutId: scoutId || roverData.scoutId,
    authUserCreated: !!userId && !roverData.userId,
    passwordGenerated: !!tempPassword,
  };
});
