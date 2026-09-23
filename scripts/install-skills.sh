#!/usr/bin/env bash
set -euo pipefail

# Runs from the repo root whatever the caller's directory is, so the symlink
# always names an absolute path inside this checkout.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

source_dir="$repo_root/skills/lexidraw"
skills_dir="${LEXIDRAW_SKILLS_DIR:-$HOME/.ai/skills}"
target="$skills_dir/lexidraw"

if [ ! -f "$source_dir/SKILL.md" ]; then
  echo "no skill at $source_dir/SKILL.md" >&2
  exit 1
fi

# The symlink outlives a worktree, so a checkout that will be deleted is not
# a place to point the global skill at.
if [ "${LEXIDRAW_ALLOW_WORKTREE:-}" != "1" ] &&
  [ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ]; then
  echo "refusing to install from a git worktree ($repo_root); run this from the main checkout, or set LEXIDRAW_ALLOW_WORKTREE=1" >&2
  exit 1
fi

bun run cli:install
echo "binary:  $HOME/.ai/bin/lexidraw"

mkdir -p "$skills_dir"

# A real directory there is someone's own skill, not a previous install of
# this one, so it is never replaced.
if [ -e "$target" ] && [ ! -L "$target" ]; then
  echo "refusing to replace $target: it exists and is not a symlink" >&2
  exit 1
fi

previous=""
if [ -L "$target" ]; then
  previous="$(readlink "$target")"
fi

ln -sfn "$source_dir" "$target"

if [ "$previous" = "$source_dir" ]; then
  echo "skill:   $target -> $source_dir (already linked)"
else
  echo "skill:   $target -> $source_dir"
fi
