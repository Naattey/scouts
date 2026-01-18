import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requireAction, Actions, isSystemAdmin, logDelete } from '../utils';

const db = admin.firestore();

interface DeleteCourseRequest {
  courseId: string;
  reason?: string;
  hardDelete?: boolean;
}

export const deleteCourse = onCall<DeleteCourseRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request) => {
  // 1. Check action permission
  await requireAction(request, Actions.COURSES_DELETE);

  const { courseId, reason, hardDelete } = request.data;

  if (!courseId) {
    throw new HttpsError('invalid-argument', 'Course ID is required');
  }

  // 2. Get course document
  const courseRef = db.doc(`courses/${courseId}`);
  const courseDoc = await courseRef.get();

  if (!courseDoc.exists) {
    throw new HttpsError('not-found', 'Course not found');
  }

  const courseData = courseDoc.data()!;

  // 3. Only system admin can hard delete
  if (hardDelete === true) {
    const isSysAdmin = await isSystemAdmin(request.auth!.uid);
    if (!isSysAdmin) {
      throw new HttpsError('permission-denied', 'Only system admins can permanently delete');
    }
  }

  try {
    if (hardDelete === true) {
      // Hard delete - remove permanently
      const subcollections = ['classes', 'enrollments', 'materials'];

      for (const subcol of subcollections) {
        const docs = await db.collection(`courses/${courseId}/${subcol}`).listDocuments();
        const batch = db.batch();
        docs.forEach(doc => batch.delete(doc));
        if (docs.length > 0) {
          await batch.commit();
        }
      }

      await courseRef.delete();

    } else {
      // Soft delete
      await courseRef.update({
        isDeleted: true,
        isPublished: false,
        status: 'archived',
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletedBy: request.auth!.uid,
        deletionReason: reason || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 4. Log audit event
    await logDelete(request, 'course', courseId, courseData);

    return { success: true, courseId, hardDelete: hardDelete === true };

  } catch (error) {
    console.error('Error deleting course:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to delete course');
  }
});
