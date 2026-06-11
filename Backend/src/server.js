require("dotenv").config();

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");

const app = express();
const PORT = Number(process.env.PORT || 8000);
const JWT_EXPIRES_IN = "7d";

let pool;

function requiredEnv(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function mysqlConfig(includeDatabase = true) {
  const config = {
    host: requiredEnv("MYSQL_HOST", "127.0.0.1"),
    port: Number(requiredEnv("MYSQL_PORT", "3306")),
    user: requiredEnv("MYSQL_USER", "root"),
    password: requiredEnv("MYSQL_PASSWORD", ""),
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    decimalNumbers: true,
    charset: "utf8mb4",
  };

  if (process.env.MYSQL_SSL_CA) {
    config.ssl = {
      ca: process.env.MYSQL_SSL_CA.replace(/\\n/g, "\n"),
      rejectUnauthorized: true,
    };
  } else if (process.env.MYSQL_SSL === "true") {
    config.ssl = {
      rejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== "false",
    };
  }

  if (includeDatabase) {
    config.database = requiredEnv("MYSQL_DATABASE", "investment_options");
  }

  return config;
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, "``")}\``;
}

function jwtSecret() {
  return requiredEnv("JWT_SECRET", "change-me-in-production");
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (Array.isArray(value) || typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeAsset(asset = {}) {
  return {
    type: asset.type || "Other",
    name: asset.name || "",
    contribution: toNumber(asset.contribution),
    unitPrice: toNumber(asset.unitPrice),
    units: toNumber(asset.units),
    currentPrice: toNumber(asset.currentPrice),
    fixedValue: toNumber(asset.fixedValue),
    income: toNumber(asset.income),
    fees: toNumber(asset.fees),
    realized: toNumber(asset.realized),
    value: toNumber(asset.value),
    ...asset,
  };
}

function normalizeSnapshot(input = {}) {
  return {
    month: String(input.month || "").slice(0, 7),
    invested: toNumber(input.invested),
    value: toNumber(input.value),
    income: toNumber(input.income),
    fees: toNumber(input.fees),
    realized: toNumber(input.realized),
    inflation: toNumber(input.inflation),
    notes: input.notes || "",
    assets: Array.isArray(input.assets) ? input.assets.map(normalizeAsset) : [],
  };
}

function snapshotResponse(row) {
  return {
    id: row.id,
    month: row.month,
    invested: toNumber(row.invested),
    value: toNumber(row.value),
    income: toNumber(row.income),
    fees: toNumber(row.fees),
    realized: toNumber(row.realized),
    inflation: toNumber(row.inflation),
    notes: row.notes || "",
    assets: parseJson(row.assets, []),
  };
}

function settingsResponse(row) {
  return {
    currency: row?.currency || "JMD",
    darkMode: Boolean(row?.dark_mode),
    landGoal: toNumber(row?.land_goal, 6000000),
    landSavings: toNumber(row?.land_savings),
    assets: parseJson(row?.assets, []),
  };
}

function createToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, type: "access" },
    jwtSecret(),
    { expiresIn: JWT_EXPIRES_IN },
  );
}

function authUser(row) {
  return { id: row.id, email: row.email, name: row.name || "" };
}

