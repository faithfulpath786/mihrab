/*
  MIHRAB — exact farz slot clock + local-first notebook
  Pure HTML/CSS/vanilla JS. No build step.

  CLOUD SETUP FOR THE DEPLOYMENT OWNER
  1. Create a Supabase project and run schema.sql in its SQL Editor.
  2. Put the Project URL and public anon key below (or enter them in the in-app
     cloud setup panel for a browser-only configuration).
  3. In Supabase Auth > URL Configuration, add the deployed site URL to the
     Site URL and Redirect URLs.
  4. Enable Google in Auth > Providers if Google sign-in is wanted.
  5. Add SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_DB_URL as GitHub secrets.
  6. Keep the repository private because its weekly SQL backups are sensitive.
  7. Deploy these static files with GitHub Pages, Netlify, or any static host.

  The anon key is intentionally public. Row Level Security in schema.sql is the
  security boundary. Never put a Supabase service-role key in browser code.
*/

'use strict';

const DEPLOYMENT_CONFIG = Object.freeze({
  supabaseUrl: 'https://xodufmwunmzvonleqgqc.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvZHVmbXd1bm16dm9ubGVxZ3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5Njg4MTMsImV4cCI6MjEwMjU0NDgxM30.ip0MGaK7KF4p9RJN6VbVHrNgqc_LVkmSJkCpiZ3UhNM'
});

const EPOCH_MS = Date.UTC(621, 1, 27); // 27 February 621 CE
const DAY = 86_400_000;
const INDIA_TZ = 'Asia/Kolkata';
const INDIA_OFFSET_HOURS = 5.5;
const STORAGE_KEY = 'mihrab.v1';
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const PRAYER_LABELS = Object.freeze({ fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' });
const STATUS_LABELS = Object.freeze({ prayed: 'Prayed', missed: 'Missed', qada: 'Qada' });
const INDIAN_NUMBER = new Intl.NumberFormat('en-IN');
const DATE_LONG = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const DATE_SHORT = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const WEEKDAY_SHORT = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short' });
const MONTH_LONG = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const INDIA_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: INDIA_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

const CITIES = Object.freeze([
  { name: 'Hyderabad', lat: 17.3850, lng: 78.4867 },
  { name: 'Ahmedabad', lat: 23.0225, lng: 72.5714 },
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  { name: 'Bhopal', lat: 23.2599, lng: 77.4126 },
  { name: 'Chandigarh', lat: 30.7333, lng: 76.7794 },
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Delhi', lat: 28.6139, lng: 77.2090 },
  { name: 'Jaipur', lat: 26.9124, lng: 75.7873 },
  { name: 'Kochi', lat: 9.9312, lng: 76.2673 },
  { name: 'Kolkata', lat: 22.5726, lng: 88.3639 },
  { name: 'Lucknow', lat: 26.8467, lng: 80.9462 },
  { name: 'Mumbai', lat: 19.0760, lng: 72.8777 },
  { name: 'Nagpur', lat: 21.1458, lng: 79.0882 },
  { name: 'Patna', lat: 25.5941, lng: 85.1376 },
  { name: 'Pune', lat: 18.5204, lng: 73.8567 },
  { name: 'Srinagar', lat: 34.0837, lng: 74.7973 }
]);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const pad = value => String(value).padStart(2, '0');
const escapeCSV = value => `"${String(value ?? '').replaceAll('"', '""')}"`;

function defaultSettings() {
  return {
    lat: 17.3850,
    lng: 78.4867,
    city: 'Hyderabad',
    fajrAngle: 18,
    ishaAngle: 18,
    asrFactor: 1,
    manualTimes: { enabled: false, fajr: '05:10', dhuhr: '12:25', asr: '15:45', maghrib: '18:45', isha: '20:00' },
    notifications: false,
    updated_at: new Date(0).toISOString()
  };
}

function freshBucket() {
  return {
    profile: {
      dob: '', dobEstimated: false, birthYear: '', mode: '13solar', customPuberty: '',
      haydExclude: false, cycleDays: 29.5, periodDays: 7, pastPrayedPct: 0,
      updated_at: new Date(0).toISOString()
    },
    settings: defaultSettings(),
    meta: { started_at: null },
    logs: {},
    queue: [],
    lastExport: null,
    notified: {}
  };
}

function loadRoot() {
  let parsed;
  try { parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { parsed = null; }
  if (!parsed || parsed.version !== 1 || !parsed.buckets) {
    return { version: 1, active: 'local', buckets: { local: freshBucket() }, migrations: {}, cloudConfig: {} };
  }
  parsed.active = 'local';
  parsed.migrations ||= {};
  parsed.cloudConfig ||= {};
  parsed.buckets.local ||= freshBucket();
  for (const bucket of Object.values(parsed.buckets)) normalizeBucket(bucket);
  return parsed;
}

function normalizeBucket(bucket) {
  const clean = freshBucket();
  bucket.profile = { ...clean.profile, ...(bucket.profile || {}) };
  bucket.settings = {
    ...clean.settings,
    ...(bucket.settings || {}),
    manualTimes: { ...clean.settings.manualTimes, ...(bucket.settings?.manualTimes || {}) }
  };
  bucket.meta = { ...clean.meta, ...(bucket.meta || {}) };
  bucket.logs ||= {};
  bucket.queue ||= [];
  bucket.notified ||= {};
  return bucket;
}

let root = loadRoot();
let activeBucketId = 'local';
function bucket() {
  root.buckets[activeBucketId] ||= freshBucket();
  return normalizeBucket(root.buckets[activeBucketId]);
}
function saveRoot() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(root)); }
  catch (error) { showToast('This browser could not save locally. Export a CSV now.', null, 9000); console.error(error); }
}

/* ---------- Exact calendar engine ---------- */

function daysSinceEpoch(y, m, d) {
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_MS) / DAY);
}

function ummahSlotsAtStartOfDay(y, m, d) {
  return 4 + (daysSinceEpoch(y, m, d) - 1) * 5;
}

function liveUmmahCount(now, openedToday) {
  const p = indiaNowParts(now);
  return ummahSlotsAtStartOfDay(p.year, p.month, p.day) + openedToday;
}

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function countLeapDays(until = new Date()) {
  let n = 0;
  const p = indiaNowParts(until);
  const untilDay = Date.UTC(p.year, p.month - 1, p.day);
  for (let y = 624; y <= p.year; y++) {
    const leapDay = Date.UTC(y, 1, 29);
    if (isLeap(y) && leapDay > EPOCH_MS && leapDay <= untilDay) n++;
  }
  return n;
}

function parseISODate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day, ms };
}

function taklifSlots(dobY, dobM, dobD, mode = '13solar', customDate = '', now = new Date()) {
  let pubertyMs;
  if (mode === 'custom') {
    const parsed = parseISODate(customDate);
    if (!parsed) return null;
    pubertyMs = parsed.ms;
  } else if (mode === '15lunar') {
    pubertyMs = Date.UTC(dobY, dobM - 1, dobD) + 5316 * DAY;
  } else {
    pubertyMs = Date.UTC(dobY + 13, dobM - 1, dobD);
  }
  const p = indiaNowParts(now);
  const todayMs = Date.UTC(p.year, p.month - 1, p.day);
  const days = Math.round((todayMs - pubertyMs) / DAY);
  return { days, slots: Math.max(0, days) * 5, pubertyDate: new Date(pubertyMs), pubertyMs };
}

const hijriYearsDisplay = days => days / (354 + 11 / 30);

