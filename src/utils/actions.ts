/**
 * Action constants to prevent typos
 */
export const Actions = {
  // Events
  EVENTS_CREATE: 'events-create',
  EVENTS_UPDATE: 'events-update',
  EVENTS_DELETE: 'events-delete',
  EVENTS_PUBLISH: 'events-publish',
  EVENTS_CANCEL: 'events-cancel',
  EVENTS_APPROVE: 'events-approve',
  EVENTS_REGISTER: 'events-register',

  // Meetings
  MEETINGS_CREATE: 'meetings-create',
  MEETINGS_UPDATE: 'meetings-update',
  MEETINGS_DELETE: 'meetings-delete',
  MEETINGS_FINALIZE: 'meetings-finalize',
  MEETINGS_ATTENDANCE: 'meetings-attendance',

  // Rovers
  ROVERS_CREATE: 'rovers-create',
  ROVERS_UPDATE: 'rovers-update',
  ROVERS_DELETE: 'rovers-delete',
  ROVERS_APPROVE: 'rovers-approve',
  ROVERS_REJECT: 'rovers-reject',
  ROVERS_DEACTIVATE: 'rovers-deactivate',
  ROVERS_RESET_PASSWORD: 'rovers-reset-password',
  ROVERS_CHANGE_ROLE: 'rovers-change-role',

  // Courses
  COURSES_CREATE: 'courses-create',
  COURSES_UPDATE: 'courses-update',
  COURSES_DELETE: 'courses-delete',
  COURSES_PUBLISH: 'courses-publish',
  CLASSES_CREATE: 'classes-create',
  CLASSES_UPDATE: 'classes-update',
  CLASSES_DELETE: 'classes-delete',
  CLASSES_GRADE: 'classes-grade',
  SUBMISSIONS_GRADE: 'submissions-grade',

  // Roles
  ROLES_CREATE: 'roles-create',
  ROLES_UPDATE: 'roles-update',
  ROLES_DELETE: 'roles-delete',

  // Users/System
  USERS_CREATE: 'users-create',
  USERS_UPDATE: 'users-update',
  USERS_DELETE: 'users-delete',
  SETTINGS_UPDATE: 'settings-update',
  REPORTS_EXPORT: 'reports-export',
  AUDIT_VIEW: 'audit-view',
} as const;

export type ActionType = typeof Actions[keyof typeof Actions];

/**
 * Permission constants
 */
export const Permissions = {
  READ: 'read',
  WRITE: 'write',
  UPDATE: 'update',
} as const;

export type PermissionType = typeof Permissions[keyof typeof Permissions];

/**
 * Collection names
 */
export const Collections = {
  ROVERS: 'rovers',
  EVENTS: 'events',
  MEETINGS: 'meetings',
  COURSES: 'courses',
  CLASS_INSTANCES: 'class_instances',
  ROLES: 'roles',
  USERS: 'users',
} as const;

export type CollectionType = typeof Collections[keyof typeof Collections];
