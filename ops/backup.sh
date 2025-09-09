#!/bin/bash
set -e

# Configuration
DB_URL="${DATABASE_URL}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="backup_${TIMESTAMP}.sql.gz"

# Parse database URL
if [[ $DB_URL =~ postgres://([^:]+):([^@]+)@([^/]+)/(.+) ]]; then
  DB_USER="${BASH_REMATCH[1]}"
  DB_PASS="${BASH_REMATCH[2]}"
  DB_HOST="${BASH_REMATCH[3]}"
  DB_NAME="${BASH_REMATCH[4]}"
fi

# Dry run
if [[ "$1" == "--dry-run" ]]; then
  echo "DRY RUN MODE"
  echo "Would create: ${BACKUP_FILE}"
  echo "Database: ${DB_NAME}"
  echo "S3 bucket: ${R2_BUCKET}"
  exit 0
fi

# Create backup
echo "Creating backup..."
PGPASSWORD="${DB_PASS}" pg_dump -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" | gzip > "${BACKUP_FILE}"

# Upload to R2/S3
if [[ -n "${AWS_ACCESS_KEY_ID}" ]]; then
  aws s3 cp "${BACKUP_FILE}" "s3://${R2_BUCKET}/${BACKUP_FILE}" \
    --endpoint-url "${R2_ENDPOINT}"
  
  # Cleanup old backups (keep 7 days)
  aws s3 ls "s3://${R2_BUCKET}/" --endpoint-url "${R2_ENDPOINT}" | \
    awk '{print $4}' | \
    sort -r | \
    tail -n +8 | \
    xargs -I {} aws s3 rm "s3://${R2_BUCKET}/{}" --endpoint-url "${R2_ENDPOINT}" 2>/dev/null || true
fi

rm -f "${BACKUP_FILE}"
echo "Backup completed"
