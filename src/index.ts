import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
admin.initializeApp();

// ============================================
// ROVER CALLABLE FUNCTIONS
// ============================================
export {
  createRover,
  updateRover,
  deleteRover,
  approveRover,
  rejectRover,
  resetPassword,
  updateRole,
} from './rovers';

// ============================================
// EVENT CALLABLE FUNCTIONS
// ============================================
export {
  createEvent,
  updateEvent,
  deleteEvent,
  registerForEvent,
  cancelEventRegistration,
} from './events';

// ============================================
// MEETING CALLABLE FUNCTIONS
// ============================================
export {
  createMeeting,
  updateMeeting,
  deleteMeeting,
  recordAttendance,
} from './meetings';

// ============================================
// COURSE CALLABLE FUNCTIONS
// ============================================
export {
  createCourse,
  updateCourse,
  deleteCourse,
  enrollInCourse,
  withdrawFromCourse,
} from './courses';

// ============================================
// FIRESTORE TRIGGERS
// ============================================
export { onRoverWrite } from './triggers/onRoverWrite';
export { onMeetingWrite } from './triggers/onMeetingWrite';
export { onMeetingAttendanceFinalized } from './triggers/onMeetingAttendanceFinalized';
export { onActivityHistoryCreate } from './triggers/onActivityHistoryCreate';
export { onEventWrite } from './triggers/onEventWrite';
export { onCourseWrite } from './triggers/onCourseWrite';
export { onClassWrite } from './triggers/onClassWrite';

// Cost Optimization: Write-time Aggregation Triggers
export { onAttendanceWrite } from './triggers/onAttendanceWrite';
export { onRegistrationWrite } from './triggers/onRegistrationWrite';
export { onEnrollmentWrite } from './triggers/onEnrollmentWrite';

// ============================================
// STORAGE TRIGGERS
// ============================================
export { onImageUpload } from './triggers/onImageUpload';

// ============================================
// SCHEDULED FUNCTIONS
// ============================================
export {
  sendEventReminders,
  sendMeetingReminders,
} from './scheduled/eventReminders';

export {
  cleanupOldAuditLogs,
  cleanupExpiredSessions,
  updateEventStatuses,
  generateDailyStats,
  updateDashboardAggregates,
} from './scheduled/cleanup';

// ============================================
// ADMIN CALLABLE FUNCTIONS
// ============================================
export { seedSupportUser, seedRoles, getRoles, initializeApp, createSuperadmin } from './admin';
