export const APP_ID = 'com.lemon.lvoverseas';
export const SOURCE = Object.freeze({
  url: 'https://play.google.com/store/apps/details?id=com.lemon.lvoverseas&hl=en&gl=us',
  country: 'us',
  language: 'en',
});

// These are the values displayed by the existing website before automation.
// They are a migration seed, not a claim about Play Store release history.
export const WEBSITE_SEED = Object.freeze({version: '16.9.0', updatedDate: '2026-03-05'});
const ORIGINS = new Set(['existing-website', 'observed-playstore']);

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
}

export function validateVersion(value) {
  if (typeof value !== 'string' || !/^\d{1,8}(?:\.\d{1,8}){1,3}$/.test(value)) {
    throw new Error('Play Store must return a numeric app version; refusing missing or device-dependent data');
  }
  return value;
}

export function compareVersions(left, right) {
  const a = validateVersion(left).split('.').map(BigInt);
  const b = validateVersion(right).split('.').map(BigInt);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const first = a[index] ?? 0n, second = b[index] ?? 0n;
    if (first > second) return 1;
    if (first < second) return -1;
  }
  return 0;
}

export function validateDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Release date must be YYYY-MM-DD');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < '2000-01-01') {
    throw new Error('Release date is not a valid calendar date');
  }
  return value;
}

function validateRelease(release) {
  requireObject(release, 'Release');
  validateVersion(release.version);
  validateDate(release.updatedDate);
}

export function validateMetadata(metadata, {allowSeed = false, now = Date.now()} = {}) {
  requireObject(metadata, 'Metadata');
  if (metadata.schemaVersion !== 1 || metadata.appId !== APP_ID) throw new Error('Unexpected metadata schema or app ID');
  requireObject(metadata.source, 'Source');
  if (metadata.source.url !== SOURCE.url || metadata.source.country !== SOURCE.country || metadata.source.language !== SOURCE.language) {
    throw new Error('Metadata source must remain the configured CapCut Play Store listing');
  }
  validateRelease(metadata.current);
  if (metadata.currentOrigin && !ORIGINS.has(metadata.currentOrigin)) throw new Error('Unknown current-version origin');
  if (metadata.previous !== null) {
    validateRelease(metadata.previous);
    if (compareVersions(metadata.previous.version, metadata.current.version) >= 0) throw new Error('Previous version must be older than current');
    if (metadata.previousOrigin && !ORIGINS.has(metadata.previousOrigin)) throw new Error('Unknown previous-version origin');
  }
  if (!metadata.checkedAt) {
    if (!allowSeed || metadata.currentOrigin !== 'existing-website' || metadata.previous !== null) throw new Error('Metadata validation timestamp is missing');
  } else {
    const timestamp = Date.parse(metadata.checkedAt);
    if (!Number.isFinite(timestamp) || timestamp > now + 86400000) throw new Error('Metadata validation timestamp is invalid');
  }
  if (metadata.current.updatedDate > new Date(now + 86400000).toISOString().slice(0, 10)) throw new Error('Release date is in the future');
  return metadata;
}

function initialMetadata() {
  return {schemaVersion: 1, appId: APP_ID, source: {...SOURCE}, current: {...WEBSITE_SEED}, previous: null, currentOrigin: 'existing-website'};
}

export function sourceRelease(app, now = Date.now()) {
  requireObject(app, 'Play Store app');
  if (app.appId !== APP_ID) throw new Error('Play Store returned the wrong app');
  const version = validateVersion(app.version);
  if (typeof app.updated !== 'number' || !Number.isFinite(app.updated) || app.updated < 946684800000 || app.updated > now + 86400000) {
    throw new Error('Play Store returned an invalid update timestamp');
  }
  const updatedDate = new Date(app.updated).toISOString().slice(0, 10);
  validateDate(updatedDate);
  return {version, updatedDate};
}

export function reconcileMetadata(app, previous, now = Date.now()) {
  const release = sourceRelease(app, now);
  const existing = previous ? structuredClone(previous) : initialMetadata();
  validateMetadata(existing, {allowSeed: !previous, now});
  const comparison = compareVersions(release.version, existing.current.version);
  if (comparison < 0) throw new Error(`Refusing a version downgrade from ${existing.current.version} to ${release.version}`);
  if (release.updatedDate < existing.current.updatedDate) throw new Error('Refusing an older Play Store update date');

  const result = {
    schemaVersion: 1,
    appId: APP_ID,
    source: {...SOURCE},
    current: release,
    previous: comparison > 0 ? {...existing.current} : existing.previous,
    currentOrigin: 'observed-playstore',
  };
  if (result.previous) result.previousOrigin = comparison > 0 ? existing.currentOrigin || 'observed-playstore' : existing.previousOrigin || 'observed-playstore';

  const oldStable = {...existing};
  delete oldStable.checkedAt;
  // A new check with unchanged release data must not manufacture a new release
  // or churn the repository. The Actions run records that successful check.
  if (existing.checkedAt && JSON.stringify(oldStable) === JSON.stringify(result)) return existing;
  result.checkedAt = new Date(now).toISOString();
  validateMetadata(result, {now});
  return result;
}
