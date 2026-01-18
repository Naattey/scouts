import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { notifyClassUpdate } from '../notifications';

const db = admin.firestore();

/**
 * Trigger: onClassWrite
 * Fires when a class document is created, updated, or deleted within a course.
 *
 * Responsibilities:
 * - Send admin notifications for class schedule changes
 * - Update course statistics
 */
export const onClassWrite = onDocumentWritten({
  document: 'courses/{courseId}/classes/{classId}',
  region: 'us-central1',
}, async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const courseId = event.params.courseId;
  const classId = event.params.classId;

  // Document was deleted
  if (!afterData && beforeData) {
    console.log(`Class deleted: ${classId} from course ${courseId}`);
    return;
  }

  // Document was created
  if (!beforeData && afterData) {
    console.log(`Class created: ${classId} for course ${courseId}`);
    await handleClassCreated(courseId, classId, afterData);
    return;
  }

  // Document was updated
  if (beforeData && afterData) {
    console.log(`Class updated: ${classId} for course ${courseId}`);
    await handleClassUpdated(courseId, classId, beforeData, afterData);
    return;
  }
});

async function handleClassCreated(
  courseId: string,
  classId: string,
  data: FirebaseFirestore.DocumentData
): Promise<void> {
  // Get course title for the notification
  const courseDoc = await db.doc(`courses/${courseId}`).get();
  const courseData = courseDoc.data();
  const courseTitle = courseData?.title || 'Course';
  const classTitle = data.title || 'New Class';

  // Notify admins about new class
  await notifyClassUpdate(
    courseId,
    classTitle,
    courseTitle,
    'created',
    data.createdBy
  );
}

async function handleClassUpdated(
  courseId: string,
  classId: string,
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData
): Promise<void> {
  // Check for significant schedule changes
  const hasSessionChanges = hasSignificantSessionChanges(before.sessions, after.sessions);
  const hasStatusChange = before.statusOverride !== after.statusOverride;
  const hasTitleChange = before.title !== after.title;

  if (hasSessionChanges || hasStatusChange || hasTitleChange) {
    // Get course title for the notification
    const courseDoc = await db.doc(`courses/${courseId}`).get();
    const courseData = courseDoc.data();
    const courseTitle = courseData?.title || 'Course';
    const classTitle = after.title || after.courseTitle || 'Class';

    // Determine action type
    const action = hasSessionChanges ? 'scheduled' : 'modified';

    await notifyClassUpdate(
      courseId,
      classTitle,
      courseTitle,
      action,
      after.updatedBy
    );
  }
}

/**
 * Check if session schedule has changed significantly
 */
function hasSignificantSessionChanges(
  beforeSessions: unknown[] | undefined,
  afterSessions: unknown[] | undefined
): boolean {
  if (!beforeSessions && !afterSessions) return false;
  if (!beforeSessions && afterSessions) return true;
  if (beforeSessions && !afterSessions) return true;

  // Compare session counts
  if (beforeSessions!.length !== afterSessions!.length) return true;

  // Compare session dates (simplified check)
  const beforeDates = beforeSessions!.map((s: unknown) => {
    const session = s as { date?: number | string };
    return session.date;
  }).sort();
  const afterDates = afterSessions!.map((s: unknown) => {
    const session = s as { date?: number | string };
    return session.date;
  }).sort();

  for (let i = 0; i < beforeDates.length; i++) {
    if (beforeDates[i] !== afterDates[i]) return true;
  }

  return false;
}
