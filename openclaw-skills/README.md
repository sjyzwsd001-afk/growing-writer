# OpenClaw Skills Backup

This folder is the Git backup source for custom OpenClaw skills.

## content-writer

- Runtime target: `~/.openclaw/workspace/skills/content-writer`
- PPT path: `publish_presentation.py` now calls NotebookLM native export (`export_native_ppt.py`) via NotebookLM `run.py`.

## Restore to OpenClaw runtime

From repo root:

```bash
./openclaw-skills/sync_to_openclaw.sh
```

## Verify

```bash
python3 ~/.openclaw/workspace/skills/content-writer/publish_presentation.py --help
```
