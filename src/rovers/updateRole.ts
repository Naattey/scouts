import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requireAction, Actions, clearRoleCache, logPermissionAction } from '../utils';

const db = admin.firestore();

const VALID_ROLES = [
  'system_admin',
  'event_manager',
  'rover_supervisor',
  'course_manager',
  'rover',
];

interface UpdateRoleRequest {
  roverId: string;
  newRole: string;
}

export const updateRole = onCall<UpdateRoleRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request) => {
  // 1. Check action permission
  await requireAction(request, Actions.ROVERS_CHANGE_ROLE);

  const { roverId, newRole } = request.data;

  if (!roverId) {
    throw new HttpsError('invalid-argument', 'Rover ID is required');
  }

  // 2. Validate new role
  if (!VALID_ROLES.includes(newRole)) {
    throw new HttpsError('invalid-argument', `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
  }

  // 3. Get rover document
  const roverRef = db.doc(`rovers/${roverId}`);
  const roverDoc = await roverRef.get();

  if (!roverDoc.exists) {
    throw new HttpsError('not-found', 'Rover not found');
  }

  const roverData = roverDoc.data()!;
  const oldRole = roverData.role;

  // 4. Prevent removing last system_admin
  if (oldRole === 'system_admin' && newRole !== 'system_admin') {
    const adminCount = await db.collection('rovers')
      .where('role', '==', 'system_admin')
      .where('isActive', '==', true)
      .get();

    if (adminCount.size <= 1) {
      throw new HttpsError('failed-precondition', 'Cannot remove the last system administrator');
    }
  }

  // 5. Update rover document
  await roverRef.update({
    role: newRole,
    roleChangedAt: admin.firestore.FieldValue.serverTimestamp(),
    roleChangedBy: request.auth!.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // 6. Update user document
  if (roverData.userId) {
    await db.collection('users').doc(roverData.userId).update({
      role: newRole,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // 7. Update custom claims
  if (roverData.userId) {
    try {
      const user = await admin.auth().getUser(roverData.userId);
      const currentClaims = user.customClaims || {};

      // Get new role's level
      const roleDoc = await db.collection('roles').doc(newRole).get();
      const level = roleDoc.exists ? roleDoc.data()!.level : 10;

      await admin.auth().setCustomUserClaims(roverData.userId, {
        ...currentClaims,
        role: newRole,
        level: level,
      });

      // Force token refresh on next request
      await admin.auth().revokeRefreshTokens(roverData.userId);
    } catch (authError) {
      console.error('Failed to update custom claims:', authError);
    }
  }

  // 8. Clear role cache
  clearRoleCache(oldRole);
  clearRoleCache(newRole);

  // 9. Log activity to rover's history
  await db.collection(`rovers/${roverId}/activities_history`).add({
    type: 'role_changed',
    entityType: 'system',
    entityId: roverId,
    entityTitle: 'Role Changed',
    description: `Role changed from ${oldRole} to ${newRole}`,
    activityDate: admin.firestore.FieldValue.serverTimestamp(),
    recordedAt: admin.firestore.FieldValue.serverTimestamp(),
    metadata: {
      oldRole,
      newRole,
      changedBy: request.auth!.uid,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // 10. Log audit event
  await logPermissionAction(request, 'role_change', 'rover', roverId, { oldRole, newRole });

  // 11. Notify rover
  if (roverData.fcmToken) {
    try {
      await admin.messaging().send({
        token: roverData.fcmToken,
        notification: {
          title: 'Role Updated',
          body: `Your role has been changed to ${newRole.replace('_', ' ')}`,
        },
        data: {
          type: 'role_changed',
          newRole,
        },
      });
    } catch (fcmError) {
      console.error('Failed to send FCM notification:', fcmError);
    }
  }

  return { success: true, roverId, oldRole, newRole };
});
