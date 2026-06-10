# DEPLOYMENT — Server Deployment Guide
## ClaimLens — NPI Intelligence Platform

---

## Document Purpose

This document covers deploying ClaimLens to a Linux VPS for the MVP demo. It takes you from a freshly provisioned server to a live HTTPS URL with both dashboards accessible. Every command is copy-paste ready.

**Target environment:** Ubuntu 22.04 LTS VPS
**Stack:** Nginx + Uvicorn (systemd) + PM2 (Next.js) + PostgreSQL + Certbot
**Estimated time:** 60–90 minutes on a clean server

---

## Server Requirements

### Minimum specifications for MVP demo

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 2 GB | 4 GB |
| Storage | 20 GB SSD | 40 GB SSD |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| Network | 1 Gbps | 1 Gbps |

### Providers that work well
Any VPS provider running Ubuntu 22.04. Common choices: DigitalOcean Droplet, Linode, Vultr, Hetzner, AWS EC2 t3.small.

### Domain requirement
You need a domain name pointed to your server's IP address before running Certbot for HTTPS. Update the DNS A record and wait for propagation (up to 48 hours, usually under 1 hour).

---

## Part 1 — Initial Server Setup

### 1.1 — Connect to the server

```bash
ssh root@your-server-ip
# or if using a non-root user with sudo:
ssh ubuntu@your-server-ip
```

### 1.2 — Update the system

```bash
apt update && apt upgrade -y
```

### 1.3 — Create a non-root user (if connecting as root)

```bash
adduser claimlens
usermod -aG sudo claimlens
# Copy SSH keys to new user
rsync --archive --chown=claimlens:claimlens ~/.ssh /home/claimlens
```

Switch to the new user:
```bash
su - claimlens
```

### 1.4 — Configure the firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'    # HTTP and HTTPS
ufw deny 5432             # PostgreSQL — internal only, never expose
ufw deny 8000             # FastAPI — served through Nginx, not directly
ufw enable

# Verify
ufw status
```

Expected output:
```
Status: active
To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
Nginx Full                 ALLOW       Anywhere
5432                       DENY        Anywhere
8000                       DENY        Anywhere
```

---

## Part 2 — Install Dependencies

### 2.1 — Install system packages

```bash
sudo apt install -y \
    git \
    curl \
    wget \
    unzip \
    nginx \
    certbot \
    python3-certbot-nginx \
    python3.11 \
    python3.11-venv \
    python3-pip \
    postgresql \
    postgresql-contrib \
    libpq-dev \
    python3.11-dev \
    build-essential
```

### 2.2 — Install Node.js 18

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version   # Expected: v18.x.x
npm --version    # Expected: 9.x.x
```

### 2.3 — Install PM2 globally

```bash
sudo npm install -g pm2

# Verify
pm2 --version
```

---

## Part 3 — PostgreSQL Setup

### 3.1 — Start and enable PostgreSQL

```bash
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verify
sudo systemctl status postgresql
```

### 3.2 — Create database and user

```bash
sudo -u postgres psql
```

Inside the psql shell:
```sql
CREATE USER claimlens WITH PASSWORD 'your-strong-password-here';
CREATE DATABASE claimlens_db OWNER claimlens;
GRANT ALL PRIVILEGES ON DATABASE claimlens_db TO claimlens;
\q
```

**Use a strong password.** Not `claimlens_password` from local development. Generate one:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 3.3 — Configure PostgreSQL to listen on localhost only

Verify the default configuration is localhost-only:
```bash
sudo grep "listen_addresses" /etc/postgresql/14/main/postgresql.conf
```

Expected: `listen_addresses = 'localhost'`

If it shows `'*'`, change it to `'localhost'`:
```bash
sudo sed -i "s/listen_addresses = '\*'/listen_addresses = 'localhost'/" \
    /etc/postgresql/14/main/postgresql.conf
sudo systemctl restart postgresql
```

### 3.4 — Test database connection

