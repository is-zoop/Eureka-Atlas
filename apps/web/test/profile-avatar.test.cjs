/* eslint-disable @typescript-eslint/no-require-imports -- Test browser image processing with deterministic canvas stubs. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
function fixture({ width = 512, height = 256, decodeError = false, large = false } = {}) {
  const revoked = [], draws = [], qualities = [];
  const canvas = { getContext: () => ({ drawImage: (...args) => draws.push(args) }), toDataURL: (type, quality) => { qualities.push(quality); assert.equal(type, "image/jpeg"); return large && quality > 0.7 ? "x".repeat(65_001) : "data:image/jpeg;base64,YWJjZA=="; } };
  class Image { constructor() { this.naturalWidth = width; this.naturalHeight = height; } async decode() { if (decodeError) throw new Error("invalid image"); } }
  const source = fs.readFileSync(path.join(__dirname, "../lib/profile-avatar.ts"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "Image", "URL", "document", code)(mod, mod.exports, Image, { createObjectURL: () => "blob:test", revokeObjectURL: value => revoked.push(value) }, { createElement: () => canvas });
  return { ...mod.exports, revoked, draws, qualities, canvas };
}

test("avatars are center-cropped to 256 square JPEG and release the temporary image URL", async () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    const f = fixture();
    assert.match(await f.normalizeAvatar({ type, size: 1024 }), /^data:image\/jpeg;base64,/);
    assert.equal(f.canvas.width, 256); assert.equal(f.canvas.height, 256);
    assert.deepEqual(f.draws[0].slice(1), [128, 0, 256, 256, 0, 0, 256, 256]);
    assert.deepEqual(f.revoked, ["blob:test"]);
  }
});

test("avatar validation rejects unsupported formats, file sizes, dimensions and decoding failures", async () => {
  for (const file of [{ type: "image/svg+xml", size: 1 }, { type: "image/jpeg", size: 6 * 1024 * 1024 }]) {
    const f = fixture(); await assert.rejects(f.normalizeAvatar(file)); assert.deepEqual(f.revoked, []);
  }
  for (const options of [{ width: 127 }, { height: 4097 }, { decodeError: true }]) {
    const f = fixture(options); await assert.rejects(f.normalizeAvatar({ type: "image/png", size: 1024 })); assert.deepEqual(f.revoked, ["blob:test"]);
  }
});

test("avatar compression lowers quality until it fits Haze's encoded field size", async () => {
  const f = fixture({ large: true });
  assert.ok((await f.normalizeAvatar({ type: "image/png", size: 1024 })).length <= f.AVATAR_MAX_LENGTH);
  assert.deepEqual(f.qualities, [0.9, 0.8, 0.7]);
});
