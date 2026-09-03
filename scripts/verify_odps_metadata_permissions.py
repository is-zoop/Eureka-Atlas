"""Verify the minimum MaxCompute permissions used by Eureka Atlas metadata sync.

This script reads only project, table-list, and table-schema metadata. It never
executes SQL and never reads table rows.

Environment variables (the first populated name is used):
  AccessKey ID: ODPS_ACCESS_ID, ODPS_ACCESS_KEY, access_id
  AccessKey Secret: ODPS_SECRET_ACCESS_KEY, ODPS_SECRET_KEY, access_key
  Project: ODPS_PROJECT, project (defaults to paiwo_smart)
  Endpoint: ODPS_ENDPOINT, endpoint
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Iterable


def load_env(path: Path) -> None:
    """Load a simple local .env file without overwriting real environment values."""
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        if name:
            os.environ.setdefault(name, value)


def env_value(names: Iterable[str], *, required: bool = True, default: str = "") -> str:
    for name in names:
        value = os.getenv(name, "").strip().strip('"').strip("'")
        if value:
            return value
    if required:
        raise RuntimeError(f"Missing configuration. Set one of: {', '.join(names)}")
    return default


def show_result(label: str, required_permission: str, action) -> tuple[bool, object | None]:
    try:
        value = action()
        print(f"PASS  {label}  [{required_permission}]")
        return True, value
    except Exception as error:  # pyodps uses several exception types for HTTP/API failures.
        print(f"FAIL  {label}  [{required_permission}]\n      {type(error).__name__}: {error}")
        return False, None


def main() -> int:
    parser = argparse.ArgumentParser(description="Check read-only MaxCompute metadata permissions.")
    parser.add_argument("--env-file", type=Path, default=Path(__file__).resolve().parents[1] / ".env", help="Credentials .env file to load (default: this project's .env).")
    parser.add_argument("--all-tables", action="store_true", help="Inspect every listed table schema; otherwise inspect the first 5.")
    parser.add_argument("--sample-size", type=int, default=5, help="Number of table schemas to inspect without --all-tables.")
    args = parser.parse_args()

    load_env(args.env_file)
    try:
        from odps import ODPS
    except ImportError:
        print("pyodps is not installed. Run this with the Haze_mcp virtual environment.", file=sys.stderr)
        return 2

    try:
        access_id = env_value(("ODPS_ACCESS_ID", "ODPS_ACCESS_KEY", "access_id"))
        secret = env_value(("ODPS_SECRET_ACCESS_KEY", "ODPS_SECRET_KEY", "access_key"))
        project_name = env_value(("ODPS_PROJECT", "project"), required=False, default="paiwo_smart")
        endpoint = env_value(("ODPS_ENDPOINT", "endpoint"), required=False, default="https://service.cn-hangzhou.maxcompute.aliyun.com/api")
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 2

    odps = ODPS(access_id=access_id, secret_access_key=secret, project=project_name, endpoint=endpoint)
    print(f"Checking project={project_name}, schema=default, endpoint={endpoint}")
    print("No SQL is executed and no table data is read.\n")

    project_ok, _ = show_result(
        "Read project metadata",
        "Project Read",
        lambda: odps.get_project().reload(),
    )
    list_ok, tables = show_result(
        "List tables in default schema",
        "Project List",
        lambda: list(odps.list_tables(schema="default")),
    )

    describe_ok = True
    if list_ok:
        table_list = tables or []
        selected = table_list if args.all_tables else table_list[: max(args.sample_size, 0)]
        print(f"\nInspecting {len(selected)} of {len(table_list)} listed table schemas...")
        for item in selected:
            name = item.name
            ok, _ = show_result(
                f"Describe table {name}",
                "Table Describe",
                lambda name=name: odps.get_table(name, schema="default").reload(),
            )
            describe_ok = describe_ok and ok
    else:
        describe_ok = False

    print("\nSummary")
    print(f"  Project Read: {'PASS' if project_ok else 'FAIL'}")
    print(f"  Project List: {'PASS' if list_ok else 'FAIL'}")
    print(f"  Table Describe: {'PASS' if describe_ok else 'FAIL'}")
    if project_ok and list_ok and describe_ok:
        print("\nThe account has the metadata permissions required by Eureka Atlas.")
        return 0
    print("\nGrant only the failed permission(s), then run this script again.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