```bash
psql -U claimlens -h localhost -d claimlens_db -c "SELECT version();"
# Enter the password you set in 3.2
```

Expected: Shows PostgreSQL version string.

---

## Part 4 — Deploy the Application

### 4.1 — Clone the repository

```bash
cd /home/claimlens
git clone https://github.com/your-org/claimlens.git
cd claimlens
```

### 4.2 — Configure environment variables

```bash
cp .env.example .env
nano .env
```

Set production values:

```env
# ─── DATABASE ───────────────────────────────────────────────
DATABASE_URL=postgresql://claimlens:your-strong-password-here@localhost:5432/claimlens_db

# ─── OPENAI ─────────────────────────────────────────────────
OPENAI_API_KEY=sk-your-production-key-here

# ─── SECURITY ───────────────────────────────────────────────
SECRET_KEY=your-production-secret-key-here

# ─── CORS ───────────────────────────────────────────────────
# Replace with your actual domain
CORS_ORIGINS=https://your-domain.com

# ─── APP ────────────────────────────────────────────────────
PORT=8000
ENVIRONMENT=production

# ─── THRESHOLDS AND WEIGHTS ─────────────────────────────────
VOLUME_SPIKE_MULTIPLIER=2.0
GEOGRAPHIC_ANOMALY_MILES=150.0
CROSS_NPI_THRESHOLD=3
NEW_SUPPLIER_DAYS_LOOKBACK=30
NEW_SUPPLIER_AMOUNT_THRESHOLD=500.00
WEIGHT_VOLUME_SPIKE=25
WEIGHT_GEO_ANOMALY=15
WEIGHT_CROSS_NPI=30
WEIGHT_OIG_HIT=35
WEIGHT_NEW_SUPPLIER=10
WEIGHT_PER_PHYSICIAN_FLAG=5
MAX_PHYSICIAN_FLAG_CONTRIBUTION=20
SSE_KEEPALIVE_SECONDS=15
```

Set file permissions — `.env` should not be world-readable:
```bash
chmod 600 .env
```

### 4.3 — Set up Python virtual environment

```bash
cd /home/claimlens/claimlens/backend
python3.11 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 4.4 — Initialize the database schema

```bash
# With venv active
python3 -c "
from database import engine
from models import Base
Base.metadata.create_all(bind=engine)
print('Database tables created successfully')
"
```

Expected: `Database tables created successfully`

Verify tables were created:
```bash
psql -U claimlens -h localhost -d claimlens_db -c "\dt"
```

Expected: Lists 5 tables — actions, claims, npi_profiles, npi_risk_scores, rules_flags

### 4.5 — Generate synthetic data

```bash
# With venv active, from backend directory
python data/load_oig_leie.py
python data/generate_synthetic.py
```

Wait for generation to complete (3–6 minutes).

```bash
# Run rules engine and scoring
python3 -c "
from database import SessionLocal
from config import get_settings
from rules.engine import run_all_rules
from scoring.risk_score import calculate_all_scores

db = SessionLocal()
settings = get_settings()
run_all_rules(db, settings)
calculate_all_scores(db, settings)
db.close()
print('Processing complete')
"

# Seed demo actions
python data/seed_demo_actions.py
```

### 4.6 — Run verification queries

```bash
psql -U claimlens -h localhost -d claimlens_db
```

```sql
SELECT COUNT(*) FROM claims;                          -- Must be 800
SELECT COUNT(DISTINCT npi) FROM claims
WHERE supplier_name = 'MedSupply Pro LLC';            -- Must be 9
SELECT COUNT(*) FROM rules_flags
WHERE rule_name = 'geographic_anomaly';               -- Must be >= 20
SELECT COUNT(*) FROM claims WHERE oig_flagged = true; -- Must be >= 35
\q
```

All 4 must pass before proceeding.

### 4.7 — Build the Next.js frontend

```bash
cd /home/claimlens/claimlens/frontend

# Create production environment file
cat > .env.production << 'EOF'
NEXT_PUBLIC_API_URL=https://your-domain.com/api
EOF

