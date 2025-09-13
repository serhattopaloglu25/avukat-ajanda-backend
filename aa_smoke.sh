#!/usr/bin/env bash
set -euo pipefail

API="https://avukat-ajanda-backend.onrender.com"
EMAIL="aa-test+$(date +%s)@example.com"
PASS="Test1234!"
NAME="QA Bot"

need() { command -v "$1" >/dev/null || { echo "need $1"; exit 1; }; }
need curl

echo "1) Register"
curl -fsS -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"$NAME\"}" >/dev/null || true

echo "2) Login (gerçek JWT bekleniyor)"
TOK=$(curl -fsS -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [[ -z "${TOK:-}" || "$TOK" == mock-* ]]; then
  echo "❌ HATA: Token boş ya da mock görünüyor"; exit 1
fi
echo "   TOKEN_OK (${#TOK} chars)"

echo "3) /me ve /api/stats"
curl -fsS -H "Authorization: Bearer $TOK" "$API/me" >/dev/null
curl -fsS -H "Authorization: Bearer $TOK" "$API/api/stats" >/dev/null

echo "4) Müvekkil oluştur"
CID=$(curl -fsS -X POST "$API/api/clients" \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Deneme\",\"email\":\"deneme+$(date +%s)@mail.com\",\"phone\":\"+905551111111\",\"address\":\"İst, TR\"}" \
  | sed -n 's/.*"id":\s*\([0-9]*\).*/\1/p')
[[ -n "$CID" ]] || { echo "❌ HATA: Client id boş"; exit 1; }
echo "   CID=$CID"

echo "5) Dava oluştur"
CASE_NO="AA-$(date +%s)"
CASE_ID=$(curl -fsS -X POST "$API/api/cases" \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d "{\"caseNo\":\"$CASE_NO\",\"title\":\"Deneme Dava\",\"status\":\"active\",\"clientId\":$CID}" \
  | sed -n 's/.*"id":\s*\([0-9]*\).*/\1/p')
[[ -n "$CASE_ID" ]] || { echo "❌ HATA: Case id boş"; exit 1; }
echo "   CASE_ID=$CASE_ID"

echo "6) Etkinlik ekle (takvim)"
NOW=$(python3 - <<'PY'
from datetime import datetime, timezone
print(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
PY
)
IN1H=$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc)+timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"))
PY
)
EID=$(curl -fsS -X POST "$API/api/events" \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d "{\"title\":\"Duruşma\",\"type\":\"hearing\",\"caseId\":$CASE_ID,\"startsAt\":\"$NOW\",\"endsAt\":\"$IN1H\",\"location\":\"İst Adliyesi\"}" \
  | sed -n 's/.*"id":\s*\([0-9]*\).*/\1/p')
[[ -n "$EID" ]] || { echo "❌ HATA: Event id boş"; exit 1; }
echo "   EVENT_ID=$EID"

echo "✅ SMOKE PASS"
