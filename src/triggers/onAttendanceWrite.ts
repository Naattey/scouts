import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Trigger: onAttendanceWrite
 * Fires when any attendance document is created, updated, or deleted.
 *
 * Cost Optimization:
 * - Aggregates attendance counts into parent meeting document
 * - Reduces reads from N (attendance docs) to 1 (meeting doc)
 */
export const onAttendanceWrite = onDocumentWritten({
  document: 'meetings/{meetingId}/attendance/{attendanceId}',
  region: 'us-central1',
}, async (event) => {
  const meetingId = event.params.meetingId;

  console.log(`Aggregating attendance counts for meeting: ${meetingId}`);

  try {
    const meetingRef = db.collection('meetings').doc(meetingId);
    const attendanceSnapshot = await meetingRef.collection('attendance').get();

    // Count by status
    let present = 0;
    let absent = 0;
    let late = 0;
    let excused = 0;

    attendanceSnapshot.docs.forEach(doc => {
      const status = doc.data().status;
      switch (status) {
        case 'present':
          present++;
          break;
        case 'absent':
          absent++;
          break;
        case 'late':
          late++;
          break;
        case 'excused':
          excused++;
          break;
      }
    });

    // Update meeting document with aggregated counts
    await meetingRef.update({
      attendanceCounts: {
        present,
        absent,
        late,
        excused,
        total: attendanceSnapshot.size,
      },
      lastAttendanceUpdate: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Updated meeting ${meetingId} with attendance counts:`, {
      present, absent, late, excused, total: attendanceSnapshot.size,
    });

  } catch (error) {
    console.error('Error aggregating attendance counts:', error);
    throw error;
  }
});
