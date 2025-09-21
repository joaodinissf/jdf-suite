#!/bin/bash

# Install pre-commit hooks for this repository
# This script provides multiple installation options

set -e

echo "Installing pre-commit hooks..."

# Check if pre-commit is available
if command -v pre-commit &>/dev/null; then
  echo "Using system pre-commit..."
  pre-commit install
elif command -v uvx &>/dev/null; then
  echo "Using uvx pre-commit..."
  uvx pre-commit install
else
  echo "Error: Neither 'pre-commit' nor 'uvx' is available."
  echo "Please install pre-commit first:"
  echo "  pip install pre-commit"
  echo "  # or"
  echo "  pipx install pre-commit"
  echo "  # or"
  echo "  uv tool install pre-commit"
  exit 1
fi

echo "Pre-commit hooks installed successfully!"
echo "Run 'pre-commit run --all-files' to test all hooks."
