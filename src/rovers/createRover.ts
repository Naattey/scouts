import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import {
  requirePermission,
  validateRoverData,
  normalizePhone,
  generateScoutId,
  generateTempPassword,
  logCreate,
} from '../utils';

const db = admin.firestore();

interface CreateRoverRequest {
  fullName: string;
  email: string;
  phone: string;
  island: string;
  atoll?: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female';
  role?: string;
  sendWelcomeEmail?: boolean;
  autoApprove?: boolean;
}

interface CreateRoverResponse {
  success: boolean;
  roverId?: string;
  scoutId?: string;
  tempPassword?: string;
  error?: string;
}

export const createRover = onCall<CreateRoverRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request): Promise<CreateRoverResponse> => {
  const data = request.data;

  // 1. Check permission
  await requirePermission(request, 'rovers', 'write');

  // 2. Validate input data
  const validation = validateRoverData(data);
  if (!validation.valid) {
    throw new HttpsError('invalid-argument', validation.errors.join(', '));
  }

  // 3. Check for duplicate email
  const existingEmail = await db.collection('rovers')
    .where('email', '==', data.email.toLowerCase())
    .limit(1)
    .get();

  if (!existingEmail.empty) {
    throw new HttpsError('already-exists', 'A rover with this email already exists');
  }

  // 4. Check for duplicate phone
  const normalizedPhone = normalizePhone(data.phone);
  const existingPhone = await db.collection('rovers')
    .where('phone', '==', normalizedPhone)
    .limit(1)
    .get();

  if (!existingPhone.empty) {
    throw new HttpsError('already-exists', 'A rover with this phone number already exists');
  }

  try {
    // 5. Generate temporary password
    const tempPassword = generateTempPassword(12);

    // 6. Create Firebase Auth user
    const userRecord = await admin.auth().createUser({
      email: data.email.toLowerCase(),
      password: tempPassword,
      displayName: data.fullName,
      phoneNumber: normalizedPhone,
      disabled: false,
    });

    // 7. Generate Scout ID
    const scoutId = await generateScoutId();

    // 8. Determine role and approval status
    const role = data.role || 'rover';
    const isApproved = data.autoApprove === true;

    // 9. Set custom claims
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: role,
      roverId: null,
      isApproved: isApproved,
    });

    // 10. Create rover document
    const roverRef = db.collection('rovers').doc();
    const roverId = roverRef.id;

    const roverData = {
      id: roverId,
      userId: userRecord.uid,
      fullName: data.fullName.trim(),
      email: data.email.toLowerCase(),
      phone: normalizedPhone,
      island: data.island,
      atoll: data.atoll || null,
      dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
      gender: data.gender || null,
      scoutId: scoutId,
      role: role,
      isActive: true,
      isApproved: isApproved,
      isDeleted: false,
      profileImage: null,
      stats: {
        meetingsAttended: 0,
        eventsAttended: 0,
        coursesCompleted: 0,
        totalActivities: 0,
        lastActivityAt: null,
      },
      createdBy: request.auth!.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await roverRef.set(roverData);

    // 11. Update custom claims with roverId
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: role,
      roverId: roverId,
      isApproved: isApproved,
    });

    // 12. Create user document
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email: data.email.toLowerCase(),
      displayName: data.fullName,
      role: role,
      roverId: roverId,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 13. Send welcome email (if enabled)
    if (data.sendWelcomeEmail !== false) {
      await db.collection('mail').add({
        to: data.email.toLowerCase(),
        template: {
          name: 'welcome',
          data: {
            name: data.fullName,
            tempPassword: tempPassword,
            loginUrl: 'https://scout-app.web.app/login',
          },
        },
      });
    }

    // 14. Log activity
    await logCreate(request, 'rover', roverId, roverData);

    console.log(`Rover created: ${roverId} by ${request.auth!.uid}`);

    return {
      success: true,
      roverId: roverId,
      scoutId: scoutId,
      tempPassword: tempPassword,
    };

  } catch (error) {
    console.error('Error creating rover:', error);

    // Cleanup: If Auth user was created but Firestore failed
    if (error instanceof Error && !error.message.includes('auth')) {
      try {
        const users = await admin.auth().getUserByEmail(data.email);
        await admin.auth().deleteUser(users.uid);
      } catch (cleanupError) {
        console.error('Cleanup failed:', cleanupError);
      }
    }

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to create rover. Please try again.');
  }
});
