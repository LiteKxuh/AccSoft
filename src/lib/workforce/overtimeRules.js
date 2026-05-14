/* HotelOps · Workforce — overtime rules engine
 * =================================================================
 * Computes the OT / double-time / premium-pay split on a list of
 * shift hours given a jurisdictional rule set.
 *
 * Supported rule profiles:
 *   - "FLSA"            — federal default: 1.5× over 40h/week
 *   - "CA"              — California: 1.5× over 8h/day, 2× over 12h/day,
 *                          1.5× over 40h/week, 2× on the 7th consecutive day
 *   - "NV"              — Nevada: 1.5× over 8h/day for sub-$13.50 wage,
 *                          1.5× over 40h/week
 *   - "CO"              — Colorado: 1.5× over 12h/day or 40h/week
 *   - custom rule sets via opts.rule
 *
 * Inputs:
 *   - shifts: [{ date, hours }]  (after break deductions)
 *   - weekStartDay: 0 (Sun) - 6 (Sat); default 1 (Mon)
 *
 * Output:
 *   {
 *     regular, ot, doubleTime, holiday,
 *     byDay: [{ date, regular, ot, doubleTime }],
 *     totalHours
 *   }
 *
 * All math in fractional hours, no floats > 2 decimals carried forward.
 * Holidays passed via opts.holidays trigger holiday rate where applicable.
 */

const RULE_PROFILES = {
  FLSA:  { weekly: 40, daily: null, dailyDouble: null, seventhDay: false, weekStartDay: 1 },
  CA:    { weekly: 40, daily: 8,    dailyDouble: 12,   seventhDay: true,  weekStartDay: 0 },
  NV:    { weekly: 40, daily: 8,    dailyDouble: null, seventhDay: false, weekStartDay: 1, dailyOnlyIfLowWage: 13.50 },
  CO:    { weekly: 40, daily: 12,   dailyDouble: null, seventhDay: false, weekStartDay: 1 },
};

export function getRuleProfile(name) {
  return RULE_PROFILES[name] || RULE_PROFILES.FLSA;
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function weekStart(date, weekStartDay) {
  const d = new Date(date);
  const dow = d.getUTCDay();
  const diff = (dow - weekStartDay + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {object} input
 * @param {Array}  input.shifts        [{ date, hours }] — hours after break deduction
 * @param {string} input.rule          "FLSA" | "CA" | "NV" | "CO"
 * @param {Array}  [input.holidays]    ["YYYY-MM-DD", ...] — eligible for holiday rate
 * @param {number} [input.wage]        employee hourly wage (NV rule uses this)
 */
export function computeOvertime({ shifts = [], rule = "FLSA", holidays = [], wage = null } = {}) {
  const profile = getRuleProfile(rule);
  const holidaySet = new Set(holidays || []);
  // Sort by date asc; group by week + by day
  const byDay = new Map();
  for (const s of shifts) {
    if (!s.date || !(Number(s.hours) > 0)) continue;
    byDay.set(s.date, (byDay.get(s.date) || 0) + Number(s.hours));
  }
  const dailyEntries = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  // Decide if daily OT applies
  const dailyOtApplies = profile.daily && (
    !profile.dailyOnlyIfLowWage || (wage != null && wage < profile.dailyOnlyIfLowWage)
  );

  let regular = 0, ot = 0, doubleTime = 0, holiday = 0;
  const byDayOut = [];
  const weekHours = new Map();
  const weekDayCount = new Map();

  for (const [date, hours] of dailyEntries) {
    const wkStart = weekStart(date, profile.weekStartDay);
    weekDayCount.set(wkStart, (weekDayCount.get(wkStart) || 0) + 1);
    const dayCount = weekDayCount.get(wkStart);

    let dayRegular = hours, dayOt = 0, dayDouble = 0, dayHoliday = 0;
    const isHoliday = holidaySet.has(date);

    // California 7th-consecutive-day rule: 1.5x for first 8h, 2x after
    if (profile.seventhDay && dayCount === 7) {
      const cap = 8;
      dayDouble = Math.max(0, hours - cap);
      dayOt = hours - dayDouble;
      dayRegular = 0;
    } else if (dailyOtApplies) {
      // Daily double-time threshold
      if (profile.dailyDouble && hours > profile.dailyDouble) {
        dayDouble = hours - profile.dailyDouble;
        dayOt = profile.dailyDouble - profile.daily;
        dayRegular = profile.daily;
      } else if (hours > profile.daily) {
        dayOt = hours - profile.daily;
        dayRegular = profile.daily;
      }
    }

    // Weekly OT — push regular over weekly threshold into OT
    const wkPrev = weekHours.get(wkStart) || 0;
    const newWkTotal = wkPrev + dayRegular;
    if (newWkTotal > profile.weekly) {
      const overflow = newWkTotal - profile.weekly;
      const movedToOt = Math.min(overflow, dayRegular);
      dayRegular -= movedToOt;
      dayOt += movedToOt;
    }
    weekHours.set(wkStart, wkPrev + dayRegular);

    // Holiday: anything on a holiday is paid at premium. We log holiday hours
    // separately so payroll can apply the multiplier; the regular split stands.
    if (isHoliday) dayHoliday = hours;

    regular   += dayRegular;
    ot        += dayOt;
    doubleTime+= dayDouble;
    holiday   += dayHoliday;
    byDayOut.push({
      date,
      regular: round2(dayRegular),
      ot: round2(dayOt),
      doubleTime: round2(dayDouble),
      holiday: round2(dayHoliday),
    });
  }

  const total = regular + ot + doubleTime;
  return {
    rule,
    regular: round2(regular),
    ot: round2(ot),
    doubleTime: round2(doubleTime),
    holiday: round2(holiday),
    totalHours: round2(total),
    byDay: byDayOut,
  };
}

/** Estimate gross pay using a rate and the OT split. Holiday hours pay 1.5×. */
export function estimateGross({ split, hourlyRate, holidayMultiplier = 1.5 }) {
  if (!split || !(hourlyRate > 0)) return 0;
  const reg = split.regular * hourlyRate;
  const ot = split.ot * hourlyRate * 1.5;
  const dbl = split.doubleTime * hourlyRate * 2;
  const hol = split.holiday * hourlyRate * (holidayMultiplier - 1); // premium above straight rate
  return round2(reg + ot + dbl + hol);
}
