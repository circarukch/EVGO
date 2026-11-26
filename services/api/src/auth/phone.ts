/** Normalise an Indian mobile number to +91XXXXXXXXXX, or return null if it is not one. */
export function normalizeIndianMobile(input: string): string | null {
  let d = (input ?? "").replace(/[\s\-()]/g, "");
  if (d.startsWith("+91")) d = d.slice(3);
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}
