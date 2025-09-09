# Daily Reminder Cron Setup

## Render Cron Job Configuration

1. Go to Render Dashboard > Your Service > Jobs
2. Create new Cron Job:
   - Name: daily-reminders
   - Schedule: 0 8 * * * (Daily at 8:00 AM UTC+3)
   - Command: node -e "require('./dist/services/calendar').sendDailyReminders()"

## Manual Testing

curl -X POST https://avukat-ajanda-backend.onrender.com/admin/send-reminders \
  -H "Authorization: Bearer ADMIN_TOKEN"

## Environment Variables
- TZ=Europe/Istanbul
- RESEND_API_KEY=required for email sending
