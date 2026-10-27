import assert from "node:assert/strict";
import test from "node:test";

import { parseMediaUrl, safeFilename } from "../src/lib/media-url.ts";

const cases = [
  ["youtu.be/aqz-KE-bpKQ?si=tracking", "youtube", "https://www.youtube.com/watch?v=aqz-KE-bpKQ"],
  ["https://www.youtube.com/shorts/aqz-KE-bpKQ", "youtube", "https://www.youtube.com/watch?v=aqz-KE-bpKQ"],
  ["https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ", "youtube", "https://www.youtube.com/watch?v=aqz-KE-bpKQ"],
  ["https://m.tiktok.com/@creator.name/video/6748451240264420610?lang=en", "tiktok", "https://www.tiktok.com/@creator.name/video/6748451240264420610"],
  ["https://vm.tiktok.com/ZM123abc/?share=1", "tiktok", "https://vm.tiktok.com/ZM123abc/"],
  ["https://vt.tiktok.com/ZM123abc/", "tiktok", "https://vt.tiktok.com/ZM123abc/"],
  ["https://www.tiktok.com/t/ZM123abc/", "tiktok", "https://www.tiktok.com/t/ZM123abc/"],
  ["https://www.instagram.com/reel/Chunk8-jurw/?igsh=tracking", "instagram", "https://www.instagram.com/reel/Chunk8-jurw/"],
  ["https://www.instagram.com/reels/Chunk8-jurw/", "instagram", "https://www.instagram.com/reel/Chunk8-jurw/"],
  ["https://www.instagram.com/creator.name/reel/Chunk8-jurw/", "instagram", "https://www.instagram.com/reel/Chunk8-jurw/"],
  ["https://www.instagram.com/p/Chunk8-jurw/?img_index=1", "instagram", "https://www.instagram.com/p/Chunk8-jurw/"],
  ["https://www.instagram.com/tv/Chunk8-jurw/", "instagram", "https://www.instagram.com/tv/Chunk8-jurw/"],
];

for (const [input, platform, normalized] of cases) {
  test(`normalizes ${input}`, () => {
    const parsed = parseMediaUrl(input);
    assert.equal(parsed.platform, platform);
    assert.equal(parsed.normalized, normalized);
  });
}

for (const input of [
  "", "not a link", "https://youtube.com.evil.example/watch?v=aqz-KE-bpKQ",
  "https://youtube.com@evil.example/watch?v=aqz-KE-bpKQ",
  "https://user:password@www.youtube.com/watch?v=aqz-KE-bpKQ",
  "https://www.youtube.com:8443/watch?v=aqz-KE-bpKQ",
  "https://www.youtube.com/playlist?list=PL123",
  "https://www.tiktok.com/@creator", "https://vm.tiktok.com/a/b/",
  "https://www.instagram.com/stories/creator/123/", "https://www.instagram.com/creator/",
  "https://localhost/video.mp4", "file:///C:/secret.txt", "javascript:alert(1)",
  "https://www.tiktok.com/@creator/photo/6748451240264420610",
]) {
  test(`rejects unsupported or unsafe input: ${input}`, () => {
    assert.throws(() => parseMediaUrl(input));
  });
}

test("creates a safe media filename", () => {
  assert.equal(safeFilename('A <video>: "hello"/world', "MP4"), "A video hello world.mp4");
});
