import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { hasPermission, normalizePhone, logUpdate } from '../utils';

const db = admin.firestore();

interface UpdateRoverRequest {
  roverId: string;
  updates: {
    fullName?: string;
    phone?: string;
    island?: string;
    atoll?: string;
    dateOfBirth?: string;
    gender?: 'male' | 'female';
  };
}

export const updateRover = onCall<UpdateRoverRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request) => {
  // 1. Check authentication
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const { roverId, updates } = request.data;
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

  // 3. Check authorization (own profile or has permission)
  const isOwner = roverData.userId === request.auth.uid;
  const hasUpdatePermission = await hasPermission(request.auth.uid, 'rovers', 'update');

  if (!isOwner && !hasUpdatePermission) {
    throw new HttpsError('permission-denied', 'Cannot update this rover');
  }

  // 4. Build update object
  const updateData: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: request.auth.uid,
  };

  // Validate and add allowed fields
  if (updates.fullName) {
    if (updates.fullName.length < 2 || updates.fullName.length > 255) {
      throw new HttpsError('invalid-argument', 'Name must be 2-255 characters');
    }
    updateData.fullName = updates.fullName.trim();
  }

  if (updates.phone) {
    const normalizedPhone = normalizePhone(updates.phone);

    // Check for duplicate phone (excluding current rover)
    const existingPhone = await db.collection('rovers')
      .where('phone', '==', normalizedPhone)
      .limit(1)
      .get();

    if (!existingPhone.empty && existingPhone.docs[0].id !== roverId) {
      throw new HttpsError('already-exists', 'Phone number already in use');
    }

    updateData.phone = normalizedPhone;
  }

  if (updates.island) {
    updateData.island = updates.island;
  }

  if (updates.atoll !== undefined) {
    updateData.atoll = updates.atoll || null;
  }

  if (updates.dateOfBirth) {
    updateData.dateOfBirth = new Date(updates.dateOfBirth);
  }

  if (updates.gender) {
    updateData.gender = updates.gender;
  }

  // 5. Update rover document
  await roverRef.update(updateData);

  // 6. Update Firebase Auth display name if changed
  if (updates.fullName && roverData.userId) {
    try {
      await admin.auth().updateUser(roverData.userId, {
        displayName: updates.fullName,
      });
    } catch (authError) {
      console.error('Failed to update Auth display name:', authError);
    }
  }

  // 7. Log activity
  await logUpdate(request, 'rover', roverId, roverData, { ...roverData, ...updateData });

  return { success: true, roverId };
});