npm install
npm run build
```

Expected final output:
```
✓ Compiled successfully
Route (app)                              Size     First Load JS
┌ ○ /                                   ...
├ ○ /physician                          ...
├ ○ /plan                               ...
...
✓ Generating static pages (8/8)
```

---

## Part 5 — Configure systemd for FastAPI

Create a systemd service so the FastAPI backend starts automatically and restarts on crash.

### 5.1 — Create the service file

```bash
sudo nano /etc/systemd/system/claimlens-api.service
```

Paste this content:

```ini
[Unit]
Description=ClaimLens FastAPI Backend
After=network.target postgresql.service
Requires=postgresql.service

[Service]
User=claimlens
Group=claimlens
WorkingDirectory=/home/claimlens/claimlens/backend
Environment="PATH=/home/claimlens/claimlens/backend/venv/bin"
EnvironmentFile=/home/claimlens/claimlens/.env
ExecStart=/home/claimlens/claimlens/backend/venv/bin/uvicorn \
    main:app \
    --host 127.0.0.1 \
    --port 8000 \
    --workers 2 \
    --log-level info
ExecReload=/bin/kill -s HUP $MAINPID
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=claimlens-api

[Install]
WantedBy=multi-user.target
```

**Key settings explained:**
- `--host 127.0.0.1` — binds only to localhost, not public internet
- `--workers 2` — 2 Uvicorn workers for the demo (increase for production)
- `Restart=always` — auto-restart on crash
- `EnvironmentFile` — loads `.env` as environment variables

### 5.2 — Enable and start the service

```bash
sudo systemctl daemon-reload
sudo systemctl enable claimlens-api
sudo systemctl start claimlens-api
```

### 5.3 — Verify the service is running

```bash
sudo systemctl status claimlens-api
```

Expected output:
```
● claimlens-api.service - ClaimLens FastAPI Backend
     Loaded: loaded (/etc/systemd/system/claimlens-api.service; enabled)
     Active: active (running) since ...
   Main PID: 12345 (uvicorn)
```

```bash
# Test the API is accessible locally
curl http://localhost:8000/health
```

Expected: `{"status":"ok","database":"connected",...}`

### 5.4 — View backend logs

```bash
sudo journalctl -u claimlens-api -f
# -f follows the log in real time
# Press Ctrl+C to exit
```

---

## Part 6 — Configure PM2 for Next.js

### 6.1 — Start Next.js with PM2

```bash
cd /home/claimlens/claimlens/frontend

pm2 start npm --name "claimlens-frontend" -- start
```

### 6.2 — Save PM2 process list

```bash
pm2 save
```

### 6.3 — Configure PM2 to start on server boot

```bash
pm2 startup
# This prints a command — run it as instructed
# It will look like:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u claimlens --hp /home/claimlens
# Copy and run that exact command
```

### 6.4 — Verify frontend is running

```bash
pm2 status
```

Expected:
```
┌─────┬──────────────────────┬─────────┬──────┬───────────┐
│ id  │ name                 │ mode    │ ↺    │ status    │
├─────┼──────────────────────┼─────────┼──────┼───────────┤
│ 0   │ claimlens-frontend   │ fork    │ 0    │ online    │
└─────┴──────────────────────┴─────────┴──────┴───────────┘
```

```bash
# Test frontend is accessible locally
curl http://localhost:3000
# Expected: HTML response (the Next.js page)
```

---

## Part 7 — Configure Nginx

Nginx acts as the reverse proxy — it receives all public traffic on ports 80/443 and routes it to the appropriate service.

### 7.1 — Create the Nginx configuration

```bash
sudo nano /etc/nginx/sites-available/claimlens
```

Paste this configuration (replace `your-domain.com` with your actual domain):

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # Certbot will modify this block to add HTTPS redirect
    # Do not add SSL config here — Certbot handles it

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ─── SSE ENDPOINT — CRITICAL CONFIGURATION ───────────────────
    # Without these settings, Nginx buffers the SSE stream
    # and alerts never reach the browser
    location /api/plan/alerts/stream {
        proxy_pass http://127.0.0.1:8000/plan/alerts/stream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        chunked_transfer_encoding on;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**The SSE location block is critical.** Without `proxy_buffering off`, Nginx buffers the SSE stream and the real-time alerts never reach the browser. The demo's most important moment depends on this configuration being correct.

### 7.2 — Enable the site

```bash
sudo ln -s /etc/nginx/sites-available/claimlens /etc/nginx/sites-enabled/

