import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Default roles configuration
 *
 * Level hierarchy:
 * - 0-10: Basic users (rovers)
 * - 50+: Admin users
 * - 100: System admin (full access)
 */
export const DEFAULT_ROLES = {
  // Basic rover role - all approved users get this by default
  rover: {
    name: 'rover',
    level: 10,
    isSystemAdmin: false,
    description: 'Basic rover with portal access',
    permissions: {
      // View-only access to their own data
      rovers: ['read'],
      events: ['read'],
      meetings: ['read'],
      courses: ['read'],
    },
    actions: [
      // Can register for events
      'events-register',
      // Can enroll in courses
      'courses-enroll',
    ],
  },

  // Rover supervisor - can manage rovers in their area
  rover_supervisor: {
    name: 'rover_supervisor',
    level: 30,
    isSystemAdmin: false,
    description: 'Supervisor with rover management access',
    permissions: {
      rovers: ['read', 'write', 'update'],
      events: ['read'],
      meetings: ['read', 'write', 'update'],
      courses: ['read'],
    },
    actions: [
      'events-register',
      'courses-enroll',
      'meetings-create',
      'meetings-update',
      'meetings-attendance',
    ],
  },

  // Event manager - can manage events
  event_manager: {
    name: 'event_manager',
    level: 50,
    isSystemAdmin: false,
    description: 'Manager with event administration access',
    permissions: {
      rovers: ['read'],
      events: ['read', 'write', 'update'],
      meetings: ['read'],
      courses: ['read'],
    },
    actions: [
      'events-register',
      'events-create',
      'events-update',
      'events-delete',
      'events-publish',
      'events-cancel',
      'courses-enroll',
    ],
  },

  // Course manager - can manage courses
  course_manager: {
    name: 'course_manager',
    level: 50,
    isSystemAdmin: false,
    description: 'Manager with course administration access',
    permissions: {
      rovers: ['read'],
      events: ['read'],
      meetings: ['read'],
      courses: ['read', 'write', 'update'],
    },
    actions: [
      'events-register',
      'courses-enroll',
      'courses-create',
      'courses-update',
      'courses-delete',
      'courses-publish',
      'classes-create',
      'classes-update',
      'classes-delete',
      'classes-grade',
      'submissions-grade',
    ],
  },

  // Admin - full management access except system settings
  admin: {
    name: 'admin',
    level: 80,
    isSystemAdmin: false,
    description: 'Administrator with full management access',
    permissions: {
      rovers: ['read', 'write', 'update'],
      events: ['read', 'write', 'update'],
      meetings: ['read', 'write', 'update'],
      courses: ['read', 'write', 'update'],
      roles: ['read'],
    },
    actions: [
      // Events
      'events-register',
      'events-create',
      'events-update',
      'events-delete',
      'events-publish',
      'events-cancel',
      'events-approve',
      // Meetings
      'meetings-create',
      'meetings-update',
      'meetings-delete',
      'meetings-finalize',
      'meetings-attendance',
      // Rovers
      'rovers-create',
      'rovers-update',
      'rovers-approve',
      'rovers-reject',
      'rovers-deactivate',
      'rovers-reset-password',
      // Courses
      'courses-enroll',
      'courses-create',
      'courses-update',
      'courses-delete',
      'courses-publish',
      'classes-create',
      'classes-update',
      'classes-delete',
      'classes-grade',
      'submissions-grade',
    ],
  },

  // System admin - full access to everything
  system_admin: {
    name: 'system_admin',
    level: 100,
    isSystemAdmin: true,
    description: 'System administrator with unrestricted access',
    permissions: {
      rovers: ['read', 'write', 'update'],
      events: ['read', 'write', 'update'],
      meetings: ['read', 'write', 'update'],
      courses: ['read', 'write', 'update'],
      roles: ['read', 'write', 'update'],
      users: ['read', 'write', 'update'],
    },
    actions: [
      // All actions
      'events-create', 'events-update', 'events-delete', 'events-publish', 'events-cancel', 'events-approve', 'events-register',
      'meetings-create', 'meetings-update', 'meetings-delete', 'meetings-finalize', 'meetings-attendance',
      'rovers-create', 'rovers-update', 'rovers-delete', 'rovers-approve', 'rovers-reject', 'rovers-deactivate', 'rovers-reset-password', 'rovers-change-role',
      'courses-create', 'courses-update', 'courses-delete', 'courses-publish', 'courses-enroll',
      'classes-create', 'classes-update', 'classes-delete', 'classes-grade', 'submissions-grade',
      'roles-create', 'roles-update', 'roles-delete',
      'users-create', 'users-update', 'users-delete',
      'settings-update',
      'reports-export',
      'audit-view',
    ],
  },

  // Superadmin - same as system_admin (alias for support users)
  superadmin: {
    name: 'superadmin',
    level: 100,
    isSystemAdmin: true,
    description: 'Super administrator (support/developer access)',
    permissions: {
      rovers: ['read', 'write', 'update'],
      events: ['read', 'write', 'update'],
      meetings: ['read', 'write', 'update'],
      courses: ['read', 'write', 'update'],
      roles: ['read', 'write', 'update'],
      users: ['read', 'write', 'update'],
    },
    actions: [
      'events-create', 'events-update', 'events-delete', 'events-publish', 'events-cancel', 'events-approve', 'events-register',
      'meetings-create', 'meetings-update', 'meetings-delete', 'meetings-finalize', 'meetings-attendance',
      'rovers-create', 'rovers-update', 'rovers-delete', 'rovers-approve', 'rovers-reject', 'rovers-deactivate', 'rovers-reset-password', 'rovers-change-role',
      'courses-create', 'courses-update', 'courses-delete', 'courses-publish', 'courses-enroll',
      'classes-create', 'classes-update', 'classes-delete', 'classes-grade', 'submissions-grade',
      'roles-create', 'roles-update', 'roles-delete',
      'users-create', 'users-update', 'users-delete',
      'settings-update',
      'reports-export',
      'audit-view',
    ],
  },
};

