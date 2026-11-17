# Bugema University Campus Lost & Found

The application uses a Node.js API between the static frontend and MongoDB. The browser never connects directly to MongoDB.

## Database

The server connects to the existing `CampusLostFound` database with:

```text
mongodb://localhost:27017/CampusLostFound
```

It uses the existing `students`, `lostItems`, `foundItems`, and `claims` collections. At startup it verifies that all four collections exist and exits with an error if one is missing. It does not seed demo data or create collections.

New registrations are stored with a scrypt-hashed password. Legacy plain-text passwords already in the `students` collection are accepted once and upgraded to hashes after successful login.

Notifications remain browser-local because the existing database schema does not include a notifications collection.

## Run locally

1. Make sure MongoDB is running and the four existing collections are present in `CampusLostFound`.
2. From this folder, install the Node.js dependencies:

   ```powershell
   npm install
   ```

3. Optionally copy `.env.example` to `.env` and set `MONGODB_URI`, `PORT`, and a strong `SESSION_SECRET`.
4. Start the app:

   ```powershell
   npm start
   ```

5. Open `http://localhost:3000`.

The server defaults to `mongodb://localhost:27017/CampusLostFound`. Set a different `MONGODB_URI` in `.env` if needed. Do not put database credentials in frontend files or commit `.env`.

## API

- `GET /api/health` — database connectivity
- `GET /api/state` — public item lists and session-scoped data
- `POST /api/auth/login` and `POST /api/auth/logout`
- `POST /api/students` — student registration
- `GET /api/students` — administrator only
- `/api/lost-items`, `/api/found-items` — item reporting and administration
- `/api/claims` — claim submission and administrator decisions

The API uses cookie sessions. Local development uses the default in-memory session store; production uses MongoDB-backed sessions and requires the `sessions` collection. HTTPS is required in production.

## Deploy publicly with GitHub and Render

The GitHub Pages site can host only the static frontend; it cannot run this API or connect to MongoDB. The repository includes a Render Blueprint (`render.yaml`) to deploy the Node.js app as a public web service. Render hosts the API and frontend together; MongoDB Atlas hosts the database.

1. Create a MongoDB Atlas cluster and a database user with read/write access to the `CampusLostFound` database.
2. Create these empty collections in that database: `students`, `lostItems`, `foundItems`, `claims`, and `sessions`. Production startup checks for them and does not create collections or copy local records. Add a TTL index to `sessions.expires` with `expireAfterSeconds: 0` so expired sessions are removed.
3. In Atlas Network Access, allow the outbound IP addresses shown for your Render service. Avoid opening database access to all IP addresses.
4. In Render, create a Blueprint from this GitHub repository and set `MONGODB_URI` to the Atlas connection string for `CampusLostFound`. Keep the credentials in Render's environment settings; do not commit them.
5. Render generates `SESSION_SECRET` and sets `NODE_ENV=production` from `render.yaml`. After deployment, open the Render service URL and check `/api/health`.

The first account registered has the `student` role. To enable administration on a fresh database, promote the intended administrator's student document to `role: "admin"` in Atlas. The free Render service may sleep when idle and take a short time to wake.
