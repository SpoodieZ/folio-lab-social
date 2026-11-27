#!/bin/sh
# Copies the public app (index.html, icons, logos) next to the scripts, so the runner draws the images with the same code the site uses.
# Run it after every deploy of the app, before pushing this folder.
cd "$(dirname "$0")" || exit 1
rm -rf app && mkdir app && cp -R ../app/. app/ && echo "app copied: $(ls app | wc -l | tr -d ' ') entries"
