// Runs one search of the app (see usage.mjs) in a thread of its own, so that the thread
// that forwards the client's requests is never held up. Started by scanClientInWorker().

import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { findUiBundle } from './bundle.mjs';
import { scanClient } from './usage.mjs';

const { appPath, names } = workerData;
try {
  const getBundle = () => findUiBundle(path.join(appPath, 'Contents', 'Resources', 'bin', 'language_server'));
  const result = await scanClient({ appPath, names, getBundle });
  parentPort.postMessage({ ok: true, used: [...result.used], files: result.files });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String(err?.message || err) });
}
