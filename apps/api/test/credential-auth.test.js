const test = require("node:test");
const assert = require("node:assert/strict");
const { AuthService } = require("../dist/auth/auth.service");
const { HazeAuthService } = require("../dist/auth/haze-auth.service");
const user = { member_no: "A", name: "用户", phone: "13800000000", email: null, department: "研发", role_code: "ADMIN", role_name: "管理员", status: "active" };
function request(authorization) { return { get: name => name === "authorization" ? authorization : undefined }; }

test("Haze personal credentials validate live identities for all known roles; routes enforce authorization", async () => {
  const original = global.fetch, origin = process.env.HAZE_API_ORIGIN;
  process.env.HAZE_API_ORIGIN = "https://haze-key.invalid";
  let role = "ADMIN", calls = 0, rejected = false;
  global.fetch = async (url, options) => {
    calls++; assert.equal(url, "https://haze-key.invalid/api/auth/personal-credential/me");
    assert.equal(options.headers.Authorization, "Bearer haze_private_key"); assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error"); assert.ok(options.signal);
    return rejected ? Response.json({ code: 4013 }, { status: 401 }) : Response.json({ code: 0, data: { ...user, role_code: role } });
  };
  const service = new AuthService(new HazeAuthService(), { decrypt() { throw new Error("must not use a Cookie token"); } });
  try {
    for (const value of [undefined, "", "Basic haze_private_key", "Bearer", "Bearer a,b", "Bearer a b", "Bearer " + "a".repeat(257)]) await assert.rejects(service.authenticateCredential(request(value)), e => e.getStatus() === 401);
    assert.equal(calls, 0);
    for (role of ["ADMIN", "SYSTEM_ADMIN", "DEVELOPER", "USER"]) assert.equal((await service.authenticateCredential(request("Bearer haze_private_key"))).member_no, "A");
    assert.equal(calls, 4);
    for (role of ["OWNER"]) await assert.rejects(service.authenticateCredential(request("Bearer haze_private_key")), e => e.getStatus() === 403);
    role = "ADMIN"; rejected = true;
    await assert.rejects(service.authenticateCredential(request("Bearer haze_private_key")), e => e.getStatus() === 401);
    assert.equal(calls, 6, "no positive cache can keep a reset key valid");
  } finally { global.fetch = original; if (origin === undefined) delete process.env.HAZE_API_ORIGIN; else process.env.HAZE_API_ORIGIN = origin; }
});

test("Haze outage and malformed replies fail closed without exposing the supplied key", async () => {
  const original = global.fetch, origin = process.env.HAZE_API_ORIGIN;
  process.env.HAZE_API_ORIGIN = "https://haze-key.invalid";
  const service = new AuthService(new HazeAuthService(), {});
  try {
    for (const reply of [async () => { throw new Error("haze_private_key"); }, async () => new Response("not JSON"), async () => Response.json({ code: 0, data: {} }), async () => Response.json({ code: 5000, message: "haze_private_key" }, { status: 500 })]) {
      global.fetch = reply;
      await assert.rejects(service.authenticateCredential(request("Bearer haze_private_key")), e => e.getStatus() === 503 && !e.message.includes("haze_private_key"));
    }
    global.fetch = async () => Response.json({ code: 0, data: { ...user, status: "disabled" } });
    await assert.rejects(service.authenticateCredential(request("Bearer haze_private_key")), e => e.getStatus() === 401);
  } finally { global.fetch = original; if (origin === undefined) delete process.env.HAZE_API_ORIGIN; else process.env.HAZE_API_ORIGIN = origin; }
});
