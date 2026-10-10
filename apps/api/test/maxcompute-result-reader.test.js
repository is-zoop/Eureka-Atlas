const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const childProcess = require("node:child_process");
const { MaxComputeResultReader } = require("../dist/query/maxcompute-result-reader");

const job = { endpoint: "mock", project: "中文项目", accessKey: "fake", secretKey: "fake", instanceId: "completed-instance" };

async function withReaderOutput(chunks, run) {
  const originalSpawn = childProcess.spawn;
  let captured;
  childProcess.spawn = (binary, args, options) => {
    captured = { binary, args, options, input: "" };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let stopped = false;
    let closed = false;
    child.kill = () => {
      stopped = true;
      if (!closed) { closed = true; child.stdout.end(); child.stderr.end(); child.emit("close", null); }
      return true;
    };
    child.stdin = new Writable({ write(chunk, _, callback) { captured.input += chunk.toString("utf8"); callback(); } });
    child.stdin.once("finish", () => {
      void (async () => {
        for (const chunk of chunks) {
          if (stopped) return;
          child.stdout.write(chunk);
          await new Promise(resolve => setImmediate(resolve));
        }
        if (!stopped) { closed = true; child.stdout.end(); child.stderr.end(); child.emit("close", 0); }
      })();
    });
    return child;
  };
  try { await run(new MaxComputeResultReader(), () => captured); }
  finally { childProcess.spawn = originalSpawn; }
}

async function collect(reader) {
  const rows = [];
  for await (const batch of reader.read(job, new AbortController().signal)) rows.push(...batch);
  return rows;
}

test("reader forces UTF-8 Python I/O and preserves Chinese, emoji, null and precision across byte boundaries", async () => {
  const expected = [["ELLE女装艾世天猫outlet店-日常", "香影官方旗舰店-日常", "流量来源😀", null, "12345678901234567890.123456789", false]];
  const bytes = Buffer.from(JSON.stringify({ rows: expected }) + "\n" + JSON.stringify({ done: true, count: 1 }) + "\n", "utf8");
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 2) chunks.push(bytes.subarray(offset, offset + 2));
  await withReaderOutput(chunks, async (reader, captured) => {
    assert.deepEqual(await collect(reader), expected);
    const invocation = captured();
    assert.equal(invocation.options.env.PYTHONIOENCODING, "utf-8");
    assert.equal(invocation.options.env.PYTHONUTF8, "1");
    assert.deepEqual(JSON.parse(invocation.input), job);
    assert.equal(invocation.args[0], "-u");
  });
});

test("reader restores ASCII JSON Unicode escapes without mojibake", async () => {
  const protocol = '{"rows":[["\\u5e97\\u94fa\\ud83d\\ude00",null,"9007199254740993"]]}\n{"done":true,"count":1}\n';
  await withReaderOutput([Buffer.from(protocol, "ascii")], async reader => {
    assert.deepEqual(await collect(reader), [["店铺😀", null, "9007199254740993"]]);
  });
});

test("reader rejects invalid or incomplete UTF-8 rather than silently replacing Chinese characters", async () => {
  for (const invalid of [Buffer.from([0xff]), Buffer.from([0xe4, 0xb8])]) {
    await withReaderOutput([Buffer.from('{"rows":[["'), invalid], async reader => {
      await assert.rejects(collect(reader), /编码无效.*UTF-8/);
    });
  }
});
