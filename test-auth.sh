#!/bin/bash

API_URL=${1:-http://localhost:8000}
EMAIL="test$(date +%s)@example.com"
PASSWORD="Test123!"

echo "🧪 Testing Auth Flow on $API_URL"
echo "================================"
