#!/bin/bash
set -e

# Usage: ./restore.sh backup_20250109_120000.sql.gz

if [[ -z "$1" ]]; then
  echo "Usage: $0 <backup_file>"
  echo "Example: $0 backup_20250109_120000.sql.gz"
  exit 1
fi

BACKUP_FILE="$1"
DB_URL="${DATABASE_URL}"

# Parse DATABASE_URL
if [[ $DB_URL =~ postgres://([^:]+):([^@]+)@([^/]+)/(.+) ]]; then
  DB_USER="${BASH_REMATCH[1]}"
  DB_PASS="${BASH_REMATCH[2]}"
  DB_HOST="${BASH_REMATCH[3]}"
  DB_NAME="${BASH_REMATCH[4]}"
else
  echo "Error: Invalid DATABASE_URL format"
  exit 1
fi

# Download from R2/S3 if needed
if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Downloading backup from R2/S3..."
  aws s3 cp "s3://${R2_BUCKET}/${BACKUP_FILE}" "${BACKUP_FILE}" \
    --endpoint-url "${R2_ENDPOINT}"
fi

echo "WARNING: This will overwrite the database ${DB_NAME}"
read -p "Are you sure? (yes/no): " confirm

if [[ "$confirm" != "yes" ]]; then
  echo "Restore cancelled"
  exit 0
fi

# Restore
echo "Restoring from ${BACKUP_FILE}..."
gunzip -c "${BACKUP_FILE}" | PGPASSWORD="${DB_PASS}" psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}"

echo "Restore completed successfully"
