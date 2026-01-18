import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requirePermission, logUpdate } from '../utils';

const db = admin.firestore();

interface UpdateCourseRequest {
  courseId: string;
  updates: {
    title?: string;
    description?: string;
    courseType?: string;
    category?: string;
    difficulty?: string;
    duration?: number;
    maxParticipants?: number;
    prerequisites?: string[];
    learningObjectives?: string[];
    syllabus?: string;
    instructor?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    isPublished?: boolean;
    metadata?: Record<string, unknown>;
  };
}

export const updateCourse = onCall<UpdateCourseRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request) => {
  // 1. Check permission
  await requirePermission(request, 'courses', 'write');

  const { courseId, updates } = request.data;

  if (!courseId) {
    throw new HttpsError('invalid-argument', 'Course ID is required');
  }

  // 2. Get existing course
  const courseRef = db.doc(`courses/${courseId}`);
  const courseDoc = await courseRef.get();

  if (!courseDoc.exists) {
    throw new HttpsError('not-found', 'Course not found');
  }

  const existingData = courseDoc.data()!;

  // 3. Build update object
  const updateData: Record<string, unknown> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: request.auth!.uid,
  };

  if (updates.title !== undefined) {
    if (updates.title.trim().length < 3) {
      throw new HttpsError('invalid-argument', 'Title must be at least 3 characters');
    }
    updateData.title = updates.title.trim();
  }

  if (updates.description !== undefined) {
    updateData.description = updates.description?.trim() || null;
  }

  if (updates.courseType !== undefined) {
    updateData.courseType = updates.courseType;
  }

  if (updates.category !== undefined) {
    updateData.category = updates.category;
  }

  if (updates.difficulty !== undefined) {
    updateData.difficulty = updates.difficulty;
  }

  if (updates.duration !== undefined) {
    updateData.duration = updates.duration;
  }

  if (updates.maxParticipants !== undefined) {
    updateData.maxParticipants = updates.maxParticipants;
  }

  if (updates.prerequisites !== undefined) {
    updateData.prerequisites = updates.prerequisites;
  }

  if (updates.learningObjectives !== undefined) {
    updateData.learningObjectives = updates.learningObjectives;
  }

  if (updates.syllabus !== undefined) {
    updateData.syllabus = updates.syllabus;
  }

  if (updates.instructor !== undefined) {
    updateData.instructor = updates.instructor;
  }

  if (updates.startDate !== undefined) {
    const startDate = new Date(updates.startDate);
    if (!isNaN(startDate.getTime())) {
      updateData.startDate = admin.firestore.Timestamp.fromDate(startDate);
    }
  }

  if (updates.endDate !== undefined) {
    const endDate = new Date(updates.endDate);
    if (!isNaN(endDate.getTime())) {
      updateData.endDate = admin.firestore.Timestamp.fromDate(endDate);
    }
  }

  if (updates.status !== undefined) {
    updateData.status = updates.status;
  }

  if (updates.isPublished !== undefined) {
    updateData.isPublished = updates.isPublished;
    if (updates.isPublished && !existingData.publishedAt) {
      updateData.publishedAt = admin.firestore.FieldValue.serverTimestamp();
      updateData.publishedBy = request.auth!.uid;
    }
  }

  if (updates.metadata !== undefined) {
    updateData.metadata = updates.metadata;
  }

  try {
    // 4. Update course
    await courseRef.update(updateData);

    // 5. Log audit event
    await logUpdate(request, 'course', courseId, existingData, updateData);

    return { success: true, courseId };

  } catch (error) {
    console.error('Error updating course:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to update course');
  }
});
