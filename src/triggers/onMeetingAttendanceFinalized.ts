import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Trigger: onMeetingAttendanceFinalized
 * Fires when a meeting's attendance is finalized.
 *
 * Responsibilities:
 * - Add attendance records to each rover's activities_history
 * - Update rover attendance statistics
 */
export const onMeetingAttendanceFinalized = onDocumentUpdated({
  document: 'meetings/{meetingId}',
  region: 'us-central1',
}, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();

  if (!before || !after) return;

  // Only process when attendance is being finalized
  if (before.attendanceFinalized === true || after.attendanceFinalized !== true) {
    return;
  }

  const meetingId = event.params.meetingId;
  console.log(`Processing finalized attendance for meeting: ${meetingId}`);

  try {
    // Get all attendance records for this meeting
    const attendanceSnapshot = await db
      .collection(`meetings/${meetingId}/attendance`)
      .get();

    if (attendanceSnapshot.empty) {
      console.log('No attendance records found');
      return;
    }

    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const attendanceDoc of attendanceSnapshot.docs) {
      const attendance = attendanceDoc.data();
      const roverId = attendance.roverId;

      if (!roverId) continue;

      // Add activity to rover's history
      const activityRef = db.collection(`rovers/${roverId}/activities_history`).doc();

      batch.set(activityRef, {
        type: 'meeting_attended',
        entityType: 'meeting',
        entityId: meetingId,
        entityTitle: after.title || 'Meeting',
        description: `Attended meeting: ${after.title}`,
        activityDate: after.date || now,
        recordedAt: now,
        metadata: {
          meetingType: after.meetingType,
          location: after.location,
          duration: after.duration,
          status: attendance.status, // present, absent, late, excused
          checkInTime: attendance.checkInTime,
          checkOutTime: attendance.checkOutTime,
        },
        createdAt: now,
      });

      // Update rover's attendance stats
      const roverRef = db.doc(`rovers/${roverId}`);
      const statsUpdate: Record<string, unknown> = {
        'stats.totalMeetings': admin.firestore.FieldValue.increment(1),
        'stats.lastMeetingDate': after.date || now,
        updatedAt: now,
      };

      if (attendance.status === 'present' || attendance.status === 'late') {
        statsUpdate['stats.attendedMeetings'] = admin.firestore.FieldValue.increment(1);
      }

      batch.update(roverRef, statsUpdate);
    }

    await batch.commit();
    console.log(`Processed ${attendanceSnapshot.size} attendance records`);

  } catch (error) {
    console.error('Error processing meeting attendance:', error);
    throw error;
  }
});
