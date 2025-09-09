# Database Restore Guide

## Download backup
```bash
aws s3 cp s3://[BUCKET]/backup_YYYYMMDD_HHMMSS.sql.gz . \
  --endpoint-url $R2_ENDPOINT