async function ensureDatabase() {
  if (process.env.MYSQL_CREATE_DATABASE === "false") return;

  const database = requiredEnv("MYSQL_DATABASE", "investment_options");
  const bootstrap = await mysql.createConnection(mysqlConfig(false));
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await bootstrap.end();
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      user_id CHAR(36) PRIMARY KEY,
      currency VARCHAR(16) NOT NULL DEFAULT 'JMD',
      dark_mode BOOLEAN NOT NULL DEFAULT FALSE,
      land_goal DECIMAL(18,2) NOT NULL DEFAULT 6000000,
      land_savings DECIMAL(18,2) NOT NULL DEFAULT 0,
      assets JSON NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_settings_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      month VARCHAR(7) NOT NULL,
      invested DECIMAL(18,2) NOT NULL DEFAULT 0,
      value DECIMAL(18,2) NOT NULL DEFAULT 0,
      income DECIMAL(18,2) NOT NULL DEFAULT 0,
      fees DECIMAL(18,2) NOT NULL DEFAULT 0,
      realized DECIMAL(18,2) NOT NULL DEFAULT 0,
      inflation DECIMAL(8,4) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      assets JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_snapshots_user_month (user_id, month),
      INDEX idx_snapshots_user_month (user_id, month),
      CONSTRAINT fk_snapshots_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function defaultSettings(userId) {
  await pool.query(
    `
    INSERT IGNORE INTO settings
      (user_id, currency, dark_mode, land_goal, land_savings, assets)
    VALUES
      (:userId, 'JMD', FALSE, 6000000, 0, JSON_ARRAY())
    `,
    { userId },
  );
}

async function requireAuth(req, res, next) {
  const header = req.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ detail: "Not authenticated" });
  }

  try {
    const payload = jwt.verify(header.slice(7), jwtSecret());
    if (payload.type !== "access") {
      return res.status(401).json({ detail: "Invalid token type" });
    }

    const [rows] = await pool.query(
      "SELECT id, email, name FROM users WHERE id = :id",
      { id: payload.sub },
    );
    if (!rows.length) {
      return res.status(401).json({ detail: "User not found" });
    }

    req.user = rows[0];
    return next();
  } catch {
    return res.status(401).json({ detail: "Invalid or expired token" });
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

const corsOrigins = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (corsOrigins.includes("*") || corsOrigins.includes(origin)) return true;

  try {
    const { hostname, protocol } = new URL(origin);
    const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
    return isLocalHost && (protocol === "http:" || protocol === "https:");
  } catch {
    return false;
  }
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Not allowed by CORS"));
  },
}));
app.use(express.json({ limit: "2mb" }));

app.get("/api/", (_req, res) => {
  res.json({ message: "Investment Options API", status: "ok", database: "mysql" });
});

app.post("/api/auth/signup", asyncRoute(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const name = String(req.body.name || email.split("@")[0] || "Investor").trim();

  if (!email || !email.includes("@")) {
    return res.status(400).json({ detail: "A valid email is required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ detail: "Password must be at least 6 characters" });
  }

  const [existing] = await pool.query("SELECT id FROM users WHERE email = :email", { email });
  if (existing.length) {
    return res.status(400).json({ detail: "Email already registered" });
  }

  const user = { id: crypto.randomUUID(), email, name };
  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    `
    INSERT INTO users (id, email, name, password_hash)
    VALUES (:id, :email, :name, :passwordHash)
    `,
    { ...user, passwordHash },
  );
  await defaultSettings(user.id);

  res.json({ token: createToken(user), user });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const [rows] = await pool.query(
    "SELECT id, email, name, password_hash FROM users WHERE email = :email",
    { email },
  );
  const row = rows[0];

  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    return res.status(401).json({ detail: "Invalid email or password" });
  }

  const user = authUser(row);
  res.json({ token: createToken(user), user });
}));

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json(authUser(req.user));
});

app.get("/api/settings", requireAuth, asyncRoute(async (req, res) => {
  await defaultSettings(req.user.id);
  const [rows] = await pool.query(
    "SELECT * FROM settings WHERE user_id = :userId",
    { userId: req.user.id },
  );
  res.json(settingsResponse(rows[0]));
}));

app.put("/api/settings", requireAuth, asyncRoute(async (req, res) => {
  const payload = {
    userId: req.user.id,
    currency: req.body.currency || "JMD",
    darkMode: Boolean(req.body.darkMode),
    landGoal: toNumber(req.body.landGoal, 6000000),
    landSavings: toNumber(req.body.landSavings),
    assets: JSON.stringify(Array.isArray(req.body.assets) ? req.body.assets : []),
  };

  await pool.query(
    `
    INSERT INTO settings
      (user_id, currency, dark_mode, land_goal, land_savings, assets)
    VALUES
      (:userId, :currency, :darkMode, :landGoal, :landSavings, :assets)
    ON DUPLICATE KEY UPDATE
      currency = VALUES(currency),
      dark_mode = VALUES(dark_mode),
      land_goal = VALUES(land_goal),
      land_savings = VALUES(land_savings),
      assets = VALUES(assets)
    `,
    payload,
  );

  const [rows] = await pool.query(
    "SELECT * FROM settings WHERE user_id = :userId",
    { userId: req.user.id },
  );
  res.json(settingsResponse(rows[0]));
}));

