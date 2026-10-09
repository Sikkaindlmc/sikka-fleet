/**
 * Formats timestamps to India Timezone (Asia/Kolkata) with 24-hour format: DD-MM-YYYY HH:mm:ss
 */
export function formatDateTime(dateInput?: string | Date | null): string {
  if (!dateInput) return '—';

  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return '—';

    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(date)
      .replace(/\//g, '-');
  } catch {
    return '—';
  }
}

/**
 * Calculates and formats outside duration between plantOutDate and currentDate in HH:MM
 * E.g., difference between Plant Out Date Time and current date time.
 */
export function calculateOutsideHours(
  plantOutDate?: string | Date | null,
  currentDate: Date = new Date()
): string {
  if (!plantOutDate) return '—';

  try {
    const outTime = typeof plantOutDate === 'string' ? new Date(plantOutDate) : plantOutDate;
    if (isNaN(outTime.getTime())) return '—';

    const diffMs = currentDate.getTime() - outTime.getTime();
    if (diffMs < 0) return '00:00';

    const totalMinutes = Math.floor(diffMs / (60 * 1000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  } catch {
    return '—';
  }
}

/**
 * Returns color highlight classes for Outside Hour & Stay Hours badges:
 * - Upto 12:00 Hour -> Yellow background highlight
 * - Upto 24:00 Hour -> Orange background highlight
 * - Upto 36:00 Hour (and beyond) -> Red background highlight
 */
export function getDurationColorClasses(durationStr?: string | null): {
  badge: string;
  icon: string;
} {
  if (!durationStr || durationStr === '—') {
    return {
      badge: 'bg-slate-100 text-slate-700 border-slate-200/90',
      icon: 'text-slate-500',
    };
  }

  // Parse total minutes from "HH:MM" or "HH:MM Hrs"
  const clean = durationStr.replace(/[^\d:]/g, '');
  const [hStr, mStr] = clean.split(':');
  const hours = parseInt(hStr || '0', 10);
  const minutes = parseInt(mStr || '0', 10);
  const totalMinutes = (isNaN(hours) ? 0 : hours * 60) + (isNaN(minutes) ? 0 : minutes);

  if (totalMinutes <= 12 * 60) {
    // Upto 12:00 Hour -> Yellow color highlight
    return {
      badge: 'bg-yellow-100 text-yellow-950 border-yellow-300 font-bold',
      icon: 'text-yellow-700',
    };
  } else if (totalMinutes <= 24 * 60) {
    // Upto 24:00 Hour -> Orange color highlight
    return {
      badge: 'bg-orange-100 text-orange-950 border-orange-300 font-bold',
      icon: 'text-orange-700',
    };
  } else {
    // Upto 36:00 Hour and above -> Red color highlight
    return {
      badge: 'bg-red-100 text-red-950 border-red-300 font-bold',
      icon: 'text-red-700',
    };
  }
}

/**
 * Formats distance in meters or kilometers
 */
export function formatDistance(meters?: number | null): string {
  if (meters === undefined || meters === null || isNaN(meters)) return '—';
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Normalizes vehicle number (uppercase, no whitespace)
 */
export function normalizeVehicleNumber(val: string): string {
  return val.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Cleans phone number to exactly 10 digits
 */
export function clean10DigitPhone(val: string): string {
  // Remove country code prefix +91 or 91 if typed
  const digits = val.replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length > 10) {
    return digits.slice(2, 12);
  }
  return digits.slice(0, 10);
}
