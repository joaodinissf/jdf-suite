#!/bin/bash

# Install Git hooks for this repository
# Supports both pre-commit and lefthook

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "======================================================================"
echo "Git Hooks Installation Script"
echo "======================================================================"
echo ""
echo "This script can install:"
echo "  1. lefthook (fast local development)"
echo "  2. pre-commit (standardized CI/CD)"
echo "  3. Both (recommended for contributors)"
echo ""

# Function to check if command exists
command_exists() {
  command -v "$1" &>/dev/null
}

# Function to install lefthook
install_lefthook() {
  if command_exists lefthook; then
    echo -e "${GREEN}✓${NC} lefthook found, installing hooks..."
    lefthook install
    echo -e "${GREEN}✓${NC} lefthook hooks installed successfully!"
    echo "  Run 'lefthook run pre-commit --all-files' to test"
    return 0
  else
    echo -e "${YELLOW}⚠${NC} lefthook not found"
    echo "  Install with:"
    echo "    brew install lefthook"
    echo "    # or"
    echo "    npm install -g lefthook"
    echo "    # or"
    echo "    go install github.com/evilmartians/lefthook@latest"
    return 1
  fi
}

# Function to install pre-commit
install_precommit() {
  if command_exists pre-commit; then
    echo -e "${GREEN}✓${NC} pre-commit found, installing hooks..."
    pre-commit install
    echo -e "${GREEN}✓${NC} pre-commit hooks installed successfully!"
    echo "  Run 'pre-commit run --all-files' to test"
    return 0
  elif command_exists uvx; then
    echo -e "${GREEN}✓${NC} uvx found, installing pre-commit hooks..."
    uvx pre-commit install
    echo -e "${GREEN}✓${NC} pre-commit hooks installed successfully!"
    echo "  Run 'uvx pre-commit run --all-files' to test"
    return 0
  else
    echo -e "${YELLOW}⚠${NC} pre-commit not found"
    echo "  Install with:"
    echo "    pip install pre-commit"
    echo "    # or"
    echo "    pipx install pre-commit"
    echo "    # or"
    echo "    uv tool install pre-commit"
    return 1
  fi
}

# Check what's available
lefthook_available=$(command_exists lefthook && echo "yes" || echo "no")
precommit_available=$(command_exists pre-commit || command_exists uvx && echo "yes" || echo "no")

if [[ $lefthook_available == "yes" && $precommit_available == "yes" ]]; then
  echo "Both lefthook and pre-commit are available."
  echo ""
  read -p "Install which? (l=lefthook, p=pre-commit, b=both) [b]: " choice
  choice=${choice:-b}

  case "$choice" in
  l | L)
    echo ""
    install_lefthook
    ;;
  p | P)
    echo ""
    install_precommit
    ;;
  b | B)
    echo ""
    install_lefthook
    echo ""
    install_precommit
    ;;
  *)
    echo -e "${RED}✗${NC} Invalid choice"
    exit 1
    ;;
  esac
elif [[ $lefthook_available == "yes" ]]; then
  echo "Only lefthook is available."
  echo ""
  install_lefthook
elif [[ $precommit_available == "yes" ]]; then
  echo "Only pre-commit is available."
  echo ""
  install_precommit
else
  echo -e "${RED}✗${NC} Neither lefthook nor pre-commit is available."
  echo ""
  echo "Please install one of them:"
  echo ""
  echo -e "${BLUE}Lefthook${NC} (recommended for local development):"
  echo "  brew install lefthook"
  echo "  # or"
  echo "  npm install -g lefthook"
  echo ""
  echo -e "${BLUE}Pre-commit${NC} (recommended for CI/standardization):"
  echo "  pip install pre-commit"
  echo "  # or"
  echo "  uv tool install pre-commit"
  exit 1
fi

echo ""
echo "======================================================================"
echo "Installation complete!"
echo "======================================================================"
