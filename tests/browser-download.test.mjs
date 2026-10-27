import assert from "node:assert/strict";
import { test, mock, afterEach } from "node:test";

import {
  MAX_BROWSER_DOWNLOAD_BYTES,
  canDownloadInBrowser,
  downloadInBrowser,
} from "../src/lib/browser-download.ts";

afterEach(() => mock.restoreAll());

const url = "https://media.example/video.mp4";
const signal = () => new AbortController().signal;

test("only offers manageable complete files for browser download", () => {
  assert.equal(canDownloadInBrowser({ directUrl: url, needsMerge: false }), true);
  assert.equal(canDownloadInBrowser({ directUrl: url, needsMerge: true }), false);
  assert.equal(canDownloadInBrowser({ needsMerge: false }), false);
  assert.equal(canDownloadInBrowser({
    directUrl: url, needsMerge: false, sizeBytes: MAX_BROWSER_DOWNLOAD_BYTES,
  }), true);
  assert.equal(canDownloadInBrowser({
    directUrl: url, needsMerge: false, sizeBytes: MAX_BROWSER_DOWNLOAD_BYTES + 1,
  }), false);
});

test("downloads exact bytes and reports real browser-side progress", async () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5]);
  const progress = [];
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(bytes, {
    headers: { "content-type": "video/mp4", "content-length": "6" },
  }));
  const blob = await downloadInBrowser(url, {
    signal: signal(), onProgress: (update) => progress.push(update),
  });
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  assert.equal(blob.type, "video/mp4");
  assert.equal(progress.at(-1).downloadedBytes, 6);
  assert.equal(progress.at(-1).totalBytes, 6);
  assert.equal(fetchMock.mock.calls[0].arguments[1].credentials, "omit");
  assert.equal(fetchMock.mock.calls[0].arguments[1].mode, "cors");
});

test("supports streams with unknown size without inventing a percentage", async () => {
  mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([1, 2, 3])));
  const progress = [];
  const blob = await downloadInBrowser(url, { signal: signal(), onProgress: update => progress.push(update) });
  assert.equal(blob.size, 3);
  assert.equal(progress[0].totalBytes, undefined);
  assert.equal(progress[0].percent, 0);
});

test("surfaces cross-origin/network failures for visible server fallback", async () => {
  mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(downloadInBrowser(url, { signal: signal(), onProgress() {} }), /cross-origin/);
});

test("rejects platform error pages rather than saving them as video", async () => {
  mock.method(globalThis, "fetch", async () => new Response("<html>Login</html>", {
    headers: { "content-type": "text/html" },
  }));
  await assert.rejects(downloadInBrowser(url, { signal: signal(), onProgress() {} }), /instead of a media file/);
});

test("rejects failed HTTP responses", async () => {
  mock.method(globalThis, "fetch", async () => new Response("Forbidden", { status: 403 }));
  await assert.rejects(downloadInBrowser(url, { signal: signal(), onProgress() {} }), /HTTP 403/);
});

test("rejects empty and truncated transfers", async () => {
  mock.method(globalThis, "fetch", async () => new Response(new Uint8Array()));
  await assert.rejects(downloadInBrowser(url, { signal: signal(), onProgress() {} }), /empty file/);
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([1]), {
    headers: { "content-length": "10" },
  }));
  await assert.rejects(downloadInBrowser(url, { signal: signal(), onProgress() {} }), /incomplete/);
});

test("honors the browser memory limit before buffering a large response", async () => {
  mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([1]), {
    headers: { "content-length": String(MAX_BROWSER_DOWNLOAD_BYTES + 1) },
  }));
  await assert.rejects(downloadInBrowser(url, { signal: signal(), onProgress() {} }), /too large/);
});

test("honors cancellation instead of requesting server fallback", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  await assert.rejects(downloadInBrowser(url, { signal: controller.signal, onProgress() {} }), { name: "AbortError" });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("cancels an active browser stream and releases its reader", async () => {
  const controller = new AbortController();
  let streamCancelled = false;
  mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(stream) { stream.enqueue(new Uint8Array([1, 2, 3])); },
    cancel() { streamCancelled = true; },
  })));
  await assert.rejects(downloadInBrowser(url, {
    signal: controller.signal,
    onProgress() { controller.abort(); },
  }), { name: "AbortError" });
  assert.equal(streamCancelled, true);
});

test("rejects insecure or credential-bearing direct URLs", async () => {
  await assert.rejects(downloadInBrowser("http://media.example/video.mp4", { signal: signal(), onProgress() {} }), /cannot be downloaded/);
  await assert.rejects(downloadInBrowser("https://user:secret@media.example/video.mp4", { signal: signal(), onProgress() {} }), /cannot be downloaded/);
});
