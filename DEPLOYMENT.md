# Deployment and Operations

## Environment-specific secrets management

1. Use `.env.development` for local development values.
2. Use `.env.production` only on the server (never commit it).
3. Use different secrets per environment:
   - `SESSION_SECRET`
   - `GOOGLE_CLIENT_SECRET`
   - `REDIS_URL` (if private)
4. In production, set `NODE_ENV=production` and a strong `SESSION_SECRET` (32+ chars).

## Domain and HTTPS configuration

Set these variables in production:

- `APP_BASE_URL=https://your-domain.com`
- `APP_DOMAIN=your-domain.com`
- `FORCE_HTTPS=true`
- `TRUST_PROXY=1` (or per your host requirements)

Behavior in production:
- Requests are redirected to `APP_DOMAIN` when needed.
- HTTP requests are redirected to HTTPS.
- HSTS header is sent for stronger transport security.

## Health checks for hosting

Use:

- `GET /healthz`

Expected response:
- `200` with app/db/redis status when healthy.
- `503` if database health check fails.

## Database backup strategy

### Automatic backups

Configure:

- `BACKUP_DIR=backups`
- `BACKUP_INTERVAL_HOURS=24`
- `BACKUP_RETENTION_DAYS=14`

When `BACKUP_INTERVAL_HOURS` is greater than `0`, the app:
- Creates a backup at startup.
- Creates backups on the configured interval.
- Deletes backups older than retention.

### Manual backup command

Run:

```bash
npm run backup:db
```

This creates a timestamped SQLite copy and applies retention cleanup.
