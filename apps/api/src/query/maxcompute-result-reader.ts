import { Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";
import { TextDecoder } from "node:util";
import type { Readable } from "node:stream";
import { resolve } from "node:path";
import type { QueryResult } from "@eureka-atlas/types" with { "resolution-mode": "import" };

export type ReaderJob = {endpoint:string;project:string;accessKey:string;secretKey:string;instanceId:string};
async function* lines(stream: Readable) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const decode = (chunk?: Buffer) => {
    try { return chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode(); }
    catch { throw new Error("Python 结果读取编码无效，必须使用 UTF-8"); }
  };
  let pending = "";
  for await (const chunk of stream) {
    pending += decode(chunk as Buffer);
    let index: number;
    while ((index = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0,index);pending = pending.slice(index+1);
      yield line;
    }
    if (Buffer.byteLength(pending) > 64*1024*1024) throw new Error("单条结果过大，无法读取");
  }
  pending += decode();
  if(pending.trim())yield pending;
}
@Injectable()
export class MaxComputeResultReader {
  async *read(job: ReaderJob, signal: AbortSignal): AsyncGenerator<QueryResult["rows"]> {
    signal.throwIfAborted();
    const child = spawn(process.env.MAXCOMPUTE_PYTHON_BIN || (process.platform === "win32" ? "python" : "python3"), ["-u",resolve(__dirname,"../../python/maxcompute_reader.py")],{stdio:["pipe","pipe","pipe"],windowsHide:true,env:{...process.env,PYTHONIOENCODING:"utf-8",PYTHONUTF8:"1"}});
    const closed = new Promise<number|null>((res,rej) => { child.once("error", () => rej(new Error("无法启动 Python，请配置 MAXCOMPUTE_PYTHON_BIN"))); child.once("close",res); });
    // Attach immediately so process startup errors never become unhandled rejections.
    void closed.catch(() => undefined);
    child.stderr.resume();
    const abort = () => { child.kill(); };
    signal.addEventListener("abort",abort,{once:true});
    child.stdin.on("error",() => undefined);
    child.stdin.end(JSON.stringify(job)+"\n");
    let done = false;
    let count = 0;
    try {
      for await (const line of lines(child.stdout)) {
        signal.throwIfAborted();
        if (Buffer.byteLength(line) > 64*1024*1024) throw new Error("结果分块过大，无法读取");
        let item: {error?:string;done?:boolean;count?:number;rows?:QueryResult["rows"]};
        try { item = JSON.parse(line); } catch { throw new Error("Python 结果读取协议无效"); }
        if (item.error) throw new Error(item.error);
        if (item.done) { if (done || item.count !== count) throw new Error("结果读取不完整"); done = true; continue; }
        if (done || !Array.isArray(item.rows) || item.rows.length > 1000 || item.rows.some(row => !Array.isArray(row) || row.some(value => value !== null && !["string","boolean"].includes(typeof value)))) throw new Error("结果分块无效");
        count += item.rows.length;
        if (count > 200001) throw new Error("结果超过读取上限");
        yield item.rows;
      }
      signal.throwIfAborted();
      if (await closed !== 0 || !done) throw new Error("完整结果读取未完成，未保存残缺结果");
    } finally {
      signal.removeEventListener("abort",abort); child.kill();
      await closed.catch(() => undefined);
    }
  }
}
