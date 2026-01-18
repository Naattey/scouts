import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();

interface EnrollCourseRequest {
  courseId: string;
  roverId?: string;
  notes?: string;
}

interface EnrollCourseResponse {
  success: boolean;
  enrollmentId: string;
  courseId: string;
  roverId: string;
}

export const enrollInCourse = onCall<EnrollCourseRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request): Promise<EnrollCourseResponse> => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }

  const { courseId, notes } = request.data;
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

  // Check if course is published
  if (!courseData.isPublished) {
    throw new HttpsError('failed-precondition', 'Course is not published');
  }

  // Check if course is archived
  if (courseData.status === 'archived') {
    throw new HttpsError('failed-precondition', 'Course is archived');
  }

  // Check capacity
  if (courseData.maxParticipants) {
    const currentCount = courseData.currentEnrollments || 0;
    if (currentCount >= courseData.maxParticipants) {
      throw new HttpsError('failed-precondition', 'Course is at full capacity');
    }
  }

  // Check if already enrolled
  const existingEnrollment = await db.collection(`courses/${courseId}/enrollments`)
    .where('roverId', '==', roverId)
    .limit(1)
    .get();

  if (!existingEnrollment.empty) {
    const enrollment = existingEnrollment.docs[0].data();
    if (enrollment.status !== 'withdrawn') {
      throw new HttpsError('already-exists', 'Already enrolled in this course');
    }
  }

  // Get rover data
  const roverDoc = await db.doc(`rovers/${roverId}`).get();
  if (!roverDoc.exists) {
    throw new HttpsError('not-found', 'Rover not found');
  }
  const roverData = roverDoc.data()!;

  // Check prerequisites
  if (courseData.prerequisites && courseData.prerequisites.length > 0) {
    const completedCourses = await db.collection(`rovers/${roverId}/activities_history`)
      .where('type', '==', 'course_completed')
      .get();

    const completedCourseIds = completedCourses.docs.map(doc => doc.data().entityId);

    for (const prereq of courseData.prerequisites) {
      if (!completedCourseIds.includes(prereq)) {
        throw new HttpsError('failed-precondition', 'Prerequisites not met');
      }
    }
  }

  try {
    // Create enrollment
    const enrollmentRef = db.collection(`courses/${courseId}/enrollments`).doc();

    const enrollmentData = {
      roverId,
      roverName: roverData.fullName,
      roverEmail: roverData.email,
      roverScoutId: roverData.scoutId,
      status: 'enrolled',
      progress: 0,
      notes: notes || null,
      enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
      enrolledBy: request.auth.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await enrollmentRef.set(enrollmentData);

    // Update enrollment count
    await courseRef.update({
      currentEnrollments: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Add to rover's activities
    await db.collection(`rovers/${roverId}/activities_history`).add({
      type: 'course_enrolled',
      entityType: 'course',
      entityId: courseId,
      entityTitle: courseData.title,
      description: `Enrolled in course: ${courseData.title}`,
      activityDate: admin.firestore.FieldValue.serverTimestamp(),
      recordedAt: admin.firestore.FieldValue.serverTimestamp(),
      metadata: {
        courseType: courseData.courseType,
        difficulty: courseData.difficulty,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Create course history record for rover
    await db.collection(`rovers/${roverId}/course_history`).doc(courseId).set({
      courseId,
      courseTitle: courseData.title,
      courseType: courseData.courseType,
      enrollmentId: enrollmentRef.id,
      status: 'enrolled',
      progress: 0,
      enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      enrollmentId: enrollmentRef.id,
      courseId,
      roverId,
    };

  } catch (error) {
    console.error('Error enrolling in course:', error);
    throw new HttpsError('internal', 'Failed to enroll in course');
  }
});
