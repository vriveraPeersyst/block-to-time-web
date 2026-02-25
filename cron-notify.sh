#!/bin/sh
set -e

if [ -z "$CRON_TARGET_URL" ] || [ -z "$CRON_SECRET" ]; then
  echo "Error: CRON_TARGET_URL and CRON_SECRET must be set"
  exit 1
fi

echo "Triggering notification cron at $CRON_TARGET_URL"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$CRON_TARGET_URL/api/cron/notify" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "Status: $HTTP_CODE"
echo "Response: $BODY"

if [ "$HTTP_CODE" -ge 400 ]; then
  exit 1
fi
