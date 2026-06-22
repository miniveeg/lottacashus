#!/usr/bin/env bash
# Run this BEFORE zipping the project for distribution.
# It removes any .env file from the working tree so secrets never ship in the archive.
# The .env file remains in .gitignore and is not affected by this script if you
# re-create it locally after zipping.
set -euo pipefail

if [[ -f .env ]]; then
  echo "Removing .env before zipping (it is gitignored and should not be distributed)."
  rm -f .env
fi

if [[ -f .env.local ]]; then
  echo "Removing .env.local before zipping."
  rm -f .env.local
fi

echo "Ready to zip. Use: zip -r lottacash.zip . -x '*/node_modules/*' -x '*/.git/*'"
