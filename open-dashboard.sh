#!/bin/bash
# open-dashboard.sh — Opens a new Chrome window with all Research Agent tabs
# Usage: bash open-dashboard.sh
# Called automatically by claude-auto launch (or manually)

URLS=(
  "http://localhost:3030"
  "http://localhost:3033"
  "http://localhost:3035"
  "http://localhost:3036"
  "http://localhost:3037"
  "http://localhost:3038"
  "http://localhost:3040"
  "http://localhost:3041"
)

# Build AppleScript: open new Chrome window, then open each URL as a tab
APPLESCRIPT='tell application "Google Chrome"
  make new window
  set targetWindow to front window
  set URL of active tab of targetWindow to "'"${URLS[0]}"'"
'
for URL in "${URLS[@]:1}"; do
  APPLESCRIPT+="  tell targetWindow to make new tab with properties {URL:\"$URL\"}
"
done
APPLESCRIPT+='  activate
end tell'

osascript -e "$APPLESCRIPT"
echo "Opened ${#URLS[@]} tabs in new Chrome window"
