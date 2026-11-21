// src/pdf/pinVerify.ts
// ─────────────────────────────────────────────────────────────────────────
// PIN verification for the PDF export.
// Behaviour-identical extraction of PinGate.tsx:338-384.
// Same hash (SHA-256 + userId salt), same DB operations, same lockout.
//
// Section 6 of the prompt:
// - Verify through the EXISTING PIN verification, with server-side attempt
//   counting and lockout. A wrong PIN here counts exactly like a wrong PIN
//   at the gate.
// - The PIN is never stored, logged, sent anywhere, or written into the PDF.
// ─────────────────────────────────────────────────────────────────────────

// Matching PinGate.tsx:71,78-82
const MAX_ATTEMPTS = 3;
const LOCKOUT_ESCALATION_MS = [
  30 * 1000,       // 30 seconds  (1st lockout)
  2 * 60 * 1000,   // 2 minutes   (2nd lockout)
  10 * 60 * 1000,  // 10 minutes  (3rd+ lockout)
];

function getLockoutDuration(lockoutCount: number): number {
  return LOCKOUT_ESCALATION_MS[Math.min(lockoutCount - 1, 2)];
}

/** Result of a PIN verification attempt. */
export interface PinVerifyResult {
  ok: boolean;
  /** If !ok and not locked, how many attempts remain before lockout. */
  attemptsLeft: number;
  /** If locked, the UTC ISO 8601 timestamp when the lockout expires. */
  lockedUntil: string | null;
  /** Error message for the UI. */
  errorMessage: string | null;
  /** True when the user has no PIN set at all. */
  noPinSet: boolean;
}

/**
 * Hash a PIN string with the user's ID as salt.
 * Identical to PinGate.tsx:265-268.
 *
 * @param raw  The raw 4-digit PIN string
 * @param userId  The user's Clerk ID (salt)
 * @returns SHA-256 hex digest
 */
export async function hashPin(raw: string, userId: string): Promise<string> {
  const encoded = new TextEncoder().encode(raw + userId); // salted with userId
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify a 4-digit PIN against the database.
 * Identical behaviour to PinGate.tsx:338-384.
 *
 * On success: clears lockout state (attempts, locked_until, lockout_count).
 * On failure: increments attempt counter. After MAX_ATTEMPTS, sets lockout.
 *
 * @param supabase  Supabase client instance
 * @param userId    The user's Clerk ID
 * @param pin       The 4-digit PIN string (validated before calling)
 */
export async function verifyPin(
  supabase: any,
  userId: string,
  pin: string,
): Promise<PinVerifyResult> {
  // 1. Validate format (Section 6.2)
  if (!/^\d{4}$/.test(pin)) {
    return {
      ok: false,
      attemptsLeft: 0,
      lockedUntil: null,
      errorMessage: 'Invalid PIN format.',
      noPinSet: false,
    };
  }

  // 2. Fetch current PIN record
  const { data, error } = await supabase
    .from('user_pins')
    .select('pin_hash, locked_until, failed_attempts, lockout_count')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    // No PIN record — user hasn't set a PIN
    return {
      ok: false,
      attemptsLeft: 0,
      lockedUntil: null,
      errorMessage: null,
      noPinSet: true,
    };
  }

  if (!data.pin_hash) {
    return {
      ok: false,
      attemptsLeft: 0,
      lockedUntil: null,
      errorMessage: null,
      noPinSet: true,
    };
  }

  // 3. Check active lockout
  if (data.locked_until) {
    const lockedUntilMs = new Date(data.locked_until).getTime();
    if (lockedUntilMs > Date.now()) {
      return {
        ok: false,
        attemptsLeft: 0,
        lockedUntil: data.locked_until,
        errorMessage: null,
        noPinSet: false,
      };
    }
    // Lockout expired — clear failed_attempts (keep lockout_count for escalation)
    // Matching PinGate.tsx:181-184
    await supabase
      .from('user_pins')
      .update({ failed_attempts: 0, locked_until: null })
      .eq('user_id', userId);
    data.failed_attempts = 0;
  }

  // 4. Hash and compare (identical to PinGate.tsx:339,346)
  const hash = await hashPin(pin, userId);

  if (data.pin_hash === hash) {
    // Correct — clear all lockout state (PinGate.tsx:348-350)
    await supabase.from('user_pins').update({
      locked_until: null,
      failed_attempts: 0,
      lockout_count: 0,
    }).eq('user_id', userId);

    return {
      ok: true,
      attemptsLeft: MAX_ATTEMPTS,
      lockedUntil: null,
      errorMessage: null,
      noPinSet: false,
    };
  }

  // 5. Wrong PIN (PinGate.tsx:358-383)
  const currentAttempts = (data.failed_attempts ?? 0) + 1;

  if (currentAttempts >= MAX_ATTEMPTS) {
    // Trigger lockout — escalate
    const newLockoutCount = (data.lockout_count ?? 0) + 1;
    const duration = getLockoutDuration(newLockoutCount);
    const lockTime = new Date(Date.now() + duration).toISOString();

    await supabase.from('user_pins').update({
      locked_until: lockTime,
      failed_attempts: currentAttempts,
      lockout_count: newLockoutCount,
    }).eq('user_id', userId);

    return {
      ok: false,
      attemptsLeft: 0,
      lockedUntil: lockTime,
      errorMessage: null,
      noPinSet: false,
    };
  }

  // Persist failed attempt count (PinGate.tsx:380)
  await supabase.from('user_pins')
    .update({ failed_attempts: currentAttempts })
    .eq('user_id', userId);

  const remaining = MAX_ATTEMPTS - currentAttempts;
  return {
    ok: false,
    attemptsLeft: remaining,
    lockedUntil: null,
    errorMessage: `Wrong PIN. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`,
    noPinSet: false,
  };
}

/**
 * Check whether a user has a PIN set (without verifying it).
 * Used for the precondition check (Section 6.1).
 */
export async function hasPinSet(
  supabase: any,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('user_pins')
    .select('pin_hash')
    .eq('user_id', userId)
    .single();

  return !!(data && data.pin_hash);
}
