#!/usr/bin/env bash
# setup-skill-links.sh -- Linux / macOS
#
# Recreate the per-machine symlinks Claude Code uses to read the skills that live
# (canonically, git-tracked) at the repo-root skills/. The links sit under
# .claude/skills/<name>. Run once per fresh clone. Idempotent; safe to re-run.
#
# Skills already present in .claude/skills/ that do NOT exist under repo-root
# skills/ are left untouched -- this only manages the <name>s in both places.
#
# IMPORTANT (differs from sibling repos): AI-Automation-Library gitignores its
# whole CLIs/ tree, so its links can never be committed. taskhub TRACKS
# .claude/skills/, so a link here WOULD be committed -- content landing once at
# skills/<name>/ and again at .claude/skills/<name>/. Every linked <name> must be
# gitignored. This script verifies that and warns if it isn't.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"   # scripts/ -> repo root
skills_dir="$repo/skills"
[ -d "$skills_dir" ] || { echo "No skills/ directory at $skills_dir" >&2; exit 1; }

# Each agent's skills directory (relative to the repo root). The relative symlink
# target is 2 levels up to the repo root for .claude/skills/.
cli_skill_dirs=(
  ".claude/skills"    # Claude Code
)

linked=()

for rel in "${cli_skill_dirs[@]}"; do
  base="$repo/$rel"
  mkdir -p "$base"
  for target in "$skills_dir"/*/; do
    name="$(basename "$target")"
    # Only link real skills (a SKILL.md defines one).
    [ -f "$target/SKILL.md" ] || continue
    link="$base/$name"
    if [ -L "$link" ]; then
      rm "$link"
    elif [ -e "$link" ]; then
      echo "skip: $rel/$name is a real directory (not a link) -- remove it manually to relink."
      continue
    fi
    ln -s "../../skills/$name" "$link"
    echo "linked $rel/$name -> skills/$name"
    linked+=("$rel/$name")
  done
done

# Guard the double-commit hazard described in the header.
unignored=()
for rel in "${linked[@]}"; do
  if ! git -C "$repo" check-ignore -q -- "$rel" 2>/dev/null; then
    unignored+=("$rel")
  fi
done

echo
if [ ${#unignored[@]} -gt 0 ]; then
  echo "WARNING: these links are NOT gitignored, so git will follow them and commit" >&2
  echo "the skill content twice (once under skills/, again under .claude/skills/):" >&2
  printf '  %s\n' "${unignored[@]}" >&2
  echo >&2
  echo "Add each to .gitignore, e.g.:" >&2
  printf '  /%s/\n' "${unignored[@]}" >&2
else
  echo "All links are gitignored -- no double-commit risk."
fi
