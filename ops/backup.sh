#!/bin/bash
set -e

# Configuration
DB_URL="${DATABASE_URL}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="backup_${TIMESTAMP}.sql.gz"
RETENTION_DAYS=7

# R2/S3 Configuration
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}"
R2_ENDPOINT="${R2_ENDPOINT:-https://[account-id].r2.cloudflarestorage.com}"
R2_BUCKET="${R2_BUCKET:-avukat-backups}"

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

# Dry run check
if [[ "$1" == "--dry-run" ]]; then
  echo "DRY RUN: Would create backup ${BACKUP_FILE}"
  echo "DB: ${DB_NAME} on ${DB_HOST}"
  echo "Target: s3://${R2_BUCKET}/${BACKUP_FILE}"
  exit 0
fi

# Create backup
echo "Creating backup: ${BACKUP_FILE}"
PGPASSWORD="${DB_PASS}" pg_dump -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" | gzip > "${BACKUP_FILE}"

# Upload to R2/S3
if [[ -n "${AWS_ACCESS_KEY_ID}" ]]; then
  echo "Uploading to R2/S3..."
  aws s3 cp "${BACKUP_FILE}" "s3://${R2_BUCKET}/${BACKUP_FILE}" \
    --endpoint-url "${R2_ENDPOINT}"
  
  # Remove old backups
  echo "Cleaning old backups..."
  aws s3 ls "s3://${R2_BUCKET}/" --endpoint-url "${R2_ENDPOINT}" | \
    while read -r line; do
      file=$(echo $line | awk '{print $4}')
      date=$(echo $line | awk '{print $1}')
      if [[ $(date -d "$date" +%s) -lt $(date -d "-${RETENTION_DAYS} days" +%s) ]]; then
        aws s3 rm "s3://${R2_BUCKET}/${file}" --endpoint-url "${R2_ENDPOINT}"
      fi
    done
else
  echo "Warning: No AWS credentials, keeping local backup only"
fi

# Clean up local file
rm -f "${BACKUP_FILE}"
echo "Backup completed successfully"
