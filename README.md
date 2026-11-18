# Sikka Fleet – Fleet Management Application

Enterprise fleet management, plant geofencing, and telematics tracking system built for **Sikka LMC**.

## Features

- **Dashboard**: Live plant geofencing monitoring with entry timestamps, distances, and Excel `.xls` export.
- **Plant Management**: Add, configure, and monitor plants with custom circular geofence perimeters.
- **Vehicle Register**: Manage fleet vehicles (Own Fleet, Hired, Rental) with custom driver attributions.
- **GPS Telematics**: WheelsEye integration with 30-minute scheduled sync and dispatch planning.
- **User Management**: Role-based access control (Admin & Plant Operators) with plant-level permissions.
- **MongoDB Atlas Integration**: Cloud MongoDB connection with automatic schema validation and indexes.

---

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS, Lucide Icons
- **Backend**: Node.js, Express 5, Mongoose 9, JWT Authentication
- **Database**: MongoDB Atlas Cloud
- **Telematics**: WheelsEye GPS API

---

## Quick Start

### GPS synchronization

Each scheduled run synchronizes WheelsEye. The GitHub Actions workflow in `.github/workflows/gps-sync.yml` calls the shared GPS sync endpoint every 30 minutes; configure repository Actions secrets `BACKEND_URL` (backend origin, without `/api`) and `CRON_SECRET` (matching the backend environment variable), and enable Actions for the repository. The schedule runs at `:00` and `:30` UTC; these are also `:30` and `:00` IST because IST is UTC+05:30. For an always-on backend, set `GPS_SCHEDULER_MODE=server` to use the in-process scheduler instead. Configure only one scheduler.

Configure WheelsEye with `WHEELSEYE_API_URL` and `WHEELSEYE_API_KEY`. The backend initializes an active WheelsEye setting and keeps saved API credentials encrypted in the database; keep deployment credentials in the host's secret manager or ignored backend `.env`, never in `.env.example`. Vehicle Register status must be Active for new sync processing and current Dashboard/GPS visibility.

Set `GPS_STALE_THRESHOLD_MINUTES=30` and `GPS_REPORT_MAX_GAP_MINUTES=90` in the backend environment to configure the GPS freshness and timeline gap thresholds. Vendor timestamps must include an explicit timezone; all report day boundaries use `Asia/Kolkata`.

GPS persistence uses the MongoDB collections `gpsHistory`, `plantStays`, and `dailyGpsReports`. Mongoose creates their unique indexes from the models when the backend starts. `gpsHistory` is the authoritative input for the dashboard snapshot and fleet report; its unique key is normalized vehicle number + provider + vendor GPS timestamp. Existing reports cannot be reconstructed before trustworthy GPS samples are available. The backfill script rebuilds reports only from this history:

The development seed does not create, replace, or assign plant centers. It requires the three active DASNA, Salt, and Tea Plant records to already exist and preserves their stored addresses, coordinates, and radii.

```powershell
cd backend
node scripts/rebuildDailyGpsReports.js --from=2026-01-01 --to=2026-01-31
```

The GPS cleanup script defaults to preview and may delete legacy manual-source records if run with `--execute`. Do not run that cleanup against production data.

Open zone sessions require a unique index containing both vehicle number and provider. For deployments that already created the old vehicle-only index, run the migration before enabling WheelsEye synchronization:

```powershell
cd backend
node scripts/migrateProviderGpsIndexes.js
```

Run the GPS timeline and sync tests with `npm test` from `backend`. The fleet report uses midpoint interpolation for status transitions, marks intervals beyond the configured maximum GPS gap as `No GPS Data`, and allocates every completed vehicle-day to exactly 24 hours.

WheelsEye GPS locations, timestamps, synchronization history, and geofence results are stored for the fleet. Geofence centers and radii are read from active Plant records.

For temporary telemetry diagnostics, set backend `GPS_RAW_SAMPLE_LOGGING=true`, run one sync, inspect the server logs, then set it back to `false`. It logs only a small sample per provider and redacts secret-like fields.

### 1. Installation
```bash
# Clone the repository
git clone https://github.com/Sikkaindlmc/sikka-fleet.git
cd sikka-fleet

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Environment Setup
Configure `backend/.env` with your MongoDB Atlas connection string:
```env
PORT=5000
JWT_SECRET=your_jwt_secret_key
MONGODB_URI=mongodb+srv://<username>:<password>@sikka-fleet.hubg2m2.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=sikka_fleet
```

For frontend development, create `frontend/.env.local` from `frontend/.env.example`. Set `NEXT_PUBLIC_API_URL` to the backend API base URL, including `/api` (for example, `http://127.0.0.1:5000/api`). For a production build, configure it to the deployed API URL.

### 3. Run the Application
From the project root:
```bash
# Seed a local development database only (destructively overwrites fleet data)
npm run seed -- --allow-seed

# Start backend server (Port 5000)
npm run start:backend

# Start frontend application (Port 3000)
npm run start:frontend
```

---

## Default Access Credentials

- **Administrator**:
  - Username: `ajaysomra`
  - Password: `Somra@2012`
  - Permissions: Full system access (All plants & operations)

---

## License

Proprietary software developed for **Sikka LMC**. All rights reserved.
