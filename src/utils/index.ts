// Permission utilities
export {
  hasPermission,
  canPerformAction,
  requirePermission,
  requireAction,
  isSystemAdmin,
  hasAdminAccess,
  getUserRoleName,
  clearRoleCache,
  AuthRequest,
  RoleData,
} from './permissions';

// Action constants
export { Actions, Permissions, Collections } from './actions';
export type { ActionType, PermissionType, CollectionType } from './actions';

// Audit utilities
export {
  logAuditEvent,
  logPermissionAction,
  logCreate,
  logUpdate,
  logDelete,
  AuditLogEntry,
} from './audit';

// Validation utilities
export {
  validateRoverData,
  validateEmail,
  validatePassword,
  validateRequired,
  sanitizeString,
  RoverData,
  ValidationResult,
} from './validation';

// Phone utilities
export {
  validatePhone,
  normalizePhone,
  formatPhone,
  getLocalNumber,
  MALDIVES_PHONE_REGEX,
} from './phone';

// Password utilities
export {
  generateTempPassword,
  generateSecureToken,
  hashPassword,
} from './password';

// Scout ID utilities
export {
  generateScoutId,
  parseScoutId,
  isValidScoutId,
  previewNextScoutId,
} from './scoutId';
