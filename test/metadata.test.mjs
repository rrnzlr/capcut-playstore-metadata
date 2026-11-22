import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {APP_ID, SOURCE, compareVersions, reconcileMetadata, sourceRelease, validateMetadata} from '../lib/metadata.mjs';
import {updateMetadata} from '../scripts/update-metadata.mjs';

const NOW = Date.parse('2026-11-22T10:00:00Z');
const app = (version = '20.2.0', date = '2026-11-21T03:38:27Z') => ({appId: APP_ID, version, updated: Date.parse(date)});
const current = () => reconcileMetadata(app(), undefined, NOW);

test('fresh Play Store data uses the requested previous display without inventing its date', () => {
  const metadata = current();
  assert.deepEqual(metadata.current, {version: '20.2.0', updatedDate: '2026-11-21'});
  assert.deepEqual(metadata.previous, {version: '20.1.0', updatedDate: null});
  assert.equal(metadata.previousOrigin, 'manual-display');
  assert.equal(metadata.currentOrigin, 'observed-playstore');
  assert.deepEqual(metadata.source, SOURCE);
  validateMetadata(metadata, {now: NOW});
});

test('the manual previous display cannot become current or claim observed history with no date', () => {
  const metadata = current();
  assert.throws(() => validateMetadata({...metadata, current: {version: '20.2.0', updatedDate: null}}, {now: NOW}));
  assert.throws(() => validateMetadata({...metadata, previousOrigin: 'observed-playstore'}, {now: NOW}));
  assert.throws(() => validateMetadata({...metadata, previousOrigin: 'existing-website'}, {now: NOW}));
  assert.throws(() => validateMetadata({...metadata, currentOrigin: 'manual-display'}, {now: NOW}));
  assert.throws(() => validateMetadata({...metadata, previous: {version: '20.1.0'}}, {now: NOW}));
  assert.throws(() => validateMetadata({...metadata, previous: {version: '20.1.0', updatedDate: '2026-02-30'}}, {now: NOW}));
});

test('fresh source at or below the manual display version omits the previous label', () => {
  for (const version of ['20.1.0', '20.0.0']) {
    const metadata = reconcileMetadata(app(version), undefined, NOW);
    assert.equal(metadata.previous, null);
    assert.equal(metadata.previousOrigin, undefined);
  }
});

test('an observed new release shifts the complete old current record to previous', () => {
  const result = reconcileMetadata(app('20.3.0', '2026-11-22T01:00:00Z'), current(), NOW);
  assert.deepEqual(result.previous, current().current);
  assert.equal(result.previousOrigin, 'observed-playstore');
  assert.equal(result.current.version, '20.3.0');
});

test('unchanged checks retain bytes, history and the last published validation timestamp', () => {
  const existing = current();
  assert.deepEqual(reconcileMetadata(app(), existing, NOW + 3600000), existing);
});

test('an update date change for the same version does not shift previous history', () => {
  const existing = current();
  const result = reconcileMetadata(app('20.2.0', '2026-11-22T01:00:00Z'), existing, NOW);
  assert.equal(result.current.updatedDate, '2026-11-22');
  assert.deepEqual(result.previous, existing.previous);
});

test('version comparison is numeric and tolerates zero padding of component counts', () => {
  assert.equal(compareVersions('20.10.0', '20.2.0'), 1);
  assert.equal(compareVersions('20.2', '20.2.0'), 0);
  assert.equal(compareVersions('99999999.2.0', '99999998.99.99'), 1);
});

test('missing, device-dependent and malformed source versions are rejected', () => {
  for (const version of [undefined, '', 'VARY', 'Varies with device', '20.x.0', 'v20.2.0', '<script>']) {
    assert.throws(() => sourceRelease({...app(), version}, NOW));
  }
});

test('source timestamps must be milliseconds, real dates, and not future releases', () => {
  for (const updated of [undefined, NaN, 1795232307, '2026-11-21', NOW + 3 * 86400000]) {
    assert.throws(() => sourceRelease({...app(), updated}, NOW));
  }
  assert.throws(() => sourceRelease({...app(), appId: 'some.other.app'}, NOW));
});

test('source rollbacks and stale dates preserve the original object', () => {
  const existing = current(), frozen = structuredClone(existing);
  assert.throws(() => reconcileMetadata(app('20.1.0'), existing, NOW), /downgrade/);
  assert.throws(() => reconcileMetadata(app('20.2.0', '2026-11-20T01:00:00Z'), existing, NOW), /older/);
  assert.deepEqual(existing, frozen);
});

test('invalid saved metadata fails validation rather than discarding release history', () => {
  for (const patch of [{schemaVersion: 2}, {appId: 'other'}, {current: {version: '20.2.0', updatedDate: '2026-02-30'}}, {previous: {version: '20.3.0', updatedDate: '2026-11-21'}}, {checkedAt: 'not a date'}]) {
    assert.throws(() => validateMetadata({...current(), ...patch}, {now: NOW}));
  }
});

test('file publishing is atomic, idempotent, and leaves valid bytes intact on fetch failure', async t => {
  const parent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.test-tmp');
  await fs.mkdir(parent, {recursive: true});
  const directory = await fs.mkdtemp(path.join(parent, 'publish-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), parent);
    await fs.rm(directory, {recursive: true, force: true});
  });
  const filePath = path.join(directory, 'capcut.json');
  const first = await updateMetadata({filePath, fetchApp: async () => app(), now: NOW});
  assert.equal(first.changed, true);
  const original = await fs.readFile(filePath, 'utf8');
  assert.equal((await updateMetadata({filePath, fetchApp: async () => app(), now: NOW + 3600000})).changed, false);
  for (const fetchApp of [async () => { throw new Error('Network unavailable'); }, async () => app('VARY'), async () => app('20.1.0')]) {
    await assert.rejects(updateMetadata({filePath, fetchApp, now: NOW}));
    assert.equal(await fs.readFile(filePath, 'utf8'), original);
  }
  assert.deepEqual(await fs.readdir(directory), ['capcut.json']);
});

test('corrupt saved JSON is never overwritten', async t => {
  const parent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.test-tmp');
  await fs.mkdir(parent, {recursive: true});
  const directory = await fs.mkdtemp(path.join(parent, 'invalid-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), parent);
    await fs.rm(directory, {recursive: true, force: true});
  });
  const filePath = path.join(directory, 'capcut.json');
  await fs.writeFile(filePath, '{broken');
  await assert.rejects(updateMetadata({filePath, fetchApp: async () => app(), now: NOW}), /Existing metadata/);
  assert.equal(await fs.readFile(filePath, 'utf8'), '{broken');
});
