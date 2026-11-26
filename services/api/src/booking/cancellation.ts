/**
 * Default cancellation policy, used until each operator sets its own in the console.
 * Returns the share of the fare refunded, or null when cancellation is closed.
 */
export function refundShare(hoursBeforeDeparture: number): number | null {
  if (hoursBeforeDeparture >= 24) return 0.9;
  if (hoursBeforeDeparture >= 6) return 0.5;
  return null;
}
