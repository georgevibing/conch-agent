/** Sizes and times, the way the page says them. */

/** "2.5 GB", "820 MB" — decimal, like the download sizes people see everywhere else. */
export function bytes(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(value >= 1e10 ? 0 : 1)} GB`;
  if (value >= 1e6) return `${Math.round(value / 1e6)} MB`;
  return `${Math.max(0, Math.round(value / 1e3))} KB`;
}

/** "about 3 minutes", "about a minute". */
export function minutes(value: number): string {
  if (value <= 1) return 'about a minute';
  if (value < 90) return `about ${Math.round(value)} minutes`;
  const hours = Math.round(value / 60);
  return hours === 1 ? 'about an hour' : `about ${hours} hours`;
}

/** Time left in a download: "about 2 minutes left", "less than a minute left". */
export function timeLeft(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  if (seconds < 45) return 'less than a minute left';
  if (seconds < 90) return 'about a minute left';
  return `${minutes(seconds / 60)} left`;
}
