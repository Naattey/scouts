/**
 * Maldives phone number regex
 * Valid formats: +960XXXXXXX, 00960XXXXXXX, 7XXXXXX, 9XXXXXX
 */
export const MALDIVES_PHONE_REGEX = /^(?:\+960\s?|00960\s?)?[79]\d{6}$/;

/**
 * Validate Maldives phone number
 */
export function validatePhone(phone: string): { valid: boolean; error?: string } {
  const cleaned = phone.replace(/\s/g, '');

  if (!cleaned) {
    return { valid: false, error: 'Phone number is required' };
  }

  if (!MALDIVES_PHONE_REGEX.test(cleaned)) {
    return {
      valid: false,
      error: 'Phone must be a valid Maldives number starting with 7 or 9',
    };
  }

  return { valid: true };
}

/**
 * Normalize phone number to +960XXXXXXX format
 */
export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\s/g, '');

  // Convert 00960 to +960
  if (cleaned.startsWith('00960')) {
    cleaned = '+960' + cleaned.substring(5);
  }

  // Add +960 if not present
  if (!cleaned.startsWith('+960') && /^[79]\d{6}$/.test(cleaned)) {
    cleaned = '+960' + cleaned;
  }

  return cleaned;
}

/**
 * Format phone number for display: +960 XXXXXXX
 */
export function formatPhone(phone: string): string {
  const normalized = normalizePhone(phone);

  if (normalized.startsWith('+960') && normalized.length === 11) {
    return '+960 ' + normalized.substring(4);
  }

  return normalized;
}

/**
 * Extract local number (without country code)
 */
export function getLocalNumber(phone: string): string {
  const normalized = normalizePhone(phone);

  if (normalized.startsWith('+960')) {
    return normalized.substring(4);
  }

  return normalized;
}
