import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requirePermission, logCreate } from '../utils';

const db = admin.firestore();

interface CreateCourseRequest {
  title: string;
  description?: string;
  courseType: string;
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
  metadata?: Record<string, unknown>;
}

interface CreateCourseResponse {
  success: boolean;
  courseId: string;
}

export const createCourse = onCall<CreateCourseRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request): Promise<CreateCourseResponse> => {
  // 1. Check permission
  await requirePermission(request, 'courses', 'write');

  const data = request.data;

  // 2. Validate required fields
  if (!data.title || data.title.trim().length < 3) {
    throw new HttpsError('invalid-argument', 'Course title must be at least 3 characters');
  }

  if (!data.courseType) {
    throw new HttpsError('invalid-argument', 'Course type is required');
  }

  try {
    // 3. Create course document
    const courseRef = db.collection('courses').doc();

    const courseData: Record<string, unknown> = {
      title: data.title.trim(),
      description: data.description?.trim() || null,
      courseType: data.courseType,
      category: data.category || null,
      difficulty: data.difficulty || 'beginner',
      duration: data.duration || null,
      maxParticipants: data.maxParticipants || null,
      currentEnrollments: 0,
      prerequisites: data.prerequisites || [],
      learningObjectives: data.learningObjectives || [],
      syllabus: data.syllabus || null,
      instructor: data.instructor || null,
      status: 'draft',
      isPublished: false,
      metadata: data.metadata || {},

      // IMPORTANT: createdBy uses request.auth.uid
      // This is the Firebase Auth UID of the authenticated user
      createdBy: request.auth!.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (data.startDate) {
      const startDate = new Date(data.startDate);
      if (!isNaN(startDate.getTime())) {
        courseData.startDate = admin.firestore.Timestamp.fromDate(startDate);
      }
    }

    if (data.endDate) {
      const endDate = new Date(data.endDate);
      if (!isNaN(endDate.getTime())) {
        courseData.endDate = admin.firestore.Timestamp.fromDate(endDate);
      }
    }

    await courseRef.set(courseData);

    // 4. Log audit event
    await logCreate(request, 'course', courseRef.id, courseData);

    console.log(`Course created: ${courseRef.id} by ${request.auth!.uid}`);

    return {
      success: true,
      courseId: courseRef.id,
    };

  } catch (error) {
    console.error('Error creating course:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to create course');
  }
});
