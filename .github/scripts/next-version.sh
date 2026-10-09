#!/usr/bin/env bash
# Decides the roadmap version for a build.
# - Patch releases are automatic: a new one is due when the rendered map differs from the latest release's.
# - Minor and major releases only happen when a maintainer asks for them (BUMP=minor|major).
# Inputs: FINGERPRINT (sha256 of the map PNG rendered without the revision line), BUMP (auto|minor|major),
#         GH_REPO and GH_TOKEN for the GitHub API. Outputs (to $GITHUB_OUTPUT): release, version, previous, date.
set -euo pipefail
: "${FINGERPRINT:?}" "${GH_REPO:?}"
BUMP="${BUMP:-auto}"

tag=v0.0.0 published="" body=""
if info="$(gh api "repos/$GH_REPO/releases/latest" --jq '[.tag_name, .published_at[0:10]] | @tsv' 2>/dev/null)"; then
  IFS=$'\t' read -r tag published <<<"$info"
  body="$(gh api "repos/$GH_REPO/releases/latest" --jq '.body // ""')"
fi
previous_fingerprint="$(grep -oE 'map-fingerprint: [0-9a-f]{64}' <<<"$body" | cut -d' ' -f2 || true)"

if [[ ! $tag =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "::error::The latest release tag '$tag' is not in vMAJOR.MINOR.PATCH form."
  exit 1
fi
major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=${BASH_REMATCH[3]}

release=true
if (( major < 2 )); then
  # Versions restart at 2.0.0 with the roadmap rendered from the site.
  version=v2.0.0
elif [[ $BUMP == major ]]; then
  version="v$((major + 1)).0.0"
elif [[ $BUMP == minor ]]; then
  version="v$major.$((minor + 1)).0"
elif [[ $FINGERPRINT != "$previous_fingerprint" ]]; then
  version="v$major.$minor.$((patch + 1))"
else
  release=false
  version=$tag
fi
date="$([[ $release == true ]] && date -u +%F || echo "$published")"

echo "Latest release $tag (map ${previous_fingerprint:-unknown}); this map $FINGERPRINT; bump $BUMP"
echo "=> release=$release version=$version date=$date"
{
  echo "release=$release"
  echo "version=$version"
  echo "previous=$tag"
  echo "date=$date"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"
