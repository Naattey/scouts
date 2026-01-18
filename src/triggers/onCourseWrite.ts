import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { notifyCourseUpdate } from '../notifications';

const db = admin.firestore();

/**
 * Trigger: onCourseWrite
 * Fires when a course document is created, updated, or deleted.
 *
 * Responsibilities:
 * - Update course statistics
 * - Handle enrollment notifications
 * - Sync course data to enrollments
 */
export const onCourseWrite = onDocumentWritten({
  document: 'courses/{courseId}',
  region: 'us-central1',
}, async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();
  const courseId = event.params.courseId;

  // Document was deleted
  if (!afterData && beforeData) {
    console.log(`Course deleted: ${courseId}`);
    await handleCourseDeleted(courseId, beforeData);
    return;
  }

  // Document was created
  if (!beforeData && afterData) {
    console.log(`Course created: ${courseId}`);
    await handleCourseCreated(courseId, afterData);
    return;
  }

  // Document was updated
  if (beforeData && afterData) {
    console.log(`Course updated: ${courseId}`);
    await handleCourseUpdated(courseId, beforeData, afterData);
    return;
  }
});

async function handleCourseCreated(
  courseId: string,
  data: FirebaseFirestore.DocumentData
): Promise<void> {
  // Update course stats
  const statsRef = db.doc('stats/courses');
  await statsRef.set({
    totalCount: admin.firestore.FieldValue.increment(1),
    draftCount: data.status === 'draft' ? admin.firestore.FieldValue.increment(1) : 0,
    publishedCount: data.isPublished ? admin.firestore.FieldValue.increment(1) : 0,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Update course type counts
  if (data.courseType) {
    await db.doc('stats/courseTypes').set({
      [data.courseType]: admin.firestore.FieldValue.increment(1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // Update difficulty counts
  if (data.difficulty) {
    await db.doc('stats/courseDifficulty').set({
      [data.difficulty]: admin.firestore.FieldValue.increment(1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}

async function handleCourseUpdated(
  courseId: string,
  before: FirebaseFirestore.DocumentData,
  after: FirebaseFirestore.DocumentData
): Promise<void> {
  const batch = db.batch();
  const statsRef = db.doc('stats/courses');

  // Track publish status change
  if (!before.isPublished && after.isPublished) {
    batch.set(statsRef, {
      publishedCount: admin.firestore.FieldValue.increment(1),
      draftCount: admin.firestore.FieldValue.increment(-1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Notify rovers about new course
    await sendNewCourseNotification(courseId, after);

    // Notify admins about published course
    await notifyCourseUpdate(courseId, after.title, 'published', after.updatedBy);
  }

  if (before.isPublished && !after.isPublished) {
    batch.set(statsRef, {
      publishedCount: admin.firestore.FieldValue.increment(-1),
      draftCount: admin.firestore.FieldValue.increment(1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // Sync title changes to enrollments
  if (before.title !== after.title) {
    await syncCourseTitleToEnrollments(courseId, after.title);
  }

  // Track status changes
  if (before.status !== after.status && after.status === 'archived') {
    // Notify enrolled rovers about course archival
    await notifyCourseArchived(courseId, after);

    // Notify admins about archived course
    await notifyCourseUpdate(courseId, after.title, 'archived', after.updatedBy);
  }

  // Notify admins about modified course (if already published and significant changes)
  if (before.isPublished && after.isPublished && after.status !== 'archived') {
    const hasSignificantChanges =
      before.title !== after.title ||
      before.difficulty !== after.difficulty ||
      before.startDate !== after.startDate ||
      before.endDate !== after.endDate;

    if (hasSignificantChanges) {
      await notifyCourseUpdate(courseId, after.title, 'modified', after.updatedBy);
    }
  }

  await batch.commit();
}

async function handleCourseDeleted(
  courseId: string,
  data: FirebaseFirestore.DocumentData
): Promise<void> {
  const statsRef = db.doc('stats/courses');
  await statsRef.set({
    totalCount: admin.firestore.FieldValue.increment(-1),
    draftCount: data.status === 'draft' ? admin.firestore.FieldValue.increment(-1) : 0,
    publishedCount: data.isPublished ? admin.firestore.FieldValue.increment(-1) : 0,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Update course type counts
  if (data.courseType) {
    await db.doc('stats/courseTypes').set({
      [data.courseType]: admin.firestore.FieldValue.increment(-1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // Update difficulty counts
  if (data.difficulty) {
    await db.doc('stats/courseDifficulty').set({
      [data.difficulty]: admin.firestore.FieldValue.increment(-1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}

async function syncCourseTitleToEnrollments(
  courseId: string,
  newTitle: string
): Promise<void> {
  // Get all enrollments for this course
  const enrollments = await db.collection(`courses/${courseId}/enrollments`).get();

  const batch = db.batch();
  enrollments.forEach(doc => {
    batch.update(doc.ref, {
      courseTitle: newTitle,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  if (!enrollments.empty) {
    await batch.commit();
  }
}

async function sendNewCourseNotification(
  courseId: string,
  courseData: FirebaseFirestore.DocumentData
): Promise<void> {
  // Get all active rovers with FCM tokens
  const roversQuery = await db.collection('rovers')
    .where('isActive', '==', true)
    .where('isApproved', '==', true)
    .select('fcmToken')
    .get();

  const tokens: string[] = [];
  roversQuery.forEach(doc => {
    const token = doc.data().fcmToken;
    if (token) tokens.push(token);
  });

  if (tokens.length === 0) return;

  // Send multicast notification
  const batchSize = 500;
  for (let i = 0; i < tokens.length; i += batchSize) {
    const batchTokens = tokens.slice(i, i + batchSize);

    try {
      await admin.messaging().sendEachForMulticast({
        tokens: batchTokens,
        notification: {
          title: 'New Course Available',
          body: `${courseData.title} - ${courseData.difficulty}`,
        },
        data: {
          type: 'new_course',
          courseId,
        },
      });
    } catch (error) {
      console.error('Failed to send course notifications:', error);
    }
  }
}

async function notifyCourseArchived(
  courseId: string,
  courseData: FirebaseFirestore.DocumentData
): Promise<void> {
  // Get all enrolled participants
  const enrollments = await db.collection(`courses/${courseId}/enrollments`)
    .where('status', '==', 'enrolled')
    .get();

  for (const enrollDoc of enrollments.docs) {
    const enrollment = enrollDoc.data();
    const roverId = enrollment.roverId;

    const roverDoc = await db.doc(`rovers/${roverId}`).get();
    const roverData = roverDoc.data();

    if (roverData?.fcmToken) {
      try {
        await admin.messaging().send({
          token: roverData.fcmToken,
          notification: {
            title: 'Course Archived',
            body: `${courseData.title} has been archived`,
          },
          data: {
            type: 'course_archived',
            courseId,
          },
        });
      } catch (error) {
        console.error('Failed to send archive notification:', error);
      }
    }
  }
}
