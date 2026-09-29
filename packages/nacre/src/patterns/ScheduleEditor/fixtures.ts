import {
  WEEKDAY_NAMES,
  WEEKDAYS,
  type SchedulePreviewValue,
  type ScheduleValue,
} from '../Routines/types';

const fmtTime = (time: string) => {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
};

/**
 * A stand-in for the server's schedule preview, good enough for stories and
 * tests. The real app gets exact text and run times from the gateway.
 */
export function fakePreview(value: ScheduleValue, now = Date.now()): SchedulePreviewValue {
  const hour = 3_600_000;
  switch (value.type) {
    case 'once':
      return {
        valid: true,
        text: `Once, ${new Date(value.at).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}`,
        next: [Date.parse(value.at)],
        perDay: 0,
      };
    case 'daily':
      return {
        valid: true,
        text: `Every day at ${fmtTime(value.time)}`,
        next: [1, 2, 3].map((d) => now + d * 24 * hour),
        perDay: 1,
      };
    case 'weekly': {
      const sorted = WEEKDAYS.filter((d) => value.days.includes(d));
      const days =
        sorted.join() === 'mon,tue,wed,thu,fri'
          ? 'Every weekday'
          : sorted.length === 7
            ? 'Every day'
            : `Every ${sorted
                .map((d) => WEEKDAY_NAMES[d])
                .join(', ')
                .replace(/, ([^,]*)$/, ' and $1')}`;
      return {
        valid: true,
        text: `${days} at ${fmtTime(value.time)}`,
        next: [1, 2, 3].map((d) => now + d * 24 * hour),
        perDay: sorted.length / 7,
      };
    }
    case 'monthly':
      return {
        valid: true,
        text: `Every month on the ${value.day === 'last' ? 'last day' : `${value.day}${value.day === 1 ? 'st' : value.day === 2 ? 'nd' : value.day === 3 ? 'rd' : 'th'}`} at ${fmtTime(value.time)}`,
        next: [1, 2, 3].map((m) => now + m * 30 * 24 * hour),
        perDay: 1 / 30,
      };
    case 'interval': {
      const ms = value.every * (value.unit === 'hours' ? hour : 60_000);
      return {
        valid: true,
        text:
          value.every === 1
            ? `Every ${value.unit.slice(0, -1)}`
            : `Every ${value.every} ${value.unit}`,
        next: [1, 2, 3].map((n) => now + n * ms),
        perDay: (24 * hour) / ms,
      };
    }
    case 'cron':
      return /^(\S+\s+){4}\S+$/.test(value.expression.trim())
        ? {
            valid: true,
            text: `Custom: ${value.expression.trim()}`,
            next: [1, 2, 3].map((d) => now + d * 24 * hour),
            perDay: 1,
          }
        : {
            valid: false,
            text: '',
            next: [],
            error: 'A custom schedule needs five parts: minute, hour, day, month and weekday.',
          };
  }
}
