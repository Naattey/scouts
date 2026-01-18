import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Generate a unique Scout ID in format: MV-YYYY-NNN
 * Uses a transaction to ensure uniqueness
 */
export async function generateScoutId(): Promise<string> {
  const year = new Date().getFullYear();

  return db.runTransaction(async (transaction) => {
    const counterRef = db.doc('counters/scout_ids');
    const counterDoc = await transaction.get(counterRef);

    let nextNumber = 1;
    if (counterDoc.exists) {
      const data = counterDoc.data()!;
      nextNumber = (data[year.toString()] || 0) + 1;
    }

    // Update counter
    transaction.set(counterRef, {
      [year.toString()]: nextNumber,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Format: MV-YYYY-NNN (minimum 3 digits)
    const paddedNumber = nextNumber.toString().padStart(3, '0');
    return `MV-${year}-${paddedNumber}`;
  });
}

/**
 * Parse a Scout ID into its components
 */
export function parseScoutId(scoutId: string): { year: number; number: number } | null {
  const match = scoutId.match(/^MV-(\d{4})-(\d+)$/);
  if (!match) return null;

  return {
    year: parseInt(match[1], 10),
    number: parseInt(match[2], 10),
  };
}

/**
 * Validate Scout ID format
 */
export function isValidScoutId(scoutId: string): boolean {
  return /^MV-\d{4}-\d{3,}$/.test(scoutId);
}

/**
 * Get the next Scout ID without consuming it (for preview)
 */
export async function previewNextScoutId(): Promise<string> {
  const year = new Date().getFullYear();
  const counterDoc = await db.doc('counters/scout_ids').get();

  let nextNumber = 1;
  if (counterDoc.exists) {
    const data = counterDoc.data()!;
    nextNumber = (data[year.toString()] || 0) + 1;
  }

  const paddedNumber = nextNumber.toString().padStart(3, '0');
  return `MV-${year}-${paddedNumber}`;
}
