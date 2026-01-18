import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Trigger: onEnrollmentWrite
 * Fires when any enrollment document is created, updated, or deleted.
 *
 * Cost Optimization:
 * - Aggregates enrollment counts into parent course document
 * - Reduces reads from N (enrollment docs) to 1 (course doc)
 */
export const onEnrollmentWrite = onDocumentWritten({
  document: 'courses/{courseId}/enrollments/{enrollmentId}',
  region: 'us-central1',
}, async (event) => {
  const courseId = event.params.courseId;

  console.log(`Aggregating enrollment counts for course: ${courseId}`);

  try {
    const courseRef = db.collection('courses').doc(courseId);
    const enrollmentsSnapshot = await courseRef.collection('enrollments').get();

    // Count by status
    let enrolled = 0;
    let pending = 0;
    let completed = 0;
    let withdrawn = 0;
    let waitlisted = 0;

    enrollmentsSnapshot.docs.forEach(doc => {
      const status = doc.data().status;
      switch (status) {
        case 'enrolled':
          enrolled++;
          break;
        case 'pending':
          pending++;
          break;
        case 'completed':
          completed++;
          break;
        case 'withdrawn':
          withdrawn++;
          break;
        case 'waitlisted':
          waitlisted++;
          break;
      }
    });

    // Update course document with aggregated counts
    await courseRef.update({
      enrollmentCounts: {
        enrolled,
        pending,
        completed,
        withdrawn,
        waitlisted,
        total: enrollmentsSnapshot.size,
      },
      enrollmentCount: enrolled, // Quick access to enrolled count
      lastEnrollmentUpdate: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Updated course ${courseId} with enrollment counts:`, {
      enrolled, pending, completed, withdrawn, waitlisted, total: enrollmentsSnapshot.size,
    });

  } catch (error) {
    console.error('Error aggregating enrollment counts:', error);
    throw error;
  }
});