function runGoldenTests() {
  const reference = new Date('2026-08-17T12:00:00Z');
  const tests = [
    ['days since epoch', daysSinceEpoch(2026, 8, 17) === 513337],
    ['slots at start of day', ummahSlotsAtStartOfDay(2026, 8, 17) === 2566684],
    ['taklif example', taklifSlots(1995, 8, 17, '13solar', '', reference)?.slots === 32870],
    ['leap days', countLeapDays(reference) === 341]
  ];
  let passed = true;
  for (const [name, ok] of tests) {
    console.assert(ok, `MIHRAB GOLDEN TEST FAILED: ${name}`);
    console.info(`MIHRAB golden test — ${name}: ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) passed = false;
  }
  $('#engineError').hidden = passed;
  return passed;
}

/* ---------- Date and solar-time helpers ---------- */

function indiaNowParts(date = new Date()) {
  const values = {};
  for (const part of INDIA_PARTS.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return values;
}

function dateKeyFromParts({ year, month, day }) { return `${year}-${pad(month)}-${pad(day)}`; }
function todayKey(now = new Date()) { return dateKeyFromParts(indiaNowParts(now)); }
function utcDateFromKey(key) { const p = parseISODate(key); return p ? new Date(p.ms) : null; }
function addDaysToKey(key, amount) { const d = utcDateFromKey(key); d.setUTCDate(d.getUTCDate() + amount); return dateKeyFromParts({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }); }
function dateKeyCompare(a, b) { return a === b ? 0 : a < b ? -1 : 1; }
function longDate(key) { const d = utcDateFromKey(key); return d ? DATE_LONG.format(d) : ''; }
function shortDate(key) { const d = utcDateFromKey(key); return d ? DATE_SHORT.format(d) : ''; }
function isFriday(key) { return utcDateFromKey(key)?.getUTCDay() === 5; }

function dayOfYear(year, month, day) {
  return Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / DAY);
}

function toRadians(degrees) { return degrees * Math.PI / 180; }
function toDegrees(radians) { return radians * 180 / Math.PI; }
function hourAngleForAltitude(latitude, declination, altitude) {
  const lat = toRadians(latitude);
  const dec = declination;
  const alt = toRadians(altitude);
  const cosine = (Math.sin(alt) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec));
  if (cosine < -1 || cosine > 1) return null;
  return toDegrees(Math.acos(cosine));
}

const solarCache = new Map();
function prayerTimesForDate(key, settings = bucket().settings) {
  const signature = `${key}|${settings.lat}|${settings.lng}|${settings.fajrAngle}|${settings.ishaAngle}|${settings.asrFactor}|${JSON.stringify(settings.manualTimes)}`;
  if (solarCache.has(signature)) return solarCache.get(signature);
  const parsed = parseISODate(key);
  if (!parsed) return null;
  const n = dayOfYear(parsed.year, parsed.month, parsed.day);
  const daysInYear = isLeap(parsed.year) ? 366 : 365;
  const gamma = 2 * Math.PI / daysInYear * (n - 1);
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const noon = 720 - 4 * Number(settings.lng) - equationOfTime + INDIA_OFFSET_HOURS * 60;
  const sunHA = hourAngleForAltitude(Number(settings.lat), declination, -0.833);
  const fajrHA = hourAngleForAltitude(Number(settings.lat), declination, -Number(settings.fajrAngle));
  const ishaHA = hourAngleForAltitude(Number(settings.lat), declination, -Number(settings.ishaAngle));
  const latitudeRadians = toRadians(Number(settings.lat));
  const asrAltitude = toDegrees(Math.atan(1 / (Number(settings.asrFactor) + Math.tan(Math.abs(latitudeRadians - declination)))));
  const asrHA = hourAngleForAltitude(Number(settings.lat), declination, asrAltitude);
  let values = {
    fajr: noon - 4 * (fajrHA ?? sunHA ?? 90),
    dhuhr: noon + 2,
    asr: noon + 4 * (asrHA ?? 45),
    maghrib: noon + 4 * (sunHA ?? 90),
    isha: noon + 4 * (ishaHA ?? sunHA ?? 90)
  };
  if (key === todayKey() && settings.manualTimes?.enabled) {
    values = Object.fromEntries(PRAYERS.map(prayer => [prayer, timeStringToMinutes(settings.manualTimes[prayer])]));
  }
  let prior = 0;
  for (const prayer of PRAYERS) {
    let value = Number.isFinite(values[prayer]) ? Math.round(values[prayer]) : prior + 60;
    value = clamp(value, prior + (prior ? 1 : 0), 1439);
    values[prayer] = value;
    prior = value;
  }
  solarCache.set(signature, values);
  return values;
}

function timeStringToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  return match ? clamp(Number(match[1]) * 60 + Number(match[2]), 0, 1439) : NaN;
}

function minutesToTime(minutes) {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${pad(minute)} ${hour24 >= 12 ? 'PM' : 'AM'}`;
}

function countdownText(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${hours}:${pad(minutes)}:${pad(secs)}`;
}

function clockSnapshot(now = new Date()) {
  const parts = indiaNowParts(now);
  const key = dateKeyFromParts(parts);
  const times = prayerTimesForDate(key);
  const minuteNow = parts.hour * 60 + parts.minute + parts.second / 60;
  const opened = PRAYERS.filter(prayer => minuteNow >= times[prayer]).length;
  let nextPrayer;
  let secondsToNext;
  let nextDay = false;
  if (opened < PRAYERS.length) {
    nextPrayer = PRAYERS[opened];
    secondsToNext = (times[nextPrayer] - minuteNow) * 60;
  } else {
    nextPrayer = 'fajr';
    nextDay = true;
    const tomorrowTimes = prayerTimesForDate(addDaysToKey(key, 1));
    secondsToNext = (1440 - minuteNow + tomorrowTimes.fajr) * 60;
  }
  return {
    now, parts, key, times, minuteNow, opened, nextPrayer, nextDay, secondsToNext,
    currentPrayer: opened ? PRAYERS[opened - 1] : null,
    count: liveUmmahCount(now, opened)
  };
}

/* ---------- Rendering ---------- */

let lastOdometer = '';
let lastClock = null;
let calendarCursor = (() => { const p = indiaNowParts(); return { year: p.year, month: p.month }; })();
let openDayKey = null;
let undoState = null;
let undoTimer = null;
let isEditingTaklif = false;

function renderOdometer(number, animate = false, isInitialRoll = false) {
  const formatted = INDIAN_NUMBER.format(number);
  const host = $('#ummahOdometer');
  if (!host) return;
  host.setAttribute('aria-label', `${formatted} farz prayer slots`);
  const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (isInitialRoll && !isReducedMotion) {
    let delayCounter = 0;
    host.innerHTML = [...formatted].map(char => {
      if (/\d/.test(char)) {
        const targetNum = Number(char);
        const reel = [];
        for (let i = 0; i <= 9; i++) reel.push((i + targetNum) % 10);
        reel[reel.length - 1] = targetNum;
        const targetY = -((reel.length - 1) * 100);
        const colDelay = (delayCounter * 0.07).toFixed(2);
        delayCounter++;
        return `<span class="digit-window"><span class="digit-strip reel-roll" style="--reel-target-y:${targetY}%;--reel-delay:${colDelay}s;--reel-duration:1.25s;">${reel.map(d => `<span>${d}</span>`).join('')}</span></span>`;
      }
      return `<span class="odo-separator">${char}</span>`;
    }).join('');
    host.classList.remove('pulse');
    void host.offsetWidth;
    setTimeout(() => host.classList.add('pulse'), 1250);
    lastOdometer = formatted;
    return;
  }

  if (!lastOdometer || !animate || formatted.length !== lastOdometer.length || isReducedMotion) {
    host.innerHTML = [...formatted].map(char => /\d/.test(char)
      ? `<span class="digit-window"><span class="digit-strip"><span>${char}</span></span></span>`
      : `<span class="odo-separator">${char}</span>`).join('');
  } else {
    host.innerHTML = [...formatted].map((char, index) => {
      const old = lastOdometer[index];
      if (/\d/.test(char)) {
        return old !== char
          ? `<span class="digit-window"><span class="digit-strip rolling"><span>${old}</span><span>${char}</span></span></span>`
          : `<span class="digit-window"><span class="digit-strip"><span>${char}</span></span></span>`;
      }
      return `<span class="odo-separator">${char}</span>`;
    }).join('');
    host.classList.remove('pulse');
    void host.offsetWidth;
    host.classList.add('pulse');
  }
  lastOdometer = formatted;
}

function prayerDisplayName(prayer, key) {
  return prayer === 'dhuhr' && isFriday(key) ? 'Jumu’ah' : PRAYER_LABELS[prayer];
}

function updateClock(now = new Date()) {
  const snapshot = clockSnapshot(now);
  const openingChanged = lastClock && snapshot.key === lastClock.key && snapshot.opened > lastClock.opened;
  const countChanged = lastClock && snapshot.count !== lastClock.count;
  renderOdometer(snapshot.count, Boolean(countChanged));

  const days = daysSinceEpoch(snapshot.parts.year, snapshot.parts.month, snapshot.parts.day);
  const solarYears = days / 365.2425;
  const hijriYears = hijriYearsDisplay(days);
  const leapDays = countLeapDays(now);
  $('#elapsedLine').textContent = `${solarYears.toFixed(2)} solar years · ${hijriYears.toFixed(2)} Hijri years · ${INDIAN_NUMBER.format(days)} days · ${leapDays} leap days included`;
  $('#leapMethodCopy').textContent = `The engine walks ${INDIAN_NUMBER.format(days)} real UTC calendar days, including ${leapDays} Gregorian leap days. A naive 365-day shortcut would lose ${INDIAN_NUMBER.format(leapDays * 5)} prayers across this span. Hijri years are context only because prayer slots follow the solar day.`;

  const status = $('#prayerStatus');
  const currentName = snapshot.currentPrayer ? prayerDisplayName(snapshot.currentPrayer, snapshot.key) : 'Before Fajr';
  const nextName = prayerDisplayName(snapshot.nextPrayer, snapshot.nextDay ? addDaysToKey(snapshot.key, 1) : snapshot.key);
  $('strong', status).textContent = snapshot.currentPrayer ? `● ${currentName} is open now` : 'Night before Fajr';
  $('span', status).textContent = `${snapshot.nextDay ? 'Tomorrow, ' : ''}${nextName} opens in ${countdownText(snapshot.secondsToNext)}`;

  const city = bucket().settings.city || 'Custom location';
  $('#locationLine').textContent = `${city}, India · ${Number(bucket().settings.lat).toFixed(4)}°, ${Number(bucket().settings.lng).toFixed(4)}° · Asia/Kolkata`;

  if (!lastClock || snapshot.key !== lastClock.key || snapshot.opened !== lastClock.opened) {
    renderToday(snapshot);
    renderNotebook();
  }
  if (openingChanged) notifyOpenings(lastClock.opened, snapshot.opened, snapshot);
  lastClock = snapshot;
  return snapshot;
}

function getLog(key, prayer) { return bucket().logs[`${key}|${prayer}`] || null; }

function startedDateKey() {
  return bucket().meta.started_at ? todayKey(new Date(bucket().meta.started_at)) : null;
}

function startPrayerIndex() {
  if (!bucket().meta.started_at) return 0;
  const date = new Date(bucket().meta.started_at);
  const parts = indiaNowParts(date);
  const key = dateKeyFromParts(parts);
  const times = prayerTimesForDate(key);
  const minute = parts.hour * 60 + parts.minute + parts.second / 60;
  return Math.max(0, PRAYERS.filter(prayer => minute >= times[prayer]).length - 1);
}

function prayerIsLoggable(key, prayer, snapshot = clockSnapshot()) {
  if (key === snapshot.key) {
    const index = PRAYERS.indexOf(prayer);
    return index < snapshot.opened;
  }
  if (dateKeyCompare(key, snapshot.key) > 0) return false;
  return true;
}

function segmentedHTML(key, prayer, compact = false) {
  const log = getLog(key, prayer);
  const enabled = prayerIsLoggable(key, prayer);
  return `<div class="segmented" role="group" aria-label="${prayerDisplayName(prayer, key)} status">
    ${Object.entries(STATUS_LABELS).map(([status, label]) => `<button type="button" data-mark data-date="${key}" data-prayer="${prayer}" data-status="${status}" class="${log?.status === status ? 'active' : ''}" ${enabled ? '' : 'disabled'} title="${enabled ? `Mark ${label}` : 'Available after this prayer opens'}">${label}</button>`).join('')}
  </div>`;
}

function prayerRowHTML(key, prayer, state, times, compact = false) {
  const display = prayerDisplayName(prayer, key);
  return `<div class="prayer-row" data-state="${state}">
    <div class="prayer-identity"><span class="state-dot" aria-hidden="true"></span><div><h3>${display}<span class="state-badge">${state}</span></h3><span class="prayer-time">${minutesToTime(times[prayer])}</span></div></div>
    ${segmentedHTML(key, prayer, compact)}
  </div>`;
}

function renderToday(snapshot = clockSnapshot()) {
  $('#todayDate').textContent = `${WEEKDAY_SHORT.format(utcDateFromKey(snapshot.key))}, ${longDate(snapshot.key)}`;
  $('#todayRows').innerHTML = PRAYERS.map((prayer, index) => {
    const state = index < snapshot.opened - 1 ? 'passed' : index === snapshot.opened - 1 ? 'open' : 'upcoming';
    return prayerRowHTML(snapshot.key, prayer, state, snapshot.times);
  }).join('');
  const started = Boolean(bucket().meta.started_at) || Object.keys(bucket().logs).length > 0;
  $('#startNotebookCard').hidden = started;
  $('#startNotebookButton').innerHTML = snapshot.currentPrayer
    ? `Start noting from ${prayerDisplayName(snapshot.currentPrayer, snapshot.key)} <span aria-hidden="true">→</span>`
    : 'Start noting from Fajr <span aria-hidden="true">→</span>';
  const tomorrow = $('#tomorrowFajr');
  if (snapshot.opened === 5) {
    const tomorrowKey = addDaysToKey(snapshot.key, 1);
    const fajr = prayerTimesForDate(tomorrowKey).fajr;
    tomorrow.hidden = false;
    tomorrow.innerHTML = `<strong>Tomorrow, Fajr ${minutesToTime(fajr)}</strong> · opens in ${countdownText(snapshot.secondsToNext)}`;
  } else {
    tomorrow.hidden = true;
  }
}

function statsFromLogs() {
  const stats = { prayed: 0, missed: 0, qada: 0, total: 0 };
  for (const log of Object.values(bucket().logs)) {
    if (stats[log.status] !== undefined) { stats[log.status]++; stats.total++; }
  }
  stats.completion = stats.total ? ((stats.prayed + stats.qada) / stats.total) * 100 : 0;
  return stats;
}

function aggregateDay(key) {
  const statuses = PRAYERS.map(prayer => getLog(key, prayer)?.status).filter(Boolean);
  if (!statuses.length) return '';
  if (statuses.includes('missed')) return 'missed';
  if (statuses.includes('qada')) return 'qada';
  return 'prayed';
}

function renderNotebook() {
  const started = Boolean(bucket().meta.started_at) || Object.keys(bucket().logs).length > 0;
  $('#notebookEmpty').hidden = started;
  $('#notebookContent').hidden = !started;
  $('#notingSince').textContent = started
    ? `Noting since ${shortDate(startedDateKey() || todayKey())}, ${prayerDisplayName(PRAYERS[startPrayerIndex()], startedDateKey() || todayKey())}`
    : 'Not started';
  $('#localOnlyBanner').hidden = Boolean(session);
  $('#deleteAccountButton').hidden = !session;
  const needsBackup = started && (!bucket().lastExport || Date.now() - new Date(bucket().lastExport).getTime() >= 30 * DAY);
  $('#backupReminder').hidden = !needsBackup;
  if (!started) return;

  const stats = statsFromLogs();
  $('#notebookStats').innerHTML = [
    ['prayed', 'Prayed', stats.prayed],
    ['missed', 'Missed', stats.missed],
    ['qada', 'Qada done', stats.qada],
    ['', 'Completion', `${stats.completion.toFixed(1)}%`]
  ].map(([cls, label, value]) => `<div class="stat ${cls}"><span>${label}</span><strong>${typeof value === 'number' ? INDIAN_NUMBER.format(value) : value}</strong></div>`).join('');

  const today = todayKey();
  const startKey = startedDateKey() || today;
  $('#weekStrip').innerHTML = Array.from({ length: 7 }, (_, index) => addDaysToKey(today, index - 6)).map(key => {
    const d = utcDateFromKey(key);
    const disabled = dateKeyCompare(key, startKey) < 0 && !aggregateDay(key);
    const aggregate = aggregateDay(key);
    return `<button class="day-dot-button" type="button" data-open-day="${key}" ${disabled ? 'disabled' : ''}><small>${WEEKDAY_SHORT.format(d)}</small><span class="day-dot ${aggregate}">${d.getUTCDate()}</span></button>`;
  }).join('');
  renderCalendar();
}

function renderCalendar() {
  const first = new Date(Date.UTC(calendarCursor.year, calendarCursor.month - 1, 1));
  const daysInMonth = new Date(Date.UTC(calendarCursor.year, calendarCursor.month, 0)).getUTCDate();
  $('#calendarTitle').textContent = MONTH_LONG.format(first);
  const blanks = Array.from({ length: first.getUTCDay() }, () => '<span></span>').join('');
  const today = todayKey();
  const start = startedDateKey() || today;
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const key = `${calendarCursor.year}-${pad(calendarCursor.month)}-${pad(i + 1)}`;
    const disabled = dateKeyCompare(key, today) > 0 || (dateKeyCompare(key, start) < 0 && !aggregateDay(key));
    return `<button type="button" class="calendar-day ${aggregateDay(key)} ${key === today ? 'today' : ''}" data-open-day="${key}" ${disabled ? 'disabled' : ''} aria-label="${longDate(key)}">${i + 1}</button>`;
  }).join('');
  $('#monthCalendar').innerHTML = blanks + days;
  const current = indiaNowParts();
  $('#calendarNext').disabled = calendarCursor.year > current.year || (calendarCursor.year === current.year && calendarCursor.month >= current.month);
}

function estimatedHaydDays(accountableDays, cycleDays, periodDays) {
  if (accountableDays <= 0 || cycleDays <= 0) return 0;
  const completeCycles = Math.floor(accountableDays / cycleDays);
  const remainder = accountableDays - completeCycles * cycleDays;
  return Math.max(0, Math.round(completeCycles * periodDays + Math.min(remainder, periodDays)));
}

function calculateProfile(now = new Date()) {
  const profile = bucket().profile;
  const dob = parseISODate(profile.dob);
  if (!dob) return null;
  const result = taklifSlots(dob.year, dob.month, dob.day, profile.mode, profile.customPuberty, now);
  if (!result) return null;
  const haydDays = profile.haydExclude ? estimatedHaydDays(Math.max(0, result.days), Number(profile.cycleDays), Number(profile.periodDays)) : 0;
  return { ...result, haydDays, haydSlots: haydDays * 5 };
}

function stepQada(delta) {
  const today = todayKey();
  if (delta > 0) {
    let logged = false;
    for (const p of PRAYERS) {
      const l = getLog(today, p);
      if (l && l.status === 'missed') {
        markPrayer(today, p, 'qada');
        logged = true;
        break;
      }
    }
    if (!logged) {
      let foundDate = null, foundPrayer = null;
      for (let d = today; dateKeyCompare(d, '2000-01-01') >= 0; d = addDaysToKey(d, -1)) {
        for (const p of PRAYERS) {
          if (!getLog(d, p)) {
            foundDate = d;
            foundPrayer = p;
            break;
          }
        }
        if (foundDate) break;
      }
      if (foundDate && foundPrayer) {
        if (!bucket().meta.started_at) {
          bucket().meta.started_at = new Date().toISOString();
          syncMeta();
        }
        setLocalLog(foundDate, foundPrayer, 'qada');
        renderToday();
        renderNotebook();
        renderTaklif();
        flushQueue();
        showToast(`1 Qada recorded (${prayerDisplayName(foundPrayer, foundDate)}, ${shortDate(foundDate)}). Backlog reduced!`, () => {
          removeLocalLog(foundDate, foundPrayer);
          renderToday(); renderNotebook(); renderTaklif(); flushQueue();
        }, 6000);
      }
    }
  } else if (delta < 0) {
    const qadaLogs = Object.values(bucket().logs).filter(l => l.status === 'qada').sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    if (qadaLogs.length) {
      const target = qadaLogs[0];
      removeLocalLog(target.log_date, target.prayer);
      renderToday();
      renderNotebook();
      renderTaklif();
      flushQueue();
      showToast('1 Qada mark removed.', null, 4000);
    }
  }
}

function renderTaklif() {
  const result = calculateProfile();
  const host = $('#taklifResults');
  const formContainer = $('#taklifFormContainer');
  const editBtn = $('#editTaklifButton');
  const cancelBtn = $('#cancelTaklifEdit');
  const taklifGrid = $('.taklif-grid');

  if (!result) {
    if (formContainer) formContainer.hidden = false;
    if (editBtn) editBtn.hidden = true;
    if (cancelBtn) cancelBtn.hidden = true;
    if (taklifGrid) taklifGrid.classList.remove('full-mode');
    host.innerHTML = '<p class="empty-state">Add your birth date to reveal your personal accountability clock.</p>';
    return;
  }

  if (editBtn) {
    editBtn.hidden = false;
    editBtn.textContent = isEditingTaklif ? 'Close editor' : 'Edit details';
  }
  if (cancelBtn) cancelBtn.hidden = !isEditingTaklif;
  if (formContainer) formContainer.hidden = !isEditingTaklif;
  if (taklifGrid) {
    if (isEditingTaklif) taklifGrid.classList.remove('full-mode');
    else taklifGrid.classList.add('full-mode');
  }

  const stats = statsFromLogs();
  const profile = bucket().profile;
  let modeLabel = 'Age 13 · average estimate';
  if (profile.mode === '15lunar') modeLabel = '15 lunar years · 5,316 days';
  else if (profile.mode === 'custom') modeLabel = 'Exact puberty date';

  let backlogHTML = '';
  if (bucket().meta.started_at || Object.keys(bucket().logs).length > 0) {
    const start = parseISODate(startedDateKey() || todayKey());
    const historicalDays = Math.max(0, Math.round((start.ms - result.pubertyMs) / DAY));
    const historicalHayd = profile.haydExclude ? estimatedHaydDays(historicalDays, Number(profile.cycleDays), Number(profile.periodDays)) * 5 : 0;
    const slotsBeforeNoting = Math.max(0, historicalDays * 5 - historicalHayd);
    const pct = clamp(Number(profile.pastPrayedPct) || 0, 0, 100);
    const estimatedToMakeUp = Math.max(0, Math.round(slotsBeforeNoting * (1 - pct / 100)) - stats.qada);
    backlogHTML = `<div class="backlog-module">
      <h3>Optional qada estimate</h3>
      <p>${INDIAN_NUMBER.format(slotsBeforeNoting)} eligible slots existed before your notebook. Estimate how many you had prayed; this is a private planning aid, not a ruling.</p>
      <label class="field"><span>Estimated past prayed: <b id="pastPctLabel">${pct}%</b></span><input id="pastPrayedRange" type="range" min="0" max="100" step="1" value="${pct}" data-base="${slotsBeforeNoting}" data-qada="${stats.qada}"></label>
      <div class="chipaway-stepper-wrap">
        <div class="stepper-col-left">
          <span>Calm chip-away counter</span>
          <strong id="backlogValue">${INDIAN_NUMBER.format(estimatedToMakeUp)}</strong>
        </div>
        <div class="stepper-controls">
          <button id="qadaDecrementBtn" class="stepper-btn" type="button" title="Remove 1 Qada mark" ${stats.qada <= 0 ? 'disabled' : ''} aria-label="Remove 1 Qada mark">−</button>
          <button id="qadaIncrementBtn" class="stepper-btn" type="button" title="Log 1 Qada prayed (+1 Qada mark, decreases backlog)" ${estimatedToMakeUp <= 0 ? 'disabled' : ''} aria-label="Log 1 Qada prayed">+</button>
        </div>
      </div>
      <p class="hope-copy">Slots that existed are history. The next one is yours.</p>
    </div>`;
  }
  const eligibleSlots = Math.max(0, result.slots - result.haydSlots);
  host.innerHTML = `<div class="taklif-active-header">
      <span class="taklif-active-badge">Accountability Clock Active</span>
      <small style="color: var(--muted); font-size: 0.7rem;">${modeLabel}</small>
    </div>
    <p class="taklif-result-label">Accountable since</p>
    <p class="taklif-date">${DATE_LONG.format(result.pubertyDate)}${profile.dobEstimated ? ' · estimated' : ''}</p>
    <p class="taklif-result-label">Farz slots that existed for you</p>
    <div class="result-number">${INDIAN_NUMBER.format(eligibleSlots)}</div>
    <p class="result-caption">${INDIAN_NUMBER.format(Math.max(0, result.days))} exact solar days × 5${profile.haydExclude ? ', after the separate hayd exclusion shown below' : ''}.</p>
    <div class="mini-results">
      <div><span>Notebook prayed</span><strong>${INDIAN_NUMBER.format(stats.prayed)}</strong></div>
      <div><span>Notebook completion</span><strong>${stats.completion.toFixed(1)}%</strong></div>
    </div>
    ${profile.haydExclude ? `<p class="hayd-result">Estimated hayd exclusion: <strong>${INDIAN_NUMBER.format(result.haydDays)} days · ${INDIAN_NUMBER.format(result.haydSlots)} slots</strong>. These are excluded, never labelled missed, and never qada.</p>` : ''}
    ${backlogHTML}`;

  const range = $('#pastPrayedRange');
  if (range) {
    range.addEventListener('input', () => {
      const pct = Number(range.value);
      $('#pastPctLabel').textContent = `${pct}%`;
      const remaining = Math.max(0, Math.round(Number(range.dataset.base) * (1 - pct / 100)) - Number(range.dataset.qada));
      $('#backlogValue').textContent = INDIAN_NUMBER.format(remaining);
      const inc = $('#qadaIncrementBtn');
      if (inc) inc.disabled = remaining <= 0;
    });
    range.addEventListener('change', () => {
      profile.pastPrayedPct = Number(range.value);
      profile.updated_at = new Date().toISOString();
      saveRoot();
      syncProfile();
    });
  }
  const incBtn = $('#qadaIncrementBtn');
  if (incBtn) incBtn.onclick = () => stepQada(1);
  const decBtn = $('#qadaDecrementBtn');
  if (decBtn) decBtn.onclick = () => stepQada(-1);
}

function populateProfileForm() {
  const p = bucket().profile;
  $('#dobInput').value = p.dobEstimated ? '' : p.dob;
  $('#birthYearInput').value = p.dobEstimated ? p.birthYear || parseISODate(p.dob)?.year || '' : '';
  $(`input[name="taklifMode"][value="${p.mode}"]`)?.click();
  $('#customPubertyInput').value = p.customPuberty || '';
  $('#haydToggle').checked = Boolean(p.haydExclude);
  $('#cycleDays').value = p.cycleDays;
  $('#periodDays').value = p.periodDays;
  $('#haydFields').hidden = !p.haydExclude;
  $('#dobEstimateNote').hidden = !p.dobEstimated;
}

function renderAll() {
  populateProfileForm();
  renderTaklif();
  renderNotebook();
  updateAuthUI();
  updateClock();
}

/* ---------- Notebook mutations, undo, CSV ---------- */

function queueChange(change) {
  const b = bucket();
  b.queue = b.queue.filter(item => !(item.log_date === change.log_date && item.prayer === change.prayer));
  b.queue.push(change);
  saveRoot();
}

function setLocalLog(date, prayer, status, updatedAt = new Date().toISOString(), shouldQueue = true) {
  const key = `${date}|${prayer}`;
  bucket().logs[key] = { log_date: date, prayer, status, updated_at: updatedAt };
  if (shouldQueue) queueChange({ log_date: date, prayer, status, updated_at: updatedAt, operation: 'upsert' });
  else saveRoot();
}

function removeLocalLog(date, prayer, updatedAt = new Date().toISOString(), shouldQueue = true) {
  delete bucket().logs[`${date}|${prayer}`];
  if (shouldQueue) queueChange({ log_date: date, prayer, updated_at: updatedAt, operation: 'delete' });
  else saveRoot();
}

function markPrayer(date, prayer, status, { allowUndo = true } = {}) {
  if (!PRAYERS.includes(prayer) || !STATUS_LABELS[status] || !prayerIsLoggable(date, prayer)) return;
  if (!bucket().meta.started_at) {
    bucket().meta.started_at = new Date().toISOString();
    syncMeta();
  }
  const previous = getLog(date, prayer) ? { ...getLog(date, prayer) } : null;
  setLocalLog(date, prayer, status);
  renderToday();
  renderNotebook();
  renderTaklif();
  if (openDayKey) renderDayDialog(openDayKey);
  if (allowUndo) {
    undoState = { date, prayer, previous };
    showToast(`${prayerDisplayName(prayer, date)} marked ${STATUS_LABELS[status].toLowerCase()}.`, undoLastMark, 10_000);
  }
  flushQueue();
}

function undoLastMark() {
  if (!undoState) return;
  const { date, prayer, previous } = undoState;
  undoState = null;
  if (previous) setLocalLog(date, prayer, previous.status);
  else removeLocalLog(date, prayer);
  renderToday(); renderNotebook(); renderTaklif();
  if (openDayKey) renderDayDialog(openDayKey);
  flushQueue();
  hideToast();
}

function showToast(message, undo = null, duration = 5000) {
  clearTimeout(undoTimer);
  $('#toastMessage').textContent = message;
  $('#undoButton').hidden = !undo;
  $('#toast').hidden = false;
  if (undo) $('#undoButton').onclick = undo;
  undoTimer = setTimeout(hideToast, duration);
}
function hideToast() { $('#toast').hidden = true; clearTimeout(undoTimer); }

function startNotebook() {
  if (bucket().meta.started_at) return;
  bucket().meta.started_at = new Date().toISOString();
  saveRoot();
  renderAll();
  syncMeta();
  showToast('Your notebook has started. One prayer at a time.', null, 6000);
  location.hash = '#today';
}

function dateRange(fromKey, toKey) {
  const out = [];
  for (let key = fromKey; dateKeyCompare(key, toKey) <= 0; key = addDaysToKey(key, 1)) out.push(key);
  return out;
}

function exportCSV() {
  const start = startedDateKey();
  const dates = start ? dateRange(start, todayKey()) : [...new Set(Object.values(bucket().logs).map(log => log.log_date))].sort();
  const lines = ['date,fajr,dhuhr,asr,maghrib,isha'];
  for (const date of dates) {
    lines.push([date, ...PRAYERS.map(prayer => getLog(date, prayer)?.status || '')].map(escapeCSV).join(','));
  }
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `mihrab-backup-${todayKey()}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  bucket().lastExport = new Date().toISOString();
  saveRoot();
  renderNotebook();
  showToast(`Backup downloaded · ${INDIAN_NUMBER.format(Object.keys(bucket().logs).length)} marks.`, null, 5000);
}

async function resetNotebook() {
  if (!confirm('Reset the entire notebook? Export a CSV first if you need a copy.')) return;
  if (!confirm('This removes every notebook mark on this account. This is the final confirmation.')) return;
  const b = bucket();
  b.logs = {};
  b.queue = [];
  b.meta.started_at = null;
  saveRoot();
  if (session && sb) {
    setSyncPill('syncing');
    const [{ error: logsError }, { error: metaError }] = await Promise.all([
      sb.from('prayer_logs').delete().eq('user_id', session.user.id),
      sb.from('notebook_meta').delete().eq('user_id', session.user.id)
    ]);
    if (logsError || metaError) showToast('Cloud reset is waiting. Please try again while online.', null, 7000);
  }
  renderAll();
}

function openDayDialogFor(key) {
  openDayKey = key;
  renderDayDialog(key);
  $('#dayDialog').showModal();
}

function renderDayDialog(key) {
  if (!openDayKey) return;
  $('#dayDialogTitle').textContent = longDate(key);
  const times = prayerTimesForDate(key);
  const now = clockSnapshot();
  $('#dayDialogRows').innerHTML = PRAYERS.map((prayer, index) => {
    const state = key === now.key ? (index < now.opened - 1 ? 'passed' : index === now.opened - 1 ? 'open' : 'upcoming') : 'passed';
    return prayerRowHTML(key, prayer, state, times, true);
  }).join('');
}

/* ---------- Settings and notifications ---------- */

function closestCity(lat, lng) {
  return CITIES.find(city => Math.abs(city.lat - Number(lat)) < 0.001 && Math.abs(city.lng - Number(lng)) < 0.001)?.name || 'Custom location';
}

function populateSettingsForm() {
  const settings = bucket().settings;
  $('#citySelect').innerHTML = [...CITIES.map(city => `<option value="${city.name}">${city.name}</option>`), '<option value="Custom location">Custom coordinates</option>'].join('');
  $('#citySelect').value = CITIES.some(city => city.name === settings.city) ? settings.city : 'Custom location';
  $('#latInput').value = settings.lat;
  $('#lngInput').value = settings.lng;
  $('#fajrAngle').value = String(settings.fajrAngle);
  $('#ishaAngle').value = String(settings.ishaAngle);
  $('#asrFactor').value = String(settings.asrFactor);
  $('#manualTimesToggle').checked = Boolean(settings.manualTimes.enabled);
  $('#manualTimeFields').hidden = !settings.manualTimes.enabled;
  $$('[data-manual]').forEach(input => { input.value = settings.manualTimes[input.dataset.manual] || ''; });
  $('#notificationToggle').checked = Boolean(settings.notifications && 'Notification' in window && Notification.permission === 'granted');
}

async function saveSettings(event) {
  event.preventDefault();
  if (event.submitter?.value === 'cancel') { $('#settingsDialog').close(); return; }
  const lat = Number($('#latInput').value);
  const lng = Number($('#lngInput').value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    showToast('Enter valid latitude and longitude.', null, 5000); return;
  }
  let notifications = $('#notificationToggle').checked;
  if (notifications) {
    if (!('Notification' in window)) notifications = false;
    else if (Notification.permission !== 'granted') notifications = (await Notification.requestPermission()) === 'granted';
  }
  const manual = { enabled: $('#manualTimesToggle').checked };
  for (const input of $$('[data-manual]')) manual[input.dataset.manual] = input.value;
  if (manual.enabled && PRAYERS.some(prayer => !Number.isFinite(timeStringToMinutes(manual[prayer])))) {
    showToast('Enter all five manual prayer times.', null, 5000); return;
  }
  bucket().settings = {
    ...bucket().settings,
    lat, lng,
    city: closestCity(lat, lng),
    fajrAngle: Number($('#fajrAngle').value),
    ishaAngle: Number($('#ishaAngle').value),
    asrFactor: Number($('#asrFactor').value),
    manualTimes: manual,
    notifications,
    updated_at: new Date().toISOString()
  };
  solarCache.clear();
  saveRoot();
  $('#settingsDialog').close();
  lastClock = null;
  renderAll();
  syncSettings();
  showToast('Prayer time settings saved.', null, 4000);
}

function notifyOpenings(from, to, snapshot) {
  if (!bucket().settings.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  for (let index = from; index < to; index++) {
    const prayer = PRAYERS[index];
    const notificationKey = `${snapshot.key}|${prayer}`;
    if (bucket().notified[notificationKey]) continue;
    bucket().notified[notificationKey] = true;
    new Notification(`${prayerDisplayName(prayer, snapshot.key)} is open`, { body: 'The next one is yours.', icon: 'icon.svg', tag: notificationKey });
  }
  saveRoot();
}

/* ---------- Profile form ---------- */

function updateProfileModeUI() {
  const mode = $('input[name="taklifMode"]:checked')?.value || '13solar';
  $('#customPubertyField').hidden = mode !== 'custom';
}

function submitTaklif(event) {
  event.preventDefault();
  const fullDate = $('#dobInput').value;
  const year = Number($('#birthYearInput').value);
  let dob;
  let estimated = false;
  if (fullDate) {
    dob = parseISODate(fullDate);
  } else if (Number.isInteger(year) && year >= 1900 && year <= indiaNowParts().year) {
    dob = parseISODate(`${year}-07-01`);
    estimated = true;
  }
  if (!dob) { showToast('Add a valid full birth date or birth year.', null, 5000); return; }
  const mode = $('input[name="taklifMode"]:checked')?.value || '13solar';
  if (mode === 'custom' && !parseISODate($('#customPubertyInput').value)) {
    showToast('Add the exact accountability date.', null, 5000); return;
  }
  const profile = bucket().profile;
  Object.assign(profile, {
    dob: dateKeyFromParts(dob),
    dobEstimated: estimated,
    birthYear: estimated ? year : '',
    mode,
    customPuberty: $('#customPubertyInput').value,
    haydExclude: $('#haydToggle').checked,
    cycleDays: Number($('#cycleDays').value) || 29.5,
    periodDays: Number($('#periodDays').value) || 7,
    updated_at: new Date().toISOString()
  });
  isEditingTaklif = false;
  saveRoot();
  populateProfileForm();
  renderTaklif();
  syncProfile();
  showToast('Accountability clock calculated & saved.', null, 4000);
  $('#taklifResults').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
}

/* ---------- Supabase auth and local-first sync ---------- */

let sb = null;
let session = null;
let realtimeChannel = null;
let syncInProgress = false;
let retryTimer = null;

function cloudCredentials() {
  return {
    url: DEPLOYMENT_CONFIG.supabaseUrl || root.cloudConfig.url || '',
    key: DEPLOYMENT_CONFIG.supabaseAnonKey || root.cloudConfig.key || ''
  };
}
function hasCloudConfig() {
  const { url, key } = cloudCredentials();
  return /^https:\/\/.+\.supabase\.co\/?$/.test(url) && key.length > 40;
}

async function initCloud() {
  if (!hasCloudConfig() || !window.supabase?.createClient) {
    updateAuthUI();
    return;
  }
  const { url, key } = cloudCredentials();
  sb = window.supabase.createClient(url.replace(/\/$/, ''), key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const { data, error } = await sb.auth.getSession();
  if (error) console.warn('Supabase session:', error.message);
  if (data?.session) await handleSession(data.session);
  sb.auth.onAuthStateChange((event, nextSession) => {
    setTimeout(async () => {
      if (nextSession?.user?.id !== session?.user?.id) await handleSession(nextSession);
      else { session = nextSession; updateAuthUI(); }
    }, 0);
  });
}

async function handleSession(nextSession) {
  if (!nextSession) {
    session = null;
    if (realtimeChannel && sb) await sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
    activeBucketId = 'local';
    root.active = 'local';
    saveRoot();
    renderAll();
    return;
  }
  session = nextSession;
  const uid = session.user.id;
  root.buckets[uid] ||= freshBucket();
  activeBucketId = uid;
  root.active = uid;
  normalizeBucket(bucket());
  saveRoot();
  updateAuthUI();
  try {
    await migrateLocalIfNeeded(uid);
    await pullRemote();
    subscribeRealtime(uid);
    await flushQueue();
  } catch (error) {
    console.error(error);
    databaseMayBeWaking();
  }
  renderAll();
}

async function migrateLocalIfNeeded(uid) {
  if (root.migrations[uid]) return;
  const local = normalizeBucket(root.buckets.local);
  const markCount = Object.keys(local.logs).length;
  const hasLocalRecord = markCount > 0 || Boolean(local.meta.started_at) || Boolean(local.profile.dob);
  if (hasLocalRecord) {
    mergeBucketInto(local, bucket());
    saveRoot();
    await uploadCurrentBucket().catch(console.warn);
  }
  root.migrations[uid] = true;
  saveRoot();
}

function mergeBucketInto(source, target) {
  if (source.profile.dob && (!target.profile.dob || new Date(source.profile.updated_at) > new Date(target.profile.updated_at))) target.profile = structuredClone(source.profile);
  if (new Date(source.settings.updated_at) > new Date(target.settings.updated_at)) target.settings = structuredClone(source.settings);
  if (source.meta.started_at && (!target.meta.started_at || new Date(source.meta.started_at) < new Date(target.meta.started_at))) target.meta.started_at = source.meta.started_at;
  for (const log of Object.values(source.logs)) {
    const existing = target.logs[`${log.log_date}|${log.prayer}`];
    if (!existing || new Date(log.updated_at) > new Date(existing.updated_at)) target.logs[`${log.log_date}|${log.prayer}`] = { ...log };
  }
}

function profileRow() {
  const p = bucket().profile;
  return {
    id: session.user.id,
    dob: p.dob || null,
    mode: p.mode,
    custom_puberty: p.customPuberty || null,
    hayd_exclude: Boolean(p.haydExclude),
    cycle_days: Number(p.cycleDays),
    period_days: Number(p.periodDays),
    updated_at: p.updated_at || new Date().toISOString()
  };
}
function settingsRow() {
  const s = bucket().settings;
  return {
    user_id: session.user.id,
    lat: Number(s.lat), lng: Number(s.lng),
    fajr_angle: Number(s.fajrAngle), isha_angle: Number(s.ishaAngle), asr_factor: Number(s.asrFactor),
    manual_times: s.manualTimes,
    updated_at: s.updated_at || new Date().toISOString()
  };
}

async function uploadCurrentBucket() {
  if (!session || !sb) return;
  setSyncPill('syncing');
  const operations = [
    sb.from('profiles').upsert(profileRow()),
    sb.from('settings').upsert(settingsRow())
  ];
  if (bucket().meta.started_at) operations.push(sb.from('notebook_meta').upsert({ user_id: session.user.id, started_at: bucket().meta.started_at }));
  const results = await Promise.all(operations);
  const firstError = results.find(result => result.error)?.error;
  if (firstError) throw firstError;
  const logs = Object.values(bucket().logs).map(log => ({ ...log, user_id: session.user.id }));
  for (let index = 0; index < logs.length; index += 500) {
    const { error } = await sb.from('prayer_logs').upsert(logs.slice(index, index + 500));
    if (error) throw error;
  }
  bucket().queue = [];
  saveRoot();
  setSyncPill('synced');
}

async function fetchAllLogs() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('prayer_logs').select('log_date,prayer,status,updated_at').order('log_date').range(from, from + 999);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

async function pullRemote() {
  if (!session || !sb || !navigator.onLine) return;
  setSyncPill('syncing');
  const [profileResult, settingsResult, metaResult, logs] = await Promise.all([
    sb.from('profiles').select('*').maybeSingle(),
    sb.from('settings').select('*').maybeSingle(),
    sb.from('notebook_meta').select('*').maybeSingle(),
    fetchAllLogs()
  ]);
  for (const result of [profileResult, settingsResult, metaResult]) if (result.error) throw result.error;
  const b = bucket();
  const rp = profileResult.data;
  if (rp && (!b.profile.dob || new Date(rp.updated_at) >= new Date(b.profile.updated_at))) {
    b.profile = {
      ...b.profile,
      dob: rp.dob || '', mode: rp.mode, customPuberty: rp.custom_puberty || '',
      haydExclude: rp.hayd_exclude, cycleDays: Number(rp.cycle_days), periodDays: Number(rp.period_days),
      updated_at: rp.updated_at
    };
  }
  const rs = settingsResult.data;
  if (rs && new Date(rs.updated_at) >= new Date(b.settings.updated_at)) {
    b.settings = {
      ...b.settings,
      lat: rs.lat, lng: rs.lng, city: closestCity(rs.lat, rs.lng),
      fajrAngle: rs.fajr_angle, ishaAngle: rs.isha_angle, asrFactor: rs.asr_factor,
      manualTimes: { ...defaultSettings().manualTimes, ...(rs.manual_times || {}) }, updated_at: rs.updated_at
    };
    solarCache.clear();
  }
  const remoteStart = metaResult.data?.started_at;
  if (remoteStart && (!b.meta.started_at || new Date(remoteStart) < new Date(b.meta.started_at))) b.meta.started_at = remoteStart;

  if (!b.meta.started_at && logs.length > 0) {
    const earliest = logs[0].log_date;
    b.meta.started_at = new Date(`${earliest}T00:00:00Z`).toISOString();
    syncMeta();
  }

  const remoteKeys = new Set(logs.map(log => `${log.log_date}|${log.prayer}`));
  const pendingKeys = new Set(b.queue.map(item => `${item.log_date}|${item.prayer}`));
  for (const localKey of Object.keys(b.logs)) {
    if (!remoteKeys.has(localKey) && !pendingKeys.has(localKey)) delete b.logs[localKey];
  }
  for (const log of logs) applyRemoteLog(log, false);
  saveRoot();
  setSyncPill(b.queue.length ? 'waiting' : 'synced');
  renderAll();
}

function applyRemoteLog(log, save = true) {
  if (!log?.log_date || !PRAYERS.includes(log.prayer)) return;
  const key = `${log.log_date}|${log.prayer}`;
  const local = bucket().logs[key];
  if (!local || new Date(log.updated_at) >= new Date(local.updated_at)) bucket().logs[key] = { log_date: log.log_date, prayer: log.prayer, status: log.status, updated_at: log.updated_at };
  if (save) { saveRoot(); renderToday(); renderNotebook(); renderTaklif(); }
}

function subscribeRealtime(uid) {
  if (!sb) return;
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel(`mihrab-logs-${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'prayer_logs', filter: `user_id=eq.${uid}` }, payload => {
      if (payload.eventType === 'DELETE') {
        const old = payload.old;
        if (old?.log_date && old?.prayer) delete bucket().logs[`${old.log_date}|${old.prayer}`];
        saveRoot(); renderToday(); renderNotebook(); renderTaklif();
      } else applyRemoteLog(payload.new);
    }).subscribe();
}

async function flushQueue() {
  if (syncInProgress || !session || !sb) return;
  if (!navigator.onLine) { setSyncPill('offline'); return; }
  const b = bucket();
  if (!b.queue.length) { setSyncPill('synced'); return; }
  syncInProgress = true;
  setSyncPill('syncing');
  try {
    while (b.queue.length) {
      const item = b.queue[0];
      const { data: remote, error: readError } = await sb.from('prayer_logs')
        .select('log_date,prayer,status,updated_at')
        .eq('user_id', session.user.id).eq('log_date', item.log_date).eq('prayer', item.prayer).maybeSingle();
      if (readError) throw readError;
      if (remote && new Date(remote.updated_at) > new Date(item.updated_at)) {
        applyRemoteLog(remote, false);
      } else if (item.operation === 'delete') {
        const { error } = await sb.from('prayer_logs').delete()
          .eq('user_id', session.user.id).eq('log_date', item.log_date).eq('prayer', item.prayer);
        if (error) throw error;
      } else {
        const { error } = await sb.from('prayer_logs').upsert({
          user_id: session.user.id,
          log_date: item.log_date,
          prayer: item.prayer,
          status: item.status,
          updated_at: item.updated_at
        });
        if (error) throw error;
      }
      b.queue.shift();
      saveRoot();
    }
    setSyncPill('synced');
  } catch (error) {
    console.warn('Sync is waiting:', error.message);
    databaseMayBeWaking();
  } finally {
    syncInProgress = false;
    renderNotebook();
  }
}

function databaseMayBeWaking() {
  if (!navigator.onLine) setSyncPill('offline');
  else {
    setSyncPill('waking');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(async () => { await pullRemote().catch(() => { }); flushQueue(); }, 30_000);
  }
}

function setSyncPill(state) {
  const pill = $('#syncPill');
  const waiting = bucket().queue.length;
  const labels = {
    local: 'Local only', syncing: 'Syncing…', synced: 'Synced ✓',
    offline: 'Offline — will sync', waiting: `${waiting} mark${waiting === 1 ? '' : 's'} waiting`,
    waking: 'Waking database (~30s)…'
  };
  const actual = !session ? 'local' : (state === 'synced' && waiting ? 'waiting' : state);
  pill.dataset.state = actual;
  pill.textContent = labels[actual] || labels.local;
  pill.title = actual === 'waiting' && waiting ? `${waiting} local changes are safely queued.` : pill.textContent;
}

async function syncProfile() {
  if (!session || !sb) return;
  setSyncPill('syncing');
  const { error } = await sb.from('profiles').upsert(profileRow());
  if (error) databaseMayBeWaking(); else setSyncPill('synced');
}
async function syncSettings() {
  if (!session || !sb) return;
  setSyncPill('syncing');
  const { error } = await sb.from('settings').upsert(settingsRow());
  if (error) databaseMayBeWaking(); else setSyncPill('synced');
}
async function syncMeta() {
  if (!session || !sb || !bucket().meta.started_at) return;
  setSyncPill('syncing');
  const { error } = await sb.from('notebook_meta').upsert({ user_id: session.user.id, started_at: bucket().meta.started_at });
  if (error) databaseMayBeWaking(); else setSyncPill('synced');
}

function updateAuthUI() {
  const configured = hasCloudConfig();
  $('#cloudSetupPanel').hidden = configured;
  $('#signInPanel').hidden = !configured || Boolean(session);
  $('#signedInPanel').hidden = !session;
  $('#authButton').textContent = session ? 'Account' : 'Sign in';
  $('#localOnlyBanner').hidden = Boolean(session);
  $('#deleteAccountButton').hidden = !session;
  if (session) {
    $('.signed-in-email').textContent = session.user.email || 'Signed in';
    $('#privacyFooter').textContent = 'Your notebook is locally cached and privately synced to your account with Row Level Security.';
  } else {
    $('#privacyFooter').textContent = 'Your record never leaves this device until you sign in.';
  }
  setSyncPill(session ? (bucket().queue.length ? 'waiting' : 'synced') : 'local');
}

async function sendMagicLink(event) {
  event.preventDefault();
  if (!sb) return;
  const email = $('#emailInput').value.trim();
  $('#authMessage').textContent = 'Sending a secure link…';
  const redirectTo = location.href.split('#')[0].split('?')[0];
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
  $('#authMessage').textContent = error ? error.message : `Link sent to ${email}. You can close this window.`;
}

async function googleSignIn() {
  if (!sb) return;
  const redirectTo = location.href.split('#')[0].split('?')[0];
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) $('#authMessage').textContent = error.message;
}

async function deleteAccount() {
  if (!session || !sb) return;
  if (!confirm('A CSV backup will download first. Then your cloud account and every row will be permanently deleted. Continue?')) return;
  exportCSV();
  if (!confirm('Final confirmation: permanently delete this Mihrab account?')) return;
  const uid = session.user.id;
  setSyncPill('syncing');
  const { error } = await sb.rpc('delete_own_account');
  if (error) { showToast(`Account deletion failed: ${error.message}`, null, 8000); return; }
  delete root.buckets[uid];
  delete root.migrations[uid];
  activeBucketId = 'local';
  root.active = 'local';
  session = null;
  saveRoot();
  renderAll();
  showToast('Your cloud account was deleted. The downloaded CSV is your backup.', null, 8000);
}

/* ---------- Event wiring ---------- */

function wireEvents() {
  document.addEventListener('click', event => {
    const mark = event.target.closest('[data-mark]');
    if (mark) markPrayer(mark.dataset.date, mark.dataset.prayer, mark.dataset.status);
    const day = event.target.closest('[data-open-day]');
    if (day && !day.disabled) openDayDialogFor(day.dataset.openDay);
    if (event.target.closest('[data-start]')) startNotebook();
    if (event.target.closest('[data-export]')) exportCSV();
    if (event.target.closest('[data-open-auth]')) $('#authDialog').showModal();
    const scroller = event.target.closest('[data-scroll]');
    if (scroller) $(scroller.dataset.scroll)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const closer = event.target.closest('[data-close-dialog]');
    if (closer) $(`#${closer.dataset.closeDialog}`)?.close();
  });

  $('#startNotebookButton').addEventListener('click', startNotebook);
  $('#settingsButton').addEventListener('click', () => { populateSettingsForm(); $('#settingsDialog').showModal(); });
  $('#authButton').addEventListener('click', () => $('#authDialog').showModal());
  $('#syncPill').addEventListener('click', () => { if (!session) $('#authDialog').showModal(); else flushQueue(); });
  $('#taklifForm').addEventListener('submit', submitTaklif);
  $('#editTaklifButton')?.addEventListener('click', () => { isEditingTaklif = !isEditingTaklif; renderTaklif(); });
  $('#cancelTaklifEdit')?.addEventListener('click', () => { isEditingTaklif = false; populateProfileForm(); renderTaklif(); });
  $$('input[name="taklifMode"]').forEach(input => input.addEventListener('change', updateProfileModeUI));
  $('#dobInput').addEventListener('input', () => { if ($('#dobInput').value) $('#birthYearInput').value = ''; $('#dobEstimateNote').hidden = true; });
  $('#birthYearInput').addEventListener('input', () => { if ($('#birthYearInput').value) $('#dobInput').value = ''; $('#dobEstimateNote').hidden = !$('#birthYearInput').value; });
  $('#haydToggle').addEventListener('change', () => { $('#haydFields').hidden = !$('#haydToggle').checked; });
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#manualTimesToggle').addEventListener('change', () => { $('#manualTimeFields').hidden = !$('#manualTimesToggle').checked; });
  $('#citySelect').addEventListener('change', () => {
    const city = CITIES.find(item => item.name === $('#citySelect').value);
    if (city) { $('#latInput').value = city.lat; $('#lngInput').value = city.lng; }
  });
  $('#calendarPrev').addEventListener('click', () => {
    calendarCursor.month--;
    if (calendarCursor.month < 1) { calendarCursor.month = 12; calendarCursor.year--; }
    renderCalendar();
  });
  $('#calendarNext').addEventListener('click', () => {
    calendarCursor.month++;
    if (calendarCursor.month > 12) { calendarCursor.month = 1; calendarCursor.year++; }
    renderCalendar();
  });
  $('#resetButton').addEventListener('click', resetNotebook);
  $('#deleteAccountButton').addEventListener('click', deleteAccount);
  $('#undoButton').addEventListener('click', undoLastMark);

  $('#saveCloudConfig').addEventListener('click', () => {
    const url = $('#cloudUrlInput').value.trim().replace(/\/$/, '');
    const key = $('#cloudKeyInput').value.trim();
    if (!/^https:\/\/.+\.supabase\.co$/.test(url) || key.length < 40) {
      showToast('Enter a valid Supabase project URL and public anon key.', null, 6000); return;
    }
    root.cloudConfig = { url, key };
    saveRoot();
    location.reload();
  });
  $('#magicLinkForm').addEventListener('submit', sendMagicLink);
  $('#googleSignIn').addEventListener('click', googleSignIn);
  $('#signOutButton').addEventListener('click', async () => { if (sb) await sb.auth.signOut(); });

  window.addEventListener('online', () => { setSyncPill(session ? 'waiting' : 'local'); pullRemote().catch(databaseMayBeWaking); flushQueue(); });
  window.addEventListener('offline', () => setSyncPill(session ? 'offline' : 'local'));
  window.addEventListener('focus', () => { if (session) { pullRemote().catch(databaseMayBeWaking); flushQueue(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && session) { pullRemote().catch(databaseMayBeWaking); flushQueue(); } });
}

/* ---------- Boot ---------- */

async function boot() {
  runGoldenTests();
  wireEvents();
  const today = todayKey();
  $('#dobInput').max = today;
  $('#customPubertyInput').max = today;
  $('#birthYearInput').max = indiaNowParts().year;
  populateSettingsForm();
  populateProfileForm();
  renderAll();
  const snapshot = clockSnapshot();
  renderOdometer(snapshot.count, false, true);
  setInterval(() => updateClock(), 1000);
  setInterval(() => { if (session) { pullRemote().catch(databaseMayBeWaking); flushQueue(); } }, 60_000);
  await initCloud();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(error => console.info('Service worker unavailable:', error.message));
  }
}

document.addEventListener('DOMContentLoaded', boot);
