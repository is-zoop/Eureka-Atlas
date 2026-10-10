"""Read only an already completed MaxCompute instance; never run SQL."""
import sys
import json
from decimal import Decimal
from datetime import date, datetime

def emit(value):
    # ASCII JSON is valid UTF-8 regardless of the Windows console code page.
    # JSON parsing restores the original Unicode strings without lossy decoding.
    sys.stdout.write(json.dumps(value, ensure_ascii=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()

def cell(value):
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, (int, Decimal)):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat(sep=" ") if isinstance(value, datetime) else value.isoformat()
    if isinstance(value, float):
        return str(value)
    return str(value)

def main():
    from odps import ODPS
    job = json.loads(sys.stdin.readline())
    client = ODPS(job["accessKey"], job["secretKey"], project=job["project"], endpoint=job["endpoint"])
    instance = client.get_instance(job["instanceId"])
    # Explicit flags forbid the SDK's limited legacy-reader fallback.
    with instance.open_reader(tunnel=True, limit=False) as reader:
        batch = []
        count = 0
        batch_bytes = 0
        for record in reader:
            row = [cell(value) for value in record.values]
            batch.append(row)
            batch_bytes += len(json.dumps(row, ensure_ascii=True, separators=(",", ":")).encode("ascii"))
            count += 1
            if len(batch) == 1000 or batch_bytes >= 1024 * 1024:
                emit({"rows": batch})
                batch = []
                batch_bytes = 0
            if count >= 200001:
                break
        if batch:
            emit({"rows": batch})
        emit({"done": True, "count": count})

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # No raw exception / traceback: upstream errors may contain credentials.
        permission = any(word in str(error).lower() for word in ("permission", "authorization", "access denied", "forbidden", "nopermission"))
        emit({"error": "MaxCompute 完整结果读取权限不足，请检查所有源表的下载权限" if permission else "MaxCompute 完整结果读取失败，请检查 Python、PyODPS 和 InstanceTunnel 配置"})
        sys.exit(1)