app.get("/api/snapshots", requireAuth, asyncRoute(async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM snapshots WHERE user_id = :userId ORDER BY month ASC",
    { userId: req.user.id },
  );
  res.json(rows.map(snapshotResponse));
}));

app.post("/api/snapshots", requireAuth, asyncRoute(async (req, res) => {
  const snapshot = normalizeSnapshot(req.body);
  if (!/^\d{4}-\d{2}$/.test(snapshot.month)) {
    return res.status(400).json({ detail: "month must be in YYYY-MM format" });
  }

  const [existing] = await pool.query(
    "SELECT id FROM snapshots WHERE user_id = :userId AND month = :month",
    { userId: req.user.id, month: snapshot.month },
  );
  const id = existing[0]?.id || crypto.randomUUID();

  await pool.query(
    `
    INSERT INTO snapshots
      (id, user_id, month, invested, value, income, fees, realized, inflation, notes, assets)
    VALUES
      (:id, :userId, :month, :invested, :value, :income, :fees, :realized, :inflation, :notes, :assets)
    ON DUPLICATE KEY UPDATE
      invested = VALUES(invested),
      value = VALUES(value),
      income = VALUES(income),
      fees = VALUES(fees),
      realized = VALUES(realized),
      inflation = VALUES(inflation),
      notes = VALUES(notes),
      assets = VALUES(assets)
    `,
    {
      id,
      userId: req.user.id,
      ...snapshot,
      assets: JSON.stringify(snapshot.assets),
    },
  );

  const [rows] = await pool.query(
    "SELECT * FROM snapshots WHERE id = :id AND user_id = :userId",
    { id, userId: req.user.id },
  );
  res.json(snapshotResponse(rows[0]));
}));

app.delete("/api/snapshots/:id", requireAuth, asyncRoute(async (req, res) => {
  const [result] = await pool.query(
    "DELETE FROM snapshots WHERE id = :id AND user_id = :userId",
    { id: req.params.id, userId: req.user.id },
  );
  if (!result.affectedRows) {
    return res.status(404).json({ detail: "Snapshot not found" });
  }
  res.json({ ok: true });
}));

app.delete("/api/snapshots", requireAuth, asyncRoute(async (req, res) => {
  const [result] = await pool.query(
    "DELETE FROM snapshots WHERE user_id = :userId",
    { userId: req.user.id },
  );
  res.json({ ok: true, deleted: result.affectedRows });
}));

app.post("/api/snapshots/bulk", requireAuth, asyncRoute(async (req, res) => {
  const items = Array.isArray(req.body.snapshots) ? req.body.snapshots : [];
  let inserted = 0;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "DELETE FROM snapshots WHERE user_id = :userId",
      { userId: req.user.id },
    );

    for (const raw of items) {
      const snapshot = normalizeSnapshot(raw);
      if (!/^\d{4}-\d{2}$/.test(snapshot.month)) continue;

      await connection.query(
        `
        INSERT INTO snapshots
          (id, user_id, month, invested, value, income, fees, realized, inflation, notes, assets)
        VALUES
          (:id, :userId, :month, :invested, :value, :income, :fees, :realized, :inflation, :notes, :assets)
        `,
        {
          id: crypto.randomUUID(),
          userId: req.user.id,
          ...snapshot,
          assets: JSON.stringify(snapshot.assets),
        },
      );
      inserted += 1;
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  res.json({ ok: true, inserted });
}));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ detail: "Internal server error" });
});

async function start() {
  await ensureDatabase();
  pool = mysql.createPool(mysqlConfig(true));
  await ensureSchema();
  app.listen(PORT, () => {
    console.log(`Investment Options API running on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start Investment Options API");
  console.error(error);
  process.exit(1);
});
