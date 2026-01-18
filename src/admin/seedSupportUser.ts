import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { generateScoutId, generateTempPassword } from '../utils';

const db = admin.firestore();

/**
 * Configuration for the hidden support user
 * This user has full admin access but is hidden from all UI lists
 */
const SUPPORT_USER_CONFIG = {
  email: 'support@innosolve.dev',
  fullName: 'System Support',
  phone: '+9609999999',
  island: 'Male',
  atoll: "Kaafu",
  role: 'superadmin',
};

interface SeedSupportUserRequest {
  secretKey: string;
}

interface SeedSupportUserResponse {
  success: boolean;
  message: string;
  credentials?: {
    email: string;
    tempPassword: string;
  };
  error?: string;
}

/**
 * Seeds a hidden support user for production access
 *
 * Security:
 * - Requires a secret key (should be set in environment/config)
 * - Only creates if no system user exists
 * - User is marked as isSystemUser = true (hidden from all UI)
 * - Has superadmin role with full permissions
 *
 * Usage:
 * Call once during initial deployment or when support access is needed
 */
export const seedSupportUser = onCall<SeedSupportUserRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request): Promise<SeedSupportUserResponse> => {
  const { secretKey } = request.data;

  // 1. Validate secret key (use Firebase config or environment variable)
  const validSecretKey = process.env.SUPPORT_SEED_KEY || 'scout-support-2024-secret';

  if (!secretKey || secretKey !== validSecretKey) {
    throw new HttpsError('permission-denied', 'Invalid secret key');
  }

  // 2. Check if system user already exists
  const existingSystemUser = await db.collection('rovers')
    .where('isSystemUser', '==', true)
    .limit(1)
    .get();

  if (!existingSystemUser.empty) {
    return {
      success: false,
      message: 'System support user already exists',
    };
  }

  // 3. Check if email is already in use
  try {
    const existingAuth = await admin.auth().getUserByEmail(SUPPORT_USER_CONFIG.email);
    if (existingAuth) {
      // Email exists in Auth but no system user in Firestore - cleanup scenario
      console.log('Found orphaned auth user, will reuse');
    }
  } catch {
    // Email doesn't exist - good, we'll create it
  }

  try {
    // 4. Generate secure password
    const tempPassword = generateTempPassword(16);

    // 5. Create or get Firebase Auth user
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(SUPPORT_USER_CONFIG.email);
      // Update existing user's password
      await admin.auth().updateUser(userRecord.uid, {
        password: tempPassword,
        displayName: SUPPORT_USER_CONFIG.fullName,
        disabled: false,
      });
    } catch {
      // Create new user
      userRecord = await admin.auth().createUser({
        email: SUPPORT_USER_CONFIG.email,
        password: tempPassword,
        displayName: SUPPORT_USER_CONFIG.fullName,
        disabled: false,
      });
    }

    // 6. Generate Scout ID
    const scoutId = await generateScoutId();

    // 7. Set custom claims with superadmin role
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: SUPPORT_USER_CONFIG.role,
      roverId: null,
      isApproved: true,
      isSystemUser: true,
    });

    // 8. Create rover document with isSystemUser flag
    const roverRef = db.collection('rovers').doc();
    const roverId = roverRef.id;
    const now = Date.now();

    const roverData = {
      fullName: SUPPORT_USER_CONFIG.fullName,
      email: SUPPORT_USER_CONFIG.email,
      phone: SUPPORT_USER_CONFIG.phone,
      island: SUPPORT_USER_CONFIG.island,
      atoll: SUPPORT_USER_CONFIG.atoll,
      scoutId: scoutId,
      role: SUPPORT_USER_CONFIG.role,
      status: 'active',
      isDeleted: false,
      isSystemUser: true, // Hidden from all UI lists
      eventsAttended: 0,
      meetingsAttended: 0,
      coursesEnrolled: 0,
      profileImageUrl: null,
      profileThumbnailUrl: null,
      approvedBy: 'system',
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
      metadata: {
        createdBy: 'seedSupportUser',
        purpose: 'Production support and debugging',
      },
    };

    await roverRef.set(roverData);

    // 9. Update custom claims with roverId
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: SUPPORT_USER_CONFIG.role,
      roverId: roverId,
      isApproved: true,
      isSystemUser: true,
    });

    // 10. Create user document
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email: SUPPORT_USER_CONFIG.email,
      displayName: SUPPORT_USER_CONFIG.fullName,
      role: SUPPORT_USER_CONFIG.role,
      roverId: roverId,
      isActive: true,
      isSystemUser: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`System support user created: ${roverId}`);

    return {
      success: true,
      message: 'System support user created successfully',
      credentials: {
        email: SUPPORT_USER_CONFIG.email,
        tempPassword: tempPassword,
      },
    };

  } catch (error) {
    console.error('Error creating support user:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to create support user');
  }
});
