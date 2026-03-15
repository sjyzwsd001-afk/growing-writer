#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
publish_presentation.py

Generate PPT via NotebookLM native presentation export, then optionally deliver to Feishu.
"""
from __future__ import annotations

import argparse
import subprocess
from datetime import datetime
from pathlib import Path

FEISHU_TARGET = "ou_a05f6d895efc894b713c449c6021e94f"
OPENCLAW_NODE = "/opt/homebrew/bin/node"
OPENCLAW_CLI = "/opt/homebrew/lib/node_modules/openclaw/dist/index.js"


def _candidate_notebooklm_runners() -> list[Path]:
    home = Path.home()
    return [
        home / ".agents/skills/notebooklm/scripts/run.py",
        home / ".openclaw/workspace/skills/notebooklm/scripts/run.py",
        home / "openclaw-backups/openclaw-skill-notebooklm/scripts/run.py",
    ]


def resolve_notebooklm_runner(override: str | None) -> Path | None:
    if override:
        p = Path(override).expanduser()
        return p if p.exists() else None
    for runner in _candidate_notebooklm_runners():
        if runner.exists():
            return runner
    return None


def run_notebooklm_export(
    runner: Path,
    source: str | None,
    source_name: str | None,
    notebook_url: str | None,
    notebook_id: str | None,
    prompt: str | None,
    output: Path,
    show_browser: bool,
    auto_reauth: bool,
) -> None:
    cmd = [
        "python3",
        str(runner),
        "export_native_ppt.py",
        "--output",
        str(output),
    ]

    if source:
        cmd.extend(["--source", source])
    if source_name:
        cmd.extend(["--source-name", source_name])
    if notebook_url:
        cmd.extend(["--notebook-url", notebook_url])
    if notebook_id:
        cmd.extend(["--notebook-id", notebook_id])
    if prompt:
        cmd.extend(["--prompt", prompt])
    if auto_reauth:
        cmd.append("--auto-reauth")
    if show_browser:
        cmd.append("--show-browser")

    subprocess.run(cmd, check=True)


def deliver_feishu(path: Path) -> bool:
    try:
        subprocess.run(
            [
                OPENCLAW_NODE,
                OPENCLAW_CLI,
                "message",
                "send",
                "--channel",
                "feishu",
                "--target",
                FEISHU_TARGET,
                "--file",
                str(path),
            ],
            check=True,
            timeout=120,
        )
        return True
    except Exception as e:  # pragma: no cover - CLI integration
        print(f"Feishu upload failed: {e}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export PPT with NotebookLM native presentation flow."
    )
    parser.add_argument("--docx", help="Legacy alias of --source for docx inputs.")
    parser.add_argument("--source", help="NotebookLM URL, normal URL, or local file path.")
    parser.add_argument("--source-name", help="Notebook name when --source is used.")
    parser.add_argument("--notebook-url", help="NotebookLM URL.")
    parser.add_argument("--notebook-id", help="Notebook ID.")
    parser.add_argument("--prompt", help="Optional NotebookLM presentation prompt.")
    parser.add_argument("--output", help="Output PPTX path.")
    parser.add_argument("--deliver", choices=["feishu", "local"], default="feishu")
    parser.add_argument(
        "--notebooklm-runner",
        help="Path to notebooklm scripts/run.py (auto-detected if omitted).",
    )
    parser.add_argument(
        "--auto-reauth",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Auto re-authenticate when NotebookLM auth is stale (default: true).",
    )
    parser.add_argument(
        "--show-browser",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Show browser for better NotebookLM reliability (default: true).",
    )
    args = parser.parse_args()

    source = args.source or args.docx
    if not (source or args.notebook_url or args.notebook_id):
        print("Missing input: provide one of --source/--docx/--notebook-url/--notebook-id.")
        return 2

    runner = resolve_notebooklm_runner(args.notebooklm_runner)
    if not runner:
        print("NotebookLM runner not found. Set --notebooklm-runner to scripts/run.py path.")
        return 2

    if args.output:
        out_ppt = Path(args.output).expanduser()
    else:
        out_ppt = Path("/tmp") / f"presentation_{datetime.now().strftime('%Y%m%d%H%M%S')}.pptx"

    try:
        run_notebooklm_export(
            runner=runner,
            source=source,
            source_name=args.source_name,
            notebook_url=args.notebook_url,
            notebook_id=args.notebook_id,
            prompt=args.prompt,
            output=out_ppt,
            show_browser=args.show_browser,
            auto_reauth=args.auto_reauth,
        )
    except subprocess.CalledProcessError as e:
        print(f"NotebookLM export failed (exit {e.returncode}): {e}")
        return e.returncode or 1

    if not out_ppt.exists():
        print(f"NotebookLM command finished but output not found: {out_ppt}")
        return 1

    print(f"PPT created via NotebookLM native export: {out_ppt}")

    if args.deliver == "feishu":
        if deliver_feishu(out_ppt):
            print("Delivered to Feishu")
        else:
            print("Delivery failed")
    else:
        print(f"PPT available at: {out_ppt}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