interface SeedRolesRequest {
  secretKey?: string;
  overwrite?: boolean;
}

interface SeedRolesResponse {
  success: boolean;
  message: string;
  created: string[];
  skipped: string[];
  updated: string[];
}

/**
 * Seeds default roles into Firestore
 *
 * Can be called:
 * - Without authentication if secretKey is provided (for initial setup)
 * - With admin authentication (for updates)
 */
export const seedRoles = onCall<SeedRolesRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request): Promise<SeedRolesResponse> => {
  const { secretKey, overwrite = false } = request.data || {};

  // Validate access - either secretKey or admin user
  const validSecretKey = process.env.SUPPORT_SEED_KEY || 'scout-support-2024-secret';
  const hasSecretKey = secretKey === validSecretKey;

  if (!hasSecretKey && !request.auth) {
    throw new HttpsError('permission-denied', 'Authentication required');
  }

  // If authenticated, check if user is admin
  if (request.auth && !hasSecretKey) {
    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    const userData = userDoc.data();
    const userRole = userData?.role;

    if (!['system_admin', 'superadmin', 'admin'].includes(userRole)) {
      throw new HttpsError('permission-denied', 'Admin access required');
    }
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const updated: string[] = [];

  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (const [roleName, roleData] of Object.entries(DEFAULT_ROLES)) {
    const roleRef = db.collection('roles').doc(roleName);
    const existingRole = await roleRef.get();

    if (existingRole.exists && !overwrite) {
      skipped.push(roleName);
      continue;
    }

    const data = {
      ...roleData,
      createdAt: existingRole.exists ? existingRole.data()?.createdAt : now,
      updatedAt: now,
    };

    batch.set(roleRef, data, { merge: true });

    if (existingRole.exists) {
      updated.push(roleName);
    } else {
      created.push(roleName);
    }
  }

  await batch.commit();

  console.log(`Roles seeded: created=${created.length}, updated=${updated.length}, skipped=${skipped.length}`);

  return {
    success: true,
    message: `Roles seeded successfully`,
    created,
    skipped,
    updated,
  };
});

/**
 * Get all available roles
 */
export const getRoles = onCall({
  region: 'us-central1',
  memory: '256MiB',
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const rolesSnapshot = await db.collection('roles')
    .orderBy('level', 'asc')
    .get();

  const roles = rolesSnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  }));

  return { roles };
});
