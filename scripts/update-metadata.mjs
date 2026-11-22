import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import gplay from 'google-play-scraper';
import {APP_ID, SOURCE, reconcileMetadata, validateMetadata} from '../lib/metadata.mjs';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function fetchPlayStore() {
  return gplay.app({
    appId: APP_ID,
    lang: SOURCE.language,
    country: SOURCE.country,
    requestOptions: {timeout: {request: 20000}, retry: {limit: 1}},
  });
}

export async function updateMetadata({filePath = path.join(PROJECT, 'capcut.json'), fetchApp = fetchPlayStore, now = Date.now()} = {}) {
  let existing, original;
  try {
    original = await fs.readFile(filePath, 'utf8');
    existing = JSON.parse(original.replace(/^\uFEFF/, ''));
    validateMetadata(existing, {now});
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Existing metadata was not changed: ${error.message}`, {cause: error});
  }
  const incoming = await fetchApp();
  const next = reconcileMetadata(incoming, existing, now);
  const serialized = JSON.stringify(next, null, 2) + '\n';
  if (original === serialized) return {changed: false, metadata: next};

  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, serialized, {encoding: 'utf8', flag: 'wx'});
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, {force: true});
  }
  return {changed: true, metadata: next};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {changed, metadata} = await updateMetadata();
    console.log(JSON.stringify({changed, checkedSuccessfullyAt: new Date().toISOString(), current: metadata.current, previous: metadata.previous, previousOrigin: metadata.previousOrigin || null}));
  } catch (error) {
    console.error(`Play Store metadata update failed; the last valid file is retained. ${error.message}`);
    process.exitCode = 1;
  }
}
