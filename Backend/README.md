# Investment Options Backend

Node/Express API for the Angular Investment Options frontend.

## Setup

1. Create `.env` from `.env.example`.
2. Make sure MySQL is running and the configured user can create databases.
3. Install dependencies:

```bash
npm install
```

4. Start the API:

```bash
npm start
```

The server creates the configured MySQL database and required tables on startup.
The default API URL is `http://localhost:8000/api`.

## API

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/snapshots`
- `POST /api/snapshots`
- `DELETE /api/snapshots/:id`
- `DELETE /api/snapshots`
- `POST /api/snapshots/bulk`

## Database

The same schema is also available in `schema.sql` if you want to create it manually.
