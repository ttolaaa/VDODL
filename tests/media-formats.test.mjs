import assert from "node:assert/strict";
import test from "node:test";

import { buildMediaFormats } from "../src/lib/media-formats.ts";

const url = "https://media.example/video.mp4";
const audio = {
  format_id: "140", protocol: "https", vcodec: "none", acodec: "mp4a",
  ext: "m4a", abr: 128, filesize: 100, url: "https://media.example/audio.m4a",
};

test("lists YouTube video with combined stream sizes and separate audio", () => {
  const formats = buildMediaFormats([
    { format_id: "299", protocol: "https", height: 1080, ext: "mp4", vcodec: "avc1", acodec: "none", filesize: 900, fps: 60, url },
    audio,
  ]);
  assert.equal(formats.length, 2);
  assert.equal(formats[0].label, "1080p60");
  assert.equal(formats[0].sizeBytes, 1000);
  assert.equal(formats[0].needsMerge, true);
  assert.equal(formats[0].directUrl, undefined);
  assert.equal(formats[0].recommended, true);
  assert.equal(formats[1].directUrl, audio.url);
});

test("prefers complete MP4 over separate streams at the same resolution", () => {
  const formats = buildMediaFormats([
    { format_id: "video", protocol: "https", height: 720, ext: "mp4", acodec: "none", tbr: 3000, url },
    { format_id: "complete", protocol: "https", height: 720, ext: "mp4", acodec: "aac", url },
    audio,
  ]);
  assert.equal(formats[0].id, "complete");
  assert.equal(formats[0].needsMerge, false);
  assert.equal(formats[0].directUrl, url);
});

test("accepts TikTok complete MP4 without codec metadata", () => {
  const formats = buildMediaFormats([
    { format_id: "download", protocol: "https", height: 1920, ext: "mp4", url },
  ]);
  assert.equal(formats.length, 1);
  assert.equal(formats[0].needsMerge, false);
  assert.equal(formats[0].directUrl, url);
});

test("accepts an Instagram Reel without dimensions or codec metadata", () => {
  const formats = buildMediaFormats([{ format_id: "0", ext: "mp4", url }]);
  assert.equal(formats.length, 1);
  assert.equal(formats[0].label, "Original");
  assert.equal(formats[0].needsMerge, false);
  assert.equal(formats[0].directUrl, url);
});

test("keeps HLS formats as server-only downloads", () => {
  const formats = buildMediaFormats([
    { format_id: "hls", protocol: "m3u8_native", height: 720, ext: "mp4", url: "https://media.example/playlist.m3u8" },
  ]);
  assert.equal(formats.length, 1);
  assert.equal(formats[0].directUrl, undefined);
});

test("prefers HTTPS file formats over HLS at the same resolution", () => {
  const [format] = buildMediaFormats([
    { format_id: "hls", protocol: "m3u8_native", height: 720, ext: "mp4", tbr: 5000 },
    { format_id: "https", protocol: "https", height: 720, ext: "mp4", url },
  ]);
  assert.equal(format.id, "https");
  assert.equal(format.directUrl, url);
});

test("shows actual dimensions for portrait social videos", () => {
  const [format] = buildMediaFormats([
    { format_id: "portrait", protocol: "https", height: 1280, width: 720, ext: "mp4", url },
  ]);
  assert.equal(format.label, "720x1280");
  assert.equal(format.quality, "HD");
});

test("tags HD, Full HD, 2K, and 4K and recommends 1080p", () => {
  const formats = buildMediaFormats([
    { format_id: "313", protocol: "https", height: 2160, width: 3840, ext: "webm", vcodec: "vp9", acodec: "none", url },
    { format_id: "271", protocol: "https", height: 1440, width: 2560, ext: "webm", vcodec: "vp9", acodec: "none", url },
    { format_id: "137", protocol: "https", height: 1080, width: 1920, ext: "mp4", vcodec: "avc1", acodec: "none", url },
    { format_id: "136", protocol: "https", height: 720, width: 1280, ext: "mp4", vcodec: "avc1", acodec: "none", url },
    { format_id: "135", protocol: "https", height: 480, width: 854, ext: "mp4", vcodec: "avc1", acodec: "none", url },
    audio,
  ]);
  assert.deepEqual(formats.map((format) => format.quality), ["4K", "2K", "Full HD", "HD", undefined, undefined]);
  assert.equal(formats.find((format) => format.recommended)?.id, "137");
  assert.equal(formats[0].needsMerge, true);
});

test("recommends portrait Full HD for Shorts and TikTok", () => {
  const formats = buildMediaFormats([
    { format_id: "4k", protocol: "https", height: 3840, width: 2160, ext: "mp4", url },
    { format_id: "fhd", protocol: "https", height: 1920, width: 1080, ext: "mp4", url },
    { format_id: "hd", protocol: "https", height: 1280, width: 720, ext: "mp4", url },
  ]);
  assert.deepEqual(formats.map((format) => format.quality), ["4K", "Full HD", "HD"]);
  assert.equal(formats.find((format) => format.recommended)?.id, "fhd");
});

test("does not offer DRM, images, or formats with neither video nor audio", () => {
  assert.deepEqual(buildMediaFormats([
    { format_id: "drm", protocol: "https", ext: "mp4", has_drm: true, url },
    { format_id: "storyboard", protocol: "https", ext: "mhtml", url },
    { format_id: "empty", protocol: "https", vcodec: "none", acodec: "none", url },
  ]), []);
});

test("uses the actual container for WebM progressive files", () => {
  const [format] = buildMediaFormats([
    { format_id: "webm", protocol: "https", height: 720, ext: "webm", acodec: "opus", url },
  ]);
  assert.equal(format.container, "webm");
  assert.equal(format.needsMerge, false);
});

test("does not expose non-HTTPS media URLs for direct browser transfers", () => {
  const [format] = buildMediaFormats([
    { format_id: "http", protocol: "http", ext: "mp4", url: "http://media.example/video.mp4" },
  ]);
  assert.equal(format.directUrl, undefined);
});
