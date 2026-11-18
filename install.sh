#!/usr/bin/env bash
# Installer for AntiGravity-Skills plugins (macOS / Linux)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_PLUGINS_DIR="${SCRIPT_DIR}/plugins"
TARGET_DIR="${HOME}/.gemini/config/plugins"
MODE="copy"
INSTALL_ALL=false
LIST_ONLY=false
EXPORT_CODEX=false
SELECTED=()

usage() {
  cat <<EOF
Usage:
  bash ./install.sh --all [--link] [--codex-skills] [--target-dir <dir>]
  bash ./install.sh --plugin doc-viewer,project-onboard [--link]
  bash ./install.sh --list

Options:
  --all                 Install all plugins
  --plugin <names>      Comma-separated plugin names to install
  --link                Symlink plugins instead of copying (live updates on git pull)
  --codex-skills        Also copy bundled SKILL.md folders into ~/.codex/skills/
  --target-dir <dir>    Custom target plugins directory (default: ~/.gemini/config/plugins)
  --list                List all available plugins
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) INSTALL_ALL=true; shift ;;
    --plugin|--plugins)
      IFS=',' read -r -a parts <<< "$2"
      SELECTED+=("${parts[@]}")
      shift 2
      ;;
    --link) MODE="link"; shift ;;
    --codex-skills) EXPORT_CODEX=true; shift ;;
    --target-dir) TARGET_DIR="$2"; shift 2 ;;
    --list|-h|--help) LIST_ONLY=true; shift ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ "${LIST_ONLY}" == "true" ]] || { [[ "${INSTALL_ALL}" == "false" ]] && [[ ${#SELECTED[@]} -eq 0 ]]; }; then
  echo "Available plugins in AntiGravity-Skills:"
  for d in "${REPO_PLUGINS_DIR}"/*/; do
    [[ -d "$d" ]] || continue
    printf "  - %s\n" "$(basename "$d")"
  done
  echo ""
  usage
  exit 0
fi

if [[ "${INSTALL_ALL}" == "true" ]]; then
  SELECTED=()
  for d in "${REPO_PLUGINS_DIR}"/*/; do
    [[ -d "$d" ]] || continue
    SELECTED+=("$(basename "$d")")
  done
fi

mkdir -p "${TARGET_DIR}"

for name in "${SELECTED[@]}"; do
  src="${REPO_PLUGINS_DIR}/${name}"
  if [[ ! -d "${src}" ]]; then
    echo "[Warn] Plugin '${name}' not found (skipped)."
    continue
  fi
  dst="${TARGET_DIR}/${name}"
  rm -rf "${dst}"
  if [[ "${MODE}" == "link" ]]; then
    ln -s "${src}" "${dst}"
    echo "[Linked]    ${name} -> ${dst}"
  else
    cp -R "${src}" "${dst}"
    echo "[Installed] ${name} -> ${dst}"
  fi

  if [[ "${name}" == "doc-viewer" ]] && [[ -f "${dst}/sidecars/doc_viewer/package.json" ]] && [[ ! -d "${dst}/sidecars/doc_viewer/node_modules" ]]; then
    if command -v npm >/dev/null 2>&1; then
      echo "  -> Installing npm dependencies for doc-viewer sidecar..."
      (cd "${dst}/sidecars/doc_viewer" && npm install --no-audit --no-fund)
    else
      echo "[Warn] npm not found on PATH. Run 'npm install' inside ${dst}/sidecars/doc_viewer manually."
    fi
  fi

  if [[ "${EXPORT_CODEX}" == "true" ]] && [[ -d "${src}/skills" ]]; then
    mkdir -p "${HOME}/.codex/skills"
    for sd in "${src}/skills"/*/; do
      [[ -d "${sd}" ]] || continue
      sname="$(basename "${sd}")"
      rm -rf "${HOME}/.codex/skills/${sname}"
      cp -R "${sd}" "${HOME}/.codex/skills/${sname}"
      echo "  -> Exported skill '${sname}' to ${HOME}/.codex/skills/${sname}"
    done
  fi
done

echo ""
echo "Done! Plugins are ready in Antigravity (${TARGET_DIR})."