# Remove the default site if it exists
sudo rm -f /etc/nginx/sites-enabled/default
```

### 7.3 — Test Nginx configuration

```bash
sudo nginx -t
```

Expected:
```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

**Do not proceed if this fails.** Fix the configuration error first.

### 7.4 — Reload Nginx

```bash
sudo systemctl reload nginx
```

### 7.5 — Test HTTP access

```bash
curl http://your-domain.com/api/health
```

Expected: `{"status":"ok","database":"connected",...}`

---

## Part 8 — Configure HTTPS with Certbot

### 8.1 — Verify DNS is propagated

Before running Certbot, confirm your domain resolves to your server:

```bash
nslookup your-domain.com
# Expected: your server's IP address
```

If it does not resolve correctly yet, wait for DNS propagation and retry.

### 8.2 — Obtain SSL certificate

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

Certbot will ask:
1. Your email address — enter it
2. Agree to terms of service — `A`
3. Whether to redirect HTTP to HTTPS — choose `2` (Redirect)

Expected final output:
```
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/your-domain.com/fullchain.pem
Key is saved at: /etc/letsencrypt/live/your-domain.com/privkey.pem
...
Congratulations! You have successfully enabled HTTPS on https://your-domain.com
```

### 8.3 — Verify auto-renewal is configured

```bash
sudo certbot renew --dry-run
```

Expected: `Congratulations, all simulated renewals succeeded`

Certbot installs a cron job automatically. Certificates renew every 90 days without manual intervention.

### 8.4 — Verify HTTPS is working

```bash
curl https://your-domain.com/api/health
```

Expected: `{"status":"ok","database":"connected",...}`

Open in browser: `https://your-domain.com`

You should see the ClaimLens application with a valid padlock in the browser address bar.

---

## Part 9 — Verify the Full Production Deployment

Run these checks in order. All must pass before using the deployment for a demo.

### 9.1 — Health check

```bash
curl https://your-domain.com/api/health
```
Expected: `{"status":"ok","database":"connected","total_claims":800,"total_flags":344}`

### 9.2 — Frontend loads

```bash
curl -I https://your-domain.com
```
Expected: `HTTP/2 200`

### 9.3 — API docs accessible

Open in browser: `https://your-domain.com/api/docs`
Expected: FastAPI Swagger UI with all endpoints listed

### 9.4 — Physician dashboard loads

Open: `https://your-domain.com/physician`
Expected: Dr. Wilson's summary card with claim counts

### 9.5 — Plan dashboard loads

Open: `https://your-domain.com/plan`
Expected: NPI leaderboard with Dr. Wilson in top 3

### 9.6 — SSE stream works

```bash
# Test SSE endpoint directly
curl -N https://your-domain.com/api/plan/alerts/stream
```

Expected: Streams `data: {...}` events followed by `: keep-alive` every 15 seconds.

**If you see nothing:** Nginx is buffering the SSE response. Check the SSE location block in the Nginx config. Confirm `proxy_buffering off` is present.

### 9.7 — Demo flow test

Run the full 5-minute demo from DEMO_SCRIPT.md on the production URL. Verify:
- [ ] Plan leaderboard loads with Dr. Wilson in top 3
- [ ] NPI detail page loads with correct score breakdown
- [ ] Supplier watchlist shows MedSupply Pro at row 1
- [ ] Physician dashboard loads with unreviewed claims
- [ ] Flag Supplier button works — row grays out
- [ ] Alert appears on plan alerts page within 2 seconds

