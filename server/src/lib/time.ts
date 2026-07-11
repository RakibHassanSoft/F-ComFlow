// Small, dependency-free time helpers (kept neutral so both channels.ts and
// notifications.ts can use them without a circular import).

export const BD_UTC_OFFSET_HOURS = 6; // Bangladesh is UTC+6 (no DST)

// Is the given moment inside the merchant's business hours?
// Null start/end means "always open". Supports overnight ranges (e.g. 20–6).
export function isWithinBusinessHours(
  date: Date,
  startHour: number | null | undefined,
  endHour: number | null | undefined
): boolean {
  if (startHour == null || endHour == null) return true;
  const localHour = (date.getUTCHours() + BD_UTC_OFFSET_HOURS) % 24;
  if (startHour === endHour) return true;            // treated as open all day
  if (startHour < endHour) return localHour >= startHour && localHour < endHour;
  return localHour >= startHour || localHour < endHour; // overnight window
}
