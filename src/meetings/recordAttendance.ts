import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { requirePermission } from '../utils';

const db = admin.firestore();

type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

interface AttendanceRecord {
  roverId: string;
  status: AttendanceStatus;
  checkInTime?: string;
  checkOutTime?: string;
  notes?: string;
}

interface RecordAttendanceRequest {
  meetingId: string;
  attendance: AttendanceRecord[];
  finalize?: boolean;
}

interface RecordAttendanceResponse {
  success: boolean;
  meetingId: string;
  recordedCount: number;
  finalized: boolean;
}

export const recordAttendance = onCall<RecordAttendanceRequest>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 120,
}, async (request): Promise<RecordAttendanceResponse> => {
  // Check permission
  await requirePermission(request, 'meetings', 'write');

  const { meetingId, attendance, finalize } = request.data;

  if (!meetingId) {
    throw new HttpsError('invalid-argument', 'Meeting ID is required');
  }

  if (!attendance || !Array.isArray(attendance) || attendance.length === 0) {
    throw new HttpsError('invalid-argument', 'Attendance records are required');
  }

  // Get meeting
  const meetingRef = db.doc(`meetings/${meetingId}`);
  const meetingDoc = await meetingRef.get();

  if (!meetingDoc.exists) {
    throw new HttpsError('not-found', 'Meeting not found');
  }

  const meetingData = meetingDoc.data()!;

  // Check if already finalized
  if (meetingData.attendanceFinalized && finalize) {
    throw new HttpsError('failed-precondition', 'Attendance already finalized');
  }

  try {
    const batch = db.batch();
    let recordedCount = 0;

    for (const record of attendance) {
      if (!record.roverId || !record.status) {
        continue;
      }

      // Validate status
      const validStatuses: AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];
      if (!validStatuses.includes(record.status)) {
        continue;
      }

      // Get rover data for the record
      const roverDoc = await db.doc(`rovers/${record.roverId}`).get();
      const roverData = roverDoc.exists ? roverDoc.data()! : {};

      const attendanceRef = db.collection(`meetings/${meetingId}/attendance`).doc(record.roverId);

      batch.set(attendanceRef, {
        roverId: record.roverId,
        roverName: roverData.fullName || 'Unknown',
        roverScoutId: roverData.scoutId || null,
        status: record.status,
        checkInTime: record.checkInTime || null,
        checkOutTime: record.checkOutTime || null,
        notes: record.notes || null,
        recordedBy: request.auth!.uid,
        recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      recordedCount++;
    }

    // Update meeting
    const meetingUpdate: Record<string, unknown> = {
      lastAttendanceUpdate: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (finalize === true) {
      meetingUpdate.attendanceFinalized = true;
      meetingUpdate.attendanceFinalizedAt = admin.firestore.FieldValue.serverTimestamp();
      meetingUpdate.attendanceFinalizedBy = request.auth!.uid;
    }

    batch.update(meetingRef, meetingUpdate);

    await batch.commit();

    console.log(`Recorded ${recordedCount} attendance records for meeting ${meetingId}`);

    return {
      success: true,
      meetingId,
      recordedCount,
      finalized: finalize === true,
    };

  } catch (error) {
    console.error('Error recording attendance:', error);
    throw new HttpsError('internal', 'Failed to record attendance');
  }
});
