import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { generateScoutId } from '../utils';
import { DEFAULT_ROLES } from './seedRoles';

const db = admin.firestore();

// The only email allowed to access the initializer
const ALLOWED_INITIALIZER_EMAIL = 'tropicalisreal@gmail.com';

interface InitializeAppRequest {
  fullName: string;
  phone?: string;
  atoll: string;
  island: string;
}

interface InitializeAppResponse {
  success: boolean;
  message: string;
  rolesCreated: number;
}

interface CreateSuperadminRequest {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  atoll: string;
  island: string;
}

interface CreateSuperadminResponse {
  success: boolean;
  message: string;
  email?: string;
}

/**
 * Initialize the application - creates system_admin role and assigns to authenticated user
 *
 * Security:
 * - Requires authentication
 * - Only tropicalisreal@gmail.com can call this
 * - Creates system_admin role if it doesn't exist
 * - Assigns system_admin role to the caller
 */
export const initializeApp = onCall<InitializeAppRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 120,
}, async (request): Promise<InitializeAppResponse> => {
  // 1. Require authentication
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be logged in to initialize the app');
  }

  // 2. Verify the caller is the allowed email
  const callerEmail = request.auth.token.email?.toLowerCase();
  if (callerEmail !== ALLOWED_INITIALIZER_EMAIL) {
    throw new HttpsError('permission-denied', 'You are not authorized to initialize the app');
  }

  const { fullName, phone, atoll, island } = request.data;

  // 3. Validate required fields
  if (!fullName || fullName.trim().length < 2) {
    throw new HttpsError('invalid-argument', 'Full name is required (minimum 2 characters)');
  }
  if (!atoll || !island) {
    throw new HttpsError('invalid-argument', 'Atoll and island are required');
  }

  try {
    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const rolesCreated: string[] = [];

    // 4. Seed all default roles
    for (const [roleName, roleData] of Object.entries(DEFAULT_ROLES)) {
      const roleRef = db.collection('roles').doc(roleName);
      const existingRole = await roleRef.get();

      if (!existingRole.exists) {
        batch.set(roleRef, {
          ...roleData,
          createdAt: now,
          updatedAt: now,
        });
        rolesCreated.push(roleName);
      }
    }

    // 5. Check if rover already exists for this user
    const existingRoverQuery = await db.collection('rovers')
      .where('email', '==', callerEmail)
      .limit(1)
      .get();

    let roverId: string;
    const timestamp = Date.now();

    if (!existingRoverQuery.empty) {
      // Update existing rover to system_admin
      roverId = existingRoverQuery.docs[0].id;
      const roverRef = db.collection('rovers').doc(roverId);
      batch.update(roverRef, {
        role: 'system_admin',
        isSystemUser: true,
        isSystemAdmin: true,
        status: 'active',
        isDeleted: false,
        fullName: fullName.trim(),
        phone: phone ? `+960 ${phone.replace(/[^\d]/g, '')}` : null,
        atoll: atoll,
        island: island,
        updatedAt: timestamp,
      });
    } else {
      // Create new rover document
      const scoutId = await generateScoutId();
      const roverRef = db.collection('rovers').doc();
      roverId = roverRef.id;

      batch.set(roverRef, {
        fullName: fullName.trim(),
        email: callerEmail,
        phone: phone ? `+960 ${phone.replace(/[^\d]/g, '')}` : null,
        island: island,
        atoll: atoll,
        scoutId: scoutId,
        role: 'system_admin',
        status: 'active',
        isDeleted: false,
        isSystemUser: true,
        isSystemAdmin: true,
        eventsAttended: 0,
        meetingsAttended: 0,
        coursesEnrolled: 0,
        profileImageUrl: null,
        profileThumbnailUrl: null,
        approvedBy: 'system_initialization',
        approvedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: {
          createdBy: 'initializeApp',
          purpose: 'System admin created during app initialization',
        },
      });
    }

    // 6. Create/update Users document
    const userRef = db.collection('users').doc(request.auth.uid);
    batch.set(userRef, {
      uid: request.auth.uid,
      email: callerEmail,
      displayName: fullName.trim(),
      role: 'system_admin',
      roverId: roverId,
      isActive: true,
      isSystemUser: true,
      isSystemAdmin: true,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });

    // 7. Create/update initialization audit record
    const initRef = db.collection('system').doc('initialization');
    batch.set(initRef, {
      initializedAt: now,
      initializedBy: {
        uid: request.auth.uid,
        email: callerEmail,
        roverId: roverId,
      },
      rolesSeeded: rolesCreated,
    }, { merge: true });

    // 8. Commit all writes
    await batch.commit();

    // 9. Set custom claims
    await admin.auth().setCustomUserClaims(request.auth.uid, {
      role: 'system_admin',
      roverId: roverId,
      isApproved: true,
      isSystemUser: true,
      isSystemAdmin: true,
    });

    // 10. Update display name in Firebase Auth
    await admin.auth().updateUser(request.auth.uid, {
      displayName: fullName.trim(),
    });

    console.log(`App initialized by ${callerEmail}: roverId=${roverId}, roles_created=${rolesCreated.length}`);

    return {
      success: true,
      message: `Initialization complete. You are now a system_admin. ${rolesCreated.length} roles were created.`,
      rolesCreated: rolesCreated.length,
    };

  } catch (error) {
    console.error('Error initializing app:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to initialize application. Please try again.');
  }
});

