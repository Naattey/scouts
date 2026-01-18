import * as admin from 'firebase-admin';
import { AuthRequest } from './permissions';

const db = admin.firestore();

export interface AuditLogEntry {
  action: string;
  entity: string;
  entityId: string | null;
  userId: string;
  userEmail?: string;
  userRole?: string;
  changes?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Log an action to the audit log
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    await db.collection('audit_logs').add({
      ...entry,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Audit: ${entry.action} on ${entry.entity}/${entry.entityId} by ${entry.userId}`);
  } catch (error) {
    console.error('Failed to log audit event:', error);
    // Don't throw - audit logging should not break the main operation
  }
}

/**
 * Log permission-guarded action from a request
 */
export async function logPermissionAction(
  request: AuthRequest,
  action: string,
  entity: string,
  entityId: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!request.auth) return;

  await logAuditEvent({
    action,
    entity,
    entityId,
    userId: request.auth.uid,
    userEmail: request.auth.token?.email as string | undefined,
    userRole: request.auth.token?.role as string | undefined,
    metadata,
  });
}

/**
 * Log a create action
 */
export async function logCreate(
  request: AuthRequest,
  entity: string,
  entityId: string,
  data: Record<string, unknown>
): Promise<void> {
  await logPermissionAction(request, 'create', entity, entityId, {
    createdData: data,
  });
}

/**
 * Log an update action
 */
export async function logUpdate(
  request: AuthRequest,
  entity: string,
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Promise<void> {
  if (!request.auth) return;

  await logAuditEvent({
    action: 'update',
    entity,
    entityId,
    userId: request.auth.uid,
    userEmail: request.auth.token?.email as string | undefined,
    userRole: request.auth.token?.role as string | undefined,
    changes: { before, after },
  });
}

/**
 * Log a delete action
 */
export async function logDelete(
  request: AuthRequest,
  entity: string,
  entityId: string,
  deletedData?: Record<string, unknown>
): Promise<void> {
  await logPermissionAction(request, 'delete', entity, entityId, {
    deletedData,
  });
}
