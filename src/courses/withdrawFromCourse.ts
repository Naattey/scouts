import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();

interface WithdrawCourseRequest {
  courseId: string;
  roverId?: string;
  reason?: string;
}

interface WithdrawCourseResponse {
  success: boolean;
  courseId: string;
  roverId: string;
}

export const withdrawFromCourse = onCall<WithdrawCourseRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request): Promise<WithdrawCourseResponse> => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }

  const { courseId, reason } = request.data;
  let { roverId } = request.data;

  if (!courseId) {
    throw new HttpsError('invalid-argument', 'Course ID is required');
  }

  // Default to caller's rover profile
  if (!roverId) {
    const roverQuery = await db.collection('rovers')
      .where('userId', '==', request.auth.uid)
      .limit(1)
      .get();

    if (roverQuery.empty) {
      throw new HttpsError('failed-precondition', 'No rover profile found');
    }
    roverId = roverQuery.docs[0].id;
  }

  // Get course
  const courseRef = db.doc(`courses/${courseId}`);
  const courseDoc = await courseRef.get();

  if (!courseDoc.exists) {
    throw new HttpsError('not-found', 'Course not found');
  }

  const courseData = courseDoc.data()!;

  // Find enrollment
  const enrollmentQuery = await db.collection(`courses/${courseId}/enrollments`)
    .where('roverId', '==', roverId)
    .where('status', '==', 'enrolled')
    .limit(1)
    .get();

  if (enrollmentQuery.empty) {
    throw new HttpsError('not-found', 'Enrollment not found');
  }

  const enrollmentDoc = enrollmentQuery.docs[0];

  try {
    // Update enrollment status
    await enrollmentDoc.ref.update({
      status: 'withdrawn',
      withdrawnAt: admin.firestore.FieldValue.serverTimestamp(),
      withdrawnBy: request.auth.uid,
      withdrawalReason: reason || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Decrement enrollment count
    await courseRef.update({
      currentEnrollments: admin.firestore.FieldValue.increment(-1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update rover's course history
    await db.doc(`rovers/${roverId}/course_history/${courseId}`).update({
      status: 'withdrawn',
      withdrawnAt: admin.firestore.FieldValue.serverTimestamp(),
      withdrawalReason: reason || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Add to rover's activities
    await db.collection(`rovers/${roverId}/activities_history`).add({
      type: 'course_withdrawn',
      entityType: 'course',
      entityId: courseId,
      entityTitle: courseData.title,
      description: `Withdrew from course: ${courseData.title}`,
      activityDate: admin.firestore.FieldValue.serverTimestamp(),
      recordedAt: admin.firestore.FieldValue.serverTimestamp(),
      metadata: {
        reason: reason || null,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      courseId,
      roverId,
    };

  } catch (error) {
    console.error('Error withdrawing from course:', error);
    throw new HttpsError('internal', 'Failed to withdraw from course');
  }
});
