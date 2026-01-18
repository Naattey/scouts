import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Notification types for admin notifications
 */
export type AdminNotificationType =
  | 'newRoverRegistration'
  | 'roverApproved'
  | 'eventUpdated'
  | 'meetingUpdated'
  | 'courseUpdated'
  | 'classUpdated'
  | 'systemAlert';

/**
 * Target types for navigation
 */
export type NotificationTargetType = 'event' | 'meeting' | 'course' | 'rover' | 'system';

/**
 * Notification data structure
 */
export interface AdminNotificationData {
  type: AdminNotificationType;
  title: string;
  body: string;
  targetId?: string;
  targetType?: NotificationTargetType;
}

/**
 * Get all admin rover IDs
 * Admins are rovers with roles that have admin permissions
 */
async function getAdminRoverIds(): Promise<string[]> {
  // Get roles with admin-level permissions
  const rolesSnapshot = await db.collection('roles')
    .where('isAdmin', '==', true)
    .get();

  const adminRoleNames = rolesSnapshot.docs.map(doc => doc.data().name);

  if (adminRoleNames.length === 0) {
    // Fallback to default admin roles if no roles marked as admin
    adminRoleNames.push('superadmin', 'admin', 'secretary');
  }

  // Get all active rovers with admin roles
  const roversSnapshot = await db.collection('rovers')
    .where('status', '==', 'active')
    .where('role', 'in', adminRoleNames.slice(0, 10)) // Firestore 'in' limit is 10
    .select()
    .get();

  return roversSnapshot.docs.map(doc => doc.id);
}

/**
 * Notify all admin users with an in-app notification
 * Creates notification documents in each admin's notifications subcollection
 */
export async function notifyAdmins(
  data: AdminNotificationData,
  excludeRoverId?: string
): Promise<void> {
  try {
    const adminRoverIds = await getAdminRoverIds();

    if (adminRoverIds.length === 0) {
      console.log('No admin rovers found to notify');
      return;
    }

    const now = Date.now();
    const batch = db.batch();
    let count = 0;

    for (const roverId of adminRoverIds) {
      // Skip the rover who triggered the notification (if specified)
      if (excludeRoverId && roverId === excludeRoverId) {
        continue;
      }

      const notificationRef = db
        .collection('rovers')
        .doc(roverId)
        .collection('notifications')
        .doc();

      batch.set(notificationRef, {
        roverId,
        type: data.type,
        title: data.title,
        body: data.body,
        targetId: data.targetId || null,
        targetType: data.targetType || null,
        createdAt: now,
        isRead: false,
        readAt: null,
      });

      count++;
    }

    if (count > 0) {
      await batch.commit();
      console.log(`Sent ${count} admin notifications for type: ${data.type}`);
    }
  } catch (error) {
    console.error('Failed to notify admins:', error);
  }
}

/**
 * Send notification for new rover registration (pending approval)
 */
export async function notifyNewRoverRegistration(
  roverId: string,
  roverName: string
): Promise<void> {
  await notifyAdmins({
    type: 'newRoverRegistration',
    title: 'New Rover Registration',
    body: `${roverName} has registered and is awaiting approval`,
    targetId: roverId,
    targetType: 'rover',
  });
}

/**
 * Send notification when a rover is approved
 */
export async function notifyRoverApproved(
  roverId: string,
  roverName: string,
  approvedByRoverId?: string
): Promise<void> {
  await notifyAdmins(
    {
      type: 'roverApproved',
      title: 'Rover Approved',
      body: `${roverName} has been approved`,
      targetId: roverId,
      targetType: 'rover',
    },
    approvedByRoverId
  );
}

/**
 * Send notification for event updates
 */
export async function notifyEventUpdate(
  eventId: string,
  eventTitle: string,
  action: 'published' | 'cancelled' | 'modified',
  updatedByRoverId?: string
): Promise<void> {
  const actionText = {
    published: 'was published',
    cancelled: 'was cancelled',
    modified: 'was modified',
  }[action];

  await notifyAdmins(
    {
      type: 'eventUpdated',
      title: `Event ${action.charAt(0).toUpperCase() + action.slice(1)}`,
      body: `${eventTitle} ${actionText}`,
      targetId: eventId,
      targetType: 'event',
    },
    updatedByRoverId
  );
}

/**
 * Send notification for meeting updates
 */
export async function notifyMeetingUpdate(
  meetingId: string,
  meetingTitle: string,
  action: 'created' | 'modified' | 'cancelled',
  updatedByRoverId?: string
): Promise<void> {
  const actionText = {
    created: 'was created',
    modified: 'was modified',
    cancelled: 'was cancelled',
  }[action];

  await notifyAdmins(
    {
      type: 'meetingUpdated',
      title: `Meeting ${action.charAt(0).toUpperCase() + action.slice(1)}`,
      body: `${meetingTitle} ${actionText}`,
      targetId: meetingId,
      targetType: 'meeting',
    },
    updatedByRoverId
  );
}

/**
 * Send notification for course updates
 */
export async function notifyCourseUpdate(
  courseId: string,
  courseTitle: string,
  action: 'published' | 'archived' | 'modified',
  updatedByRoverId?: string
): Promise<void> {
  const actionText = {
    published: 'was published',
    archived: 'was archived',
    modified: 'was modified',
  }[action];

  await notifyAdmins(
    {
      type: 'courseUpdated',
      title: `Course ${action.charAt(0).toUpperCase() + action.slice(1)}`,
      body: `${courseTitle} ${actionText}`,
      targetId: courseId,
      targetType: 'course',
    },
    updatedByRoverId
  );
}

/**
 * Send notification for class schedule updates
 */
export async function notifyClassUpdate(
  courseId: string,
  classTitle: string,
  courseTitle: string,
  action: 'created' | 'modified' | 'scheduled',
  updatedByRoverId?: string
): Promise<void> {
  const actionText = {
    created: 'was created',
    modified: 'was modified',
    scheduled: 'schedule was updated',
  }[action];

  await notifyAdmins(
    {
      type: 'classUpdated',
      title: 'Class Update',
      body: `${classTitle} (${courseTitle}) ${actionText}`,
      targetId: courseId,
      targetType: 'course',
    },
    updatedByRoverId
  );
}

/**
 * Send system alert notification to all admins
 */
export async function notifySystemAlert(
  title: string,
  message: string
): Promise<void> {
  await notifyAdmins({
    type: 'systemAlert',
    title,
    body: message,
    targetType: 'system',
  });
}
