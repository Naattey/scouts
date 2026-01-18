/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Rover data interface
 */
export interface RoverData {
  fullName: string;
  email: string;
  phone: string;
  island: string;
  atoll?: string | null;
  dateOfBirth?: string | Date | null;
  gender?: 'male' | 'female' | null;
  role?: string;
}

/**
 * Validate rover data
 */
export function validateRoverData(data: Partial<RoverData>): ValidationResult {
  const errors: string[] = [];

  // Full name validation
  if (!data.fullName || data.fullName.trim().length < 2) {
    errors.push('Full name must be at least 2 characters');
  } else if (data.fullName.length > 255) {
    errors.push('Full name must not exceed 255 characters');
  }

  // Email validation
  if (!data.email) {
    errors.push('Email is required');
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      errors.push('Invalid email format');
    }
  }

  // Phone validation (Maldives format)
  if (!data.phone) {
    errors.push('Phone number is required');
  } else {
    const phoneRegex = /^(?:\+960\s?|00960\s?)?[79]\d{6}$/;
    const cleanedPhone = data.phone.replace(/\s/g, '');
    if (!phoneRegex.test(cleanedPhone)) {
      errors.push('Phone must be a valid Maldives number (starting with 7 or 9)');
    }
  }

  // Island validation
  if (!data.island || data.island.trim().length < 2) {
    errors.push('Island is required');
  }

  // Gender validation
  if (data.gender && !['male', 'female'].includes(data.gender)) {
    errors.push('Gender must be male or female');
  }

  // Date of birth validation
  if (data.dateOfBirth) {
    const dob = new Date(data.dateOfBirth);
    if (isNaN(dob.getTime())) {
      errors.push('Invalid date of birth');
    } else {
      const now = new Date();
      const age = now.getFullYear() - dob.getFullYear();
      if (age < 10 || age > 100) {
        errors.push('Age must be between 10 and 100 years');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): ValidationResult {
  const errors: string[] = [];

  if (password.length < 6) {
    errors.push('Password must be at least 6 characters');
  }

  if (password.length > 100) {
    errors.push('Password must not exceed 100 characters');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitize string input
 */
export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML/script tags
    .substring(0, 1000); // Limit length
}

/**
 * Validate required fields
 */
export function validateRequired(
  data: Record<string, unknown>,
  requiredFields: string[]
): ValidationResult {
  const errors: string[] = [];

  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      errors.push(`${field} is required`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
