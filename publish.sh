#!/usr/bin/env bash
set -euo pipefail

# Publish a filtered milestone snapshot to the public repo.
# Excludes internal directories and dev-config files.
# Usage: ./publish.sh "v0.2: agent extraction pipeline"

EXCLUDE_DIRS=(docs plans .agents .github)
EXCLUDE_FILES=(.mcp.json publish.sh skills-lock.json)

if [ $# -eq 0 ]; then
  echo "Usage: ./publish.sh \"<milestone message>\""
  echo ""
  echo "Excluded from publish:"
  printf "  dirs:  %s\n" "${EXCLUDE_DIRS[*]}"
  printf "  files: %s\n" "${EXCLUDE_FILES[*]}"
  echo ""
  echo "Recent public milestones:"
  if git rev-parse public/latest >/dev/null 2>&1; then
    git log --oneline public/latest 2>/dev/null | head -10
  else
    echo "  (none yet — this will be the first)"
  fi
  exit 1
fi

MESSAGE="$1"

PATTERN="$(IFS='|'; echo "${EXCLUDE_DIRS[*]}|${EXCLUDE_FILES[*]}")"
FILTERED_TREE=$(
  git ls-tree HEAD \
    | grep -v -E $'\t'"(${PATTERN})$" \
    | git mktree
)

echo "Original tree: $(git rev-parse HEAD^{tree})"
echo "Filtered tree: $FILTERED_TREE"

if git rev-parse public/latest >/dev/null 2>&1; then
  PREV=$(git rev-parse public/latest)
  NEW_COMMIT=$(git commit-tree "$FILTERED_TREE" -p "$PREV" -m "$MESSAGE")
  echo "Created milestone commit $NEW_COMMIT (parent: ${PREV:0:7})"
else
  NEW_COMMIT=$(git commit-tree "$FILTERED_TREE" -m "$MESSAGE")
  echo "Created first milestone commit $NEW_COMMIT (no parent)"
fi

git tag -f public/latest "$NEW_COMMIT"
git branch -f publish "$NEW_COMMIT"

git push public "$NEW_COMMIT":refs/heads/main --force
echo ""
echo "Published to public remote:"
echo "  https://github.com/brian3814/synapse"
echo ""
echo "Public history:"
git log --oneline publish | head -10