/**
 * Create a superadmin user
 *
 * Security:
 * - Requires authentication
 * - Only tropicalisreal@gmail.com can call this
 * - Creates a new superadmin user with provided details
 */
export const createSuperadmin = onCall<CreateSuperadminRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 120,
}, async (request): Promise<CreateSuperadminResponse> => {
  // 1. Require authentication
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be logged in');
  }

  // 2. Verify the caller is the allowed email
  const callerEmail = request.auth.token.email?.toLowerCase();
  if (callerEmail !== ALLOWED_INITIALIZER_EMAIL) {
    throw new HttpsError('permission-denied', 'You are not authorized to create superadmins');
  }

  const { fullName, email, password, phone, atoll, island } = request.data;

  // 3. Validate required fields
  if (!fullName || fullName.trim().length < 2) {
    throw new HttpsError('invalid-argument', 'Full name is required (minimum 2 characters)');
  }
  if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Valid email is required');
  }
  if (!password || password.length < 6) {
    throw new HttpsError('invalid-argument', 'Password must be at least 6 characters');
  }
  if (!atoll || !island) {
    throw new HttpsError('invalid-argument', 'Atoll and island are required');
  }

  const normalizedEmail = email.toLowerCase();

  // 4. Check if email already exists
  try {
    await admin.auth().getUserByEmail(normalizedEmail);
    throw new HttpsError('already-exists', 'An account with this email already exists');
  } catch (error: unknown) {
    if (error instanceof HttpsError) throw error;
    // auth/user-not-found is expected - continue
  }

  try {
    // 5. Create Firebase Auth user
    const userRecord = await admin.auth().createUser({
      email: normalizedEmail,
      password: password,
      displayName: fullName.trim(),
      emailVerified: true, // Skip verification for admin-created users
      disabled: false,
    });

    // 6. Generate Scout ID
    const scoutId = await generateScoutId();

    // 7. Create Rover document
    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const timestamp = Date.now();

    const roverRef = db.collection('rovers').doc();
    const roverId = roverRef.id;

    batch.set(roverRef, {
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone: phone ? `+960 ${phone.replace(/[^\d]/g, '')}` : null,
      island: island,
      atoll: atoll,
      scoutId: scoutId,
      role: 'superadmin',
      status: 'active',
      isDeleted: false,
      isSystemUser: false, // Visible in UI
      isSystemAdmin: true,
      eventsAttended: 0,
      meetingsAttended: 0,
      coursesEnrolled: 0,
      profileImageUrl: null,
      profileThumbnailUrl: null,
      approvedBy: callerEmail,
      approvedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: {
        createdBy: 'createSuperadmin',
        createdByUid: request.auth.uid,
      },
    });

    // 8. Create Users document
    const userRef = db.collection('users').doc(userRecord.uid);
    batch.set(userRef, {
      uid: userRecord.uid,
      email: normalizedEmail,
      displayName: fullName.trim(),
      role: 'superadmin',
      roverId: roverId,
      isActive: true,
      isSystemUser: false,
      isSystemAdmin: true,
      createdAt: now,
      updatedAt: now,
    });

    // 9. Commit writes
    await batch.commit();

    // 10. Set custom claims
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: 'superadmin',
      roverId: roverId,
      isApproved: true,
      isSystemUser: false,
      isSystemAdmin: true,
    });

    console.log(`Superadmin created by ${callerEmail}: ${normalizedEmail}, roverId=${roverId}`);

    return {
      success: true,
      message: `Superadmin created successfully for ${normalizedEmail}`,
      email: normalizedEmail,
    };

  } catch (error) {
    console.error('Error creating superadmin:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to create superadmin. Please try again.');
  }
});
