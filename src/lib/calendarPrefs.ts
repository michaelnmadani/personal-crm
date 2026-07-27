/**
 * Combine Saturday and Sunday into one column on the calendar. Weekends
 * usually carry the least going on, so folding them together buys the five
 * working days noticeably more width.
 */
export function weekendCombined(): boolean {
  return localStorage.getItem('combineWeekend') === '1'
}

export function setWeekendCombined(on: boolean) {
  localStorage.setItem('combineWeekend', on ? '1' : '0')
}
