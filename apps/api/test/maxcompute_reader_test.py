"""No network: verify the actual PyODPS reader protocol with a fake SDK."""
import importlib.util
import io
import json
import sys
import types
import unittest
from contextlib import redirect_stdout
from datetime import datetime
from decimal import Decimal
from pathlib import Path

spec = importlib.util.spec_from_file_location("reader", Path(__file__).parents[1] / "python" / "maxcompute_reader.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)

class ReaderTest(unittest.TestCase):
    def run_reader(self, count, extra_values=()):
        calls = []
        class Records:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def __iter__(self):
                for index in range(count):
                    yield types.SimpleNamespace(values=[index, Decimal("123456789.123456789012345678"), None, datetime(2026, 10, 9, 23, 59, 59), *extra_values])
        class Instance:
            def open_reader(self, **kwargs):
                calls.append(kwargs)
                return Records()
        class ODPS:
            def __init__(self, *args, **kwargs): pass
            def get_instance(self, instance_id):
                self_id = instance_id
                assert self_id == "already-executed"
                return Instance()
        old_module = sys.modules.get("odps")
        old_stdin = sys.stdin
        sys.modules["odps"] = types.SimpleNamespace(ODPS=ODPS)
        sys.stdin = io.StringIO(json.dumps(dict(accessKey="fake",secretKey="fake",project="p",endpoint="mock",instanceId="already-executed")))
        output = io.StringIO()
        try:
            with redirect_stdout(output): reader.main()
        finally:
            sys.stdin = old_stdin
            if old_module is None: del sys.modules["odps"]
            else: sys.modules["odps"] = old_module
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        return calls, messages
    def test_full_tunnel_and_precision(self):
        calls, messages = self.run_reader(12001)
        self.assertEqual(calls, [dict(tunnel=True, limit=False)])
        rows = [row for item in messages if "rows" in item for row in item["rows"]]
        self.assertEqual(len(rows), 12001)
        self.assertEqual(rows[0], ["0","123456789.123456789012345678",None,"2026-10-09 23:59:59"])
        self.assertTrue(all(len(item["rows"]) <= 1000 for item in messages if "rows" in item))
        self.assertEqual(messages[-1], dict(done=True,count=12001))
    def test_chinese_and_emoji_survive_the_reader_protocol(self):
        values = ["ELLE女装艾世天猫outlet店-日常", "香影官方旗舰店-日常", "流量来源😀", "", False]
        _, messages = self.run_reader(1, values)
        self.assertEqual(messages[0]["rows"][0][4:], values)

    def test_ascii_protocol_is_utf8_even_with_a_windows_gbk_stdout(self):
        value = {"rows": [["店铺名称", "香影官方旗舰店-日常", "中文与 emoji 😀", None]]}
        raw = io.BytesIO()
        output = io.TextIOWrapper(raw, encoding="gbk", errors="strict")
        try:
            with redirect_stdout(output):
                reader.emit(value)
            data = raw.getvalue()
            self.assertTrue(data.isascii())
            self.assertEqual(json.loads(data.decode("utf-8")), value)
        finally:
            output.close()

    def test_one_extra_row_and_empty(self):
        _, messages = self.run_reader(200010)
        self.assertEqual(messages[-1]["count"], 200001)
        _, empty = self.run_reader(0)
        self.assertEqual(empty, [dict(done=True,count=0)])

if __name__ == "__main__":
    unittest.main()
