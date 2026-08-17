/**
 * gist.js — the shared envelope.
 *
 * Turns a bundle of files into a URL. That is the whole job.
 *
 * This module deliberately knows nothing about code runners, grading, lessons
 * or any widget's markup. Anything that can produce a `files` object can use it,
 * and it must never import a producer — the feature that needs both is the only
 * place they meet.
 *
 *   import { exportToGist } from '/assets/js/gist.js';
 *   const url = await exportToGist(files, { type: 'submission' });
 */

import { javaURI } from '/assets/js/api/config.js';

/** Filename of the manifest describing what an envelope contains. */
export const MANIFEST = 'ocs.json';

const DEFAULT_DESCRIPTION = 'Exported from Open Coding Society';

/**
 * Send a bundle of files off and get back a URL pointing at them.
 *
 * @param {Object} files  { "name.java": { content: "..." }, ... }
 * @param {Object} [opts]
 * @param {string} [opts.type]         what this bundle is, e.g. 'submission'.
 *                                     Written into the manifest so whoever opens
 *                                     it can tell whether it is theirs to handle.
 * @param {string} [opts.description]  human-readable label
 * @returns {Promise<string>} the URL
 */
export async function exportToGist(files, opts = {}) {
  if (!files || Object.keys(files).length === 0) {
    throw new Error('exportToGist: no files to send');
  }

  // Copy, so stamping the manifest never mutates the caller's object.
  const payload = { ...files };

  if (opts.type) {
    payload[MANIFEST] = {
      content: JSON.stringify({
        type: opts.type,
        version: 1,
        source: window.location.pathname,
        createdAt: new Date().toISOString(),
      }, null, 2),
    };
  }

  const res = await fetch(`${javaURI}/api/grades/create-gist`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Origin': 'client',
    },
    body: JSON.stringify({
      files: payload,
      description: opts.description || DEFAULT_DESCRIPTION,
    }),
  });

  if (!res.ok) {
    // 401/403 is by far the most common failure and deserves its own message,
    // otherwise callers surface the literal word "Forbidden" to a student.
    if (res.status === 401 || res.status === 403) {
      throw new Error('Sign in before exporting.');
    }
    throw new Error(`Export failed (${res.status})`);
  }

  const { url } = await res.json();
  if (!url) throw new Error('Export succeeded but returned no URL');
  return url;
}

/**
 * Read the manifest out of a bundle, if it has one.
 * Lets a consumer check `type` before trying to render someone else's payload.
 *
 * @param {Object} files
 * @returns {Object|null}
 */
export function readManifest(files) {
  const raw = files?.[MANIFEST]?.content;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/*
 * Note: importFromGist(url) belongs here and is the other half of the envelope,
 * but it needs a backend read endpoint (GET /api/gist/{id}) that does not exist
 * yet. Gists are created as secret, so the browser cannot reliably fetch them
 * from GitHub directly. Shipping a stub that fails at runtime would be worse
 * than leaving the gap visible, so it is deliberately absent.
 */
