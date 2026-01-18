import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';

const db = admin.firestore();

// Cache roles for performance (TTL: 5 minutes)
const roleCache = new Map<string, { role: RoleData; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export interface RoleData {
  name: string;
  level: number;
  isSystemAdmin: boolean;
  permissions: Record<string, string[]>;
  actions: string[];
}

export interface AuthRequest {
  auth?: {
    uid: string;
    token?: Record<string, unknown>;
  };
}

/**
 * Get role data from cache or Firestore
 */
async function getRoleData(roleName: string): Promise<RoleData | null> {
  // Check cache
  const cached = roleCache.get(roleName);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.role;
  }

  // Fetch from Firestore
  const roleDoc = await db.collection('roles').doc(roleName).get();

  if (!roleDoc.exists) {
    console.error('Role not found:', roleName);
    return null;
  }

  const data = roleDoc.data()!;
  const roleData: RoleData = {
    name: roleName,
    level: data.level || 0,
    isSystemAdmin: data.isSystemAdmin || false,
    permissions: data.permissions || {},
    actions: data.actions || [],
  };

  // Cache it
  roleCache.set(roleName, { role: roleData, timestamp: Date.now() });

  return roleData;
}

/**
 * Get user's role data
 */
async function getUserRole(uid: string): Promise<RoleData | null> {
  // Try users collection first
  const userDoc = await db.collection('users').doc(uid).get();

  if (userDoc.exists) {
    const roleName = userDoc.data()!.role;
    if (roleName) {
      return getRoleData(roleName);
    }
  }

  // Try rovers collection
  const roverQuery = await db.collection('rovers')
    .where('userId', '==', uid)
    .limit(1)
    .get();

  if (!roverQuery.empty) {
    const roleName = roverQuery.docs[0].data().role;
    if (roleName) {
      return getRoleData(roleName);
    }
  }

  console.error('User role not found:', uid);
  return null;
}

/**
 * Check if user has permission on a collection
 */
export async function hasPermission(
  uid: string,
  collection: string,
  permission: string
): Promise<boolean> {
  const role = await getUserRole(uid);

  if (!role) return false;
  if (role.isSystemAdmin) return true;

  return role.permissions[collection]?.includes(permission) ?? false;
}

/**
 * Check if user can perform a specific action
 */
export async function canPerformAction(
  uid: string,
  action: string
): Promise<boolean> {
  const role = await getUserRole(uid);

  if (!role) return false;
  if (role.isSystemAdmin) return true;

  return role.actions.includes(action);
}

/**
 * Verify user has collection permission, throw error if not
 */
export async function requirePermission(
  request: AuthRequest,
  collection: string,
  permission: string
): Promise<void> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = request.auth.uid;
  const allowed = await hasPermission(uid, collection, permission);

  if (!allowed) {
    console.log(`Permission denied: ${uid} lacks ${collection}.${permission}`);
    throw new HttpsError(
      'permission-denied',
      `You do not have ${permission} permission on ${collection}`
    );
  }

  console.log(`Permission granted: ${uid} has ${collection}.${permission}`);
}

/**
 * Verify user can perform action, throw error if not
 */
export async function requireAction(
  request: AuthRequest,
  action: string
): Promise<void> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const uid = request.auth.uid;
  const allowed = await canPerformAction(uid, action);

  if (!allowed) {
    console.log(`Action denied: ${uid} cannot perform ${action}`);
    throw new HttpsError(
      'permission-denied',
      `You do not have permission to perform: ${action}`
    );
  }

  console.log(`Action granted: ${uid} can perform ${action}`);
}

/**
 * Check if user is system admin
 */
export async function isSystemAdmin(uid: string): Promise<boolean> {
  const role = await getUserRole(uid);
  return role?.isSystemAdmin ?? false;
}

/**
 * Check if user has admin-level access (level >= 50)
 */
export async function hasAdminAccess(uid: string): Promise<boolean> {
  const role = await getUserRole(uid);
  if (!role) return false;
  return role.isSystemAdmin || role.level >= 50;
}

/**
 * Get user's role name
 */
export async function getUserRoleName(uid: string): Promise<string | null> {
  const role = await getUserRole(uid);
  return role?.name ?? null;
}

/**
 * Clear role cache (call when role is updated)
 */
export function clearRoleCache(roleName?: string): void {
  if (roleName) {
    roleCache.delete(roleName);
  } else {
    roleCache.clear();
  }
}
