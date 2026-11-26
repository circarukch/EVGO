const IST_OFFSET_MIN = 330;

/** "HH:mm" in India Standard Time for a UTC instant. */
export function istClock(d: Date): string {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return t.toISOString().slice(11, 16);
}

/** The UTC instant for a local IST date ("YYYY-MM-DD") and time ("HH:mm"). */
export function istInstant(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00+05:30`);
}

/** Today's date in IST as "YYYY-MM-DD", shifted by `days`. */
export function istDate(days = 0, now = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MIN * 60_000 + days * 86_400_000).toISOString().slice(0, 10);
}