---

## Part 10 — Maintenance Commands

### View service status

```bash
# Backend
sudo systemctl status claimlens-api

# Frontend
pm2 status

# Nginx
sudo systemctl status nginx

# PostgreSQL
sudo systemctl status postgresql
```

### View logs

```bash
# Backend logs (live)
sudo journalctl -u claimlens-api -f

# Frontend logs (live)
pm2 logs claimlens-frontend

# Nginx access logs
sudo tail -f /var/log/nginx/access.log

# Nginx error logs
sudo tail -f /var/log/nginx/error.log
```

### Restart services

```bash
# Backend
sudo systemctl restart claimlens-api

# Frontend
pm2 restart claimlens-frontend

# Nginx
sudo systemctl reload nginx

# All at once
sudo systemctl restart claimlens-api && \
pm2 restart claimlens-frontend && \
sudo systemctl reload nginx
```

### Deploy code updates

```bash
cd /home/claimlens/claimlens

# Pull latest code
git pull origin main

# Backend: install any new dependencies and restart
cd backend
source venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart claimlens-api

# Frontend: install dependencies, rebuild, restart
cd ../frontend
npm install
npm run build
pm2 restart claimlens-frontend
```

### Demo reset on production

```bash
cd /home/claimlens/claimlens/backend
source venv/bin/activate
python data/demo_reset.py
```

---

## Part 11 — Troubleshooting Production Issues

### HTTPS certificate expired or invalid

```bash
sudo certbot renew
sudo systemctl reload nginx
```

### Backend service not starting

```bash
sudo journalctl -u claimlens-api --since "10 minutes ago"
# Look for Python errors or database connection failures
```

Common causes:
- `.env` file has wrong DATABASE_URL
- PostgreSQL is not running: `sudo systemctl start postgresql`
- Port 8000 already in use: `lsof -i :8000`

### SSE alerts not working on production

```bash
# Verify nginx SSE config
sudo nginx -T | grep -A 10 "alerts/stream"
# Must show: proxy_buffering off

# Test SSE endpoint directly (bypassing Nginx)
curl -N http://localhost:8000/plan/alerts/stream
# Should stream events
```

### Frontend shows API connection errors

```bash
# Check NEXT_PUBLIC_API_URL in frontend/.env.production
cat /home/claimlens/claimlens/frontend/.env.production
# Must be: NEXT_PUBLIC_API_URL=https://your-domain.com/api

# Rebuild frontend after any .env change
cd /home/claimlens/claimlens/frontend
npm run build
pm2 restart claimlens-frontend
```

### Database disk space

```bash
# Check PostgreSQL database size
psql -U claimlens -h localhost -d claimlens_db -c "
SELECT pg_size_pretty(pg_database_size('claimlens_db'));
"

# Check overall disk usage
df -h
```

### Server out of memory

```bash
# Check memory usage
free -h

# Check which processes are using memory
ps aux --sort=-%mem | head -10

# Reduce Uvicorn workers if needed (edit systemd service)
# Change --workers 2 to --workers 1
sudo nano /etc/systemd/system/claimlens-api.service
sudo systemctl daemon-reload
sudo systemctl restart claimlens-api
```

---

## Security Notes for Production Server

These must be done before any demo:

- [ ] Firewall configured — only ports 22, 80, 443 open
- [ ] PostgreSQL not accessible on port 5432 from outside
- [ ] FastAPI port 8000 not accessible directly — only through Nginx
- [ ] `.env` file permissions set to `600` (owner read/write only)
- [ ] HTTPS enforced — HTTP redirects to HTTPS
- [ ] SSH key-based auth only (disable password auth):
  ```bash
  sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' \
      /etc/ssh/sshd_config
  sudo systemctl restart sshd
  ```
- [ ] Automatic security updates enabled:
  ```bash
  sudo apt install unattended-upgrades
  sudo dpkg-reconfigure --priority=low unattended-upgrades
  ```
