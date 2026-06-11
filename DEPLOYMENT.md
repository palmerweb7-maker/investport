# Deployment Guide

This project is split into:

- `Frontend`: Angular app for Netlify.
- `Backend`: Node/Express API for Render.
- Aiven: MySQL database.

## 1. Aiven MySQL

1. Create an Aiven MySQL service.
2. Create or use a database named `investment_options`.
3. Copy these connection values from Aiven:
   - host
   - port
   - user
   - password
   - database
   - CA certificate

The backend creates all application tables on startup. On Aiven, set `MYSQL_CREATE_DATABASE=false` because the database should already exist.

## 2. Render Backend

Create a new Render Web Service using `Inestment Options/Backend` as the root directory.

You can also use the blueprint at `Inestment Options/render.yaml` if your Render setup reads from the project root.

Use:

```bash
npm install
```

as the build command, and:

```bash
npm start
```

as the start command.

Set these Render environment variables:

```text
NODE_ENV=production
PORT=8000
MYSQL_HOST=<Aiven host>
MYSQL_PORT=<Aiven port>
MYSQL_USER=<Aiven user>
MYSQL_PASSWORD=<Aiven password>
MYSQL_DATABASE=investment_options
MYSQL_CREATE_DATABASE=false
MYSQL_SSL_CA=<Aiven CA certificate text, with \n line breaks>
JWT_SECRET=<long random secret>
CORS_ORIGINS=https://YOUR-NETLIFY-SITE.netlify.app
```

After deployment, confirm:

```text
https://YOUR-RENDER-SERVICE.onrender.com/api/
```

returns a JSON status response.

## 3. Netlify Frontend

Create a Netlify site using `Inestment Options/Frontend` as the base directory.

You can also point Netlify at `Inestment Options`; the root `netlify.toml` sets `Frontend` as the build base.

Use:

```bash
npm run build:netlify
```

as the build command, and:

```text
dist/Frontend/browser
```

as the publish directory.

Before deploying, update `Frontend/netlify.toml`:

```toml
to = "https://YOUR-RENDER-SERVICE.onrender.com/api/:splat"
```

Replace `YOUR-RENDER-SERVICE` with the actual Render service URL.

If Netlify reads the root `netlify.toml`, update that file too.

Optional: instead of relying on the Netlify `/api` redirect, set this Netlify environment variable:

```text
INVESTMENT_API_URL=https://YOUR-RENDER-SERVICE.onrender.com/api
```

The Netlify build writes this into `public/runtime-config.js` before building. Angular also has standard environment files at:

- `Frontend/src/environments/environment.ts`
- `Frontend/src/environments/environment.prod.ts`

## 4. Final URL Wiring

After Netlify gives you the final site URL:

1. Add it to Render's `CORS_ORIGINS`.
2. Redeploy Render.
3. Confirm Netlify can create an account and save a monthly snapshot.

## Local Development

Run the backend:

```bash
cd "Inestment Options/Backend"
npm run dev
```

Run the frontend:

```bash
cd "Inestment Options/Frontend"
npm start
```

Angular proxies `/api` to `http://127.0.0.1:8000` using `proxy.conf.json`.
