/**
 * worker/scan/enrichment/auth-db-extractor.js — Auth mechanism and DB backend enricher.
 *
 * ESM. Node >=20. No external dependencies — only node:fs, node:path.
 *
 * Implements:
 *   extractAuthAndDb(ctx) — Extract auth mechanism and DB backend from service source files.
 *
 * Writes to:
 *   node_metadata with view='security' (auth data) and view='infra' (db data)
 *   services.auth_mechanism and services.db_backend (denormalized columns via Migration 009)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

// ---------------------------------------------------------------------------
// Traversal guards — excluded directories, depth limit, file size cap
// ---------------------------------------------------------------------------

/** Directories to never descend into during file collection */
export const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'vendor', 'dist', 'build', '__pycache__', '.venv', 'venv', // EXCLUDED_DIRS: canonical list
]);

/** Maximum directory depth to recurse into during file collection */
export const MAX_TRAVERSAL_DEPTH = 8;

/** Maximum file size (in bytes) to read — files larger than this are skipped */
export const MAX_FILE_SIZE = 1_048_576; // 1MB

// ---------------------------------------------------------------------------
// File exclusion — never scan test/example/fixture files
// ---------------------------------------------------------------------------

const EXCLUDED_PATTERNS = [
  /\.test\.[jt]sx?$/i,
  /\.spec\.[jt]sx?$/i,
  /\.test\.py$/i,
  /\.example($|\.)/i,
  /\.sample($|\.)/i,
  /\.fixture($|\.)/i,
];

/**
 * Check if a file path should be excluded from scanning.
 * @param {string} filePath
 * @returns {boolean}
 */
function isExcluded(filePath) {
  return EXCLUDED_PATTERNS.some(p => p.test(filePath));
}

// ---------------------------------------------------------------------------
// Shannon entropy — detect high-entropy strings (secrets, tokens, passwords)
// ---------------------------------------------------------------------------

/**
 * Calculate Shannon entropy in bits per character.
 * @param {string} str
 * @returns {number}
 */
export function shannonEntropy(str) {
  if (!str || str.length === 0) return 0;
  const freq = {};
  for (const ch of str) freq[ch] = (freq[ch] || 0) + 1;
  const len = str.length;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const ENTROPY_REJECT_THRESHOLD = 4.0;   // bits/char — reject above this
const ENTROPY_WARN_THRESHOLD   = 3.5;   // bits/char — log warn between 3.5 and 4.0

// Module-level injectable logger (for near-threshold warn logging)
let _logger = null;

/**
 * Inject a logger for near-threshold entropy warn logging.
 * @param {object|null} logger
 */
export function setExtractorLogger(logger) { _logger = logger; }

// ---------------------------------------------------------------------------
// Credential rejection — reject extracted values that look like actual secrets
// ---------------------------------------------------------------------------

const CREDENTIAL_REJECT = [
  /Bearer\s+[A-Za-z0-9+/=]{20,}/i,
  /eyJ[A-Za-z0-9_-]{20,}/,          // JWT token body
  /:\/\/[^@]+:[^@]+@/,               // URL with password (postgres://user:pass@host)
];

/**
 * Reject extracted values that look like actual secrets (not mechanism labels).
 * @param {string|null} value
 * @returns {boolean} true if value should be rejected
 */
function isCredential(value) {
  if (!value || value.length > 40) return true;  // reject anything >40 chars
  if (CREDENTIAL_REJECT.some(p => p.test(value))) return true;
  const entropy = shannonEntropy(value);
  if (entropy >= ENTROPY_REJECT_THRESHOLD) return true;
  if (entropy >= ENTROPY_WARN_THRESHOLD && _logger) {
    _logger.warn('near-threshold entropy value rejected from storage — review threshold', {
      value_length: value.length,
      entropy: entropy.toFixed(2),
      threshold: ENTROPY_REJECT_THRESHOLD,
    });
  }
  return false;
}

// ---------------------------------------------------------------------------
// Auth signal tables — ordered per language (first match wins, except oauth2+jwt)
// ---------------------------------------------------------------------------

const AUTH_SIGNALS = {
  python: [
    { mechanism: 'jwt',     regex: /(PyJWT|python-jose|jose|fastapi_jwt_auth|jwt\.decode|jwt\.encode)/i },
    { mechanism: 'oauth2',  regex: /(OAuth2|authlib|social_django|django_oauth_toolkit|openid)/i },
    { mechanism: 'session', regex: /(SessionMiddleware|request\.session|flask_login|LOGIN_REQUIRED)/i },
    { mechanism: 'api-key', regex: /(APIKeyHeader|api_key|X-API-Key|api\.key)/i },
  ],
  javascript: [
    { mechanism: 'jwt',     regex: /(jsonwebtoken|jwt\.sign|jwt\.verify|@auth\/core|next-auth|jose)/i },
    { mechanism: 'oauth2',  regex: /(passport\.use|oauth2|openid-client|auth0)/i },
    { mechanism: 'session', regex: /(express-session|cookie-session|req\.session)/i },
    { mechanism: 'api-key', regex: /[Aa]pi[Kk]ey|x-api-key|API_KEY/ },
  ],
  typescript: [
    { mechanism: 'jwt',     regex: /(jsonwebtoken|jwt\.sign|jwt\.verify|@auth\/core|next-auth|jose)/i },
    { mechanism: 'oauth2',  regex: /(passport\.use|oauth2|openid-client|auth0)/i },
    { mechanism: 'session', regex: /(express-session|cookie-session|req\.session)/i },
    { mechanism: 'api-key', regex: /[Aa]pi[Kk]ey|x-api-key|API_KEY/ },
  ],
  go: [
    { mechanism: 'jwt',        regex: /(jwt-go|golang-jwt|dgrijalva\/jwt|lestrrat.*jwx)/i },
    { mechanism: 'oauth2',     regex: /(golang\.org\/x\/oauth2|oauth2\.Config)/i },
    { mechanism: 'middleware', regex: /\.Use\(.*[Aa]uth|middleware\.[Aa]uth/ },
  ],
  rust: [
    { mechanism: 'jwt',        regex: /(jsonwebtoken|jwt_simple|frank_jwt)/i },
    { mechanism: 'oauth2',     regex: /(oauth2::|openidconnect::)/i },
    { mechanism: 'actix-auth', regex: /(actix.web.httpauth|HttpAuthentication)/i },
  ],
};

// ---------------------------------------------------------------------------
// DB signal tables
// ---------------------------------------------------------------------------

/** Source file ORM import signals per language */
const DB_SOURCE_SIGNALS = {
  python: [
    { backend: 'postgresql', regex: /(psycopg2|asyncpg|databases\[.*postgres|postgresql)/i },
    { backend: 'mysql',      regex: /(mysqlclient|aiomysql|mysql\+pymysql)/i },
    { backend: 'sqlite',     regex: /(sqlite3|aiosqlite|SQLite)/i },
    { backend: 'mongodb',    regex: /(pymongo|motor\.|MongoClient)/i },
    { backend: 'redis',      regex: /(redis\.Redis|aioredis|StrictRedis)/i },
  ],
  javascript: [
    { backend: 'postgresql', regex: /(pg\b|postgres\(|@prisma.*postgresql|pgPool)/i },
    { backend: 'mysql',      regex: /(mysql2|@prisma.*mysql|sequelize.*mysql)/i },
    { backend: 'sqlite',     regex: /(better-sqlite3|sqlite3|@prisma.*sqlite)/i },
    { backend: 'mongodb',    regex: /(mongoose|MongoClient|@prisma.*mongodb)/i },
  ],
  typescript: [
    { backend: 'postgresql', regex: /(pg\b|postgres\(|@prisma.*postgresql|pgPool)/i },
    { backend: 'mysql',      regex: /(mysql2|@prisma.*mysql|sequelize.*mysql)/i },
    { backend: 'sqlite',     regex: /(better-sqlite3|sqlite3|@prisma.*sqlite)/i },
    { backend: 'mongodb',    regex: /(mongoose|MongoClient|@prisma.*mongodb)/i },
  ],
  go: [
    { backend: 'postgresql', regex: /(lib\/pq|pgx\.|gorm.*postgres)/i },
    { backend: 'mysql',      regex: /(go-sql-driver\/mysql|gorm.*mysql)/i },
  ],
  rust: [
    { backend: 'postgresql', regex: /(sqlx.*postgres|diesel.*pg|tokio-postgres)/i },
    { backend: 'sqlite',     regex: /(rusqlite|sqlx.*sqlite)/i },
  ],
};

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

/** File extensions to scan per language */
const LANG_EXTENSIONS = {
  python:     ['.py'],
  javascript: ['.js', '.jsx', '.cjs', '.mjs'],
  typescript: ['.ts', '.tsx'],
  go:         ['.go'],
  rust:       ['.rs'],
};

/**
 * Collect source files from a directory recursively with traversal guards.
 * @param {string} dirPath
 * @param {string} language
 * @param {string[]} candidates - Mutated in place
 * @param {number} [depth=0] - Current depth level (stops at MAX_TRAVERSAL_DEPTH)
 */
function collectSourceFiles(dirPath, language, candidates, depth = 0) {
  const exts = LANG_EXTENSIONS[language] ?? [];
  if (exts.length === 0) return;
  let entries;
  try {
    entries = readdirSync(dirPath);
  } catch {
    return;
  }
  for (const entry of entries) {
    // Skip excluded directories without descending
    if (EXCLUDED_DIRS.has(entry)) continue;

    const fullPath = join(dirPath, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isFile() && exts.includes(extname(entry).toLowerCase())) {
      candidates.push(fullPath);
    } else if (stat.isDirectory() && depth < MAX_TRAVERSAL_DEPTH) {
      collectSourceFiles(fullPath, language, candidates, depth + 1);
    }
  }
}

/**
 * Collect files to scan for a service.
 * Walks the full repo directory tree (depth-limited, excluding EXCLUDED_DIRS).
 * Prioritizes entryFile first, caps at 20 total files.
 * @param {string} repoPath
 * @param {string|null} entryFile
 * @param {string} language
 * @returns {string[]}
 */
function collectScanFiles(repoPath, entryFile, language) {
  const candidates = [];
  // Always include entryFile first (gives high confidence)
  if (entryFile) candidates.push(join(repoPath, entryFile));
  // Walk the full repo tree with traversal guards (depth 0 = repoPath level)
  collectSourceFiles(repoPath, language, candidates, 0);
  // Deduplicate, filter excluded file patterns, cap at 20
  return [...new Set(candidates)].filter(f => !isExcluded(f)).slice(0, 20);
}

// ---------------------------------------------------------------------------
// Auth detection
// ---------------------------------------------------------------------------

/**
 * Detect auth mechanism from collected files.
 * @param {string[]} files
 * @param {string|null} entryAbsolute
 * @param {string|null} language
 * @param {object|null} logger
 * @returns {{ mechanism: string|null, confidence: string|null }}
 */
function detectAuth(files, entryAbsolute, language, logger) {
  const lang = language?.toLowerCase() ?? '';
  const signals = AUTH_SIGNALS[lang];
  if (!signals) return { mechanism: null, confidence: null };

  let foundJwt = false;
  let foundOauth2 = false;
  let otherMechanism = null;
  let confidence = null;

  for (const filePath of files) {
    // Skip files larger than MAX_FILE_SIZE
    try {
      if (statSync(filePath).size > MAX_FILE_SIZE) continue;
    } catch {
      continue;
    }

    let content;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const isEntry = entryAbsolute && filePath === entryAbsolute;

    for (const { mechanism, regex } of signals) {
      if (regex.test(content)) {
        const fileConfidence = isEntry ? 'high' : 'low';
        if (mechanism === 'jwt') {
          foundJwt = true;
          if (!confidence || fileConfidence === 'high') confidence = fileConfidence;
        } else if (mechanism === 'oauth2') {
          foundOauth2 = true;
          if (!confidence || fileConfidence === 'high') confidence = fileConfidence;
        } else if (!otherMechanism) {
          otherMechanism = mechanism;
          if (!confidence || fileConfidence === 'high') confidence = fileConfidence;
        }
      }
    }
  }

  let mechanism = null;
  if (foundJwt && foundOauth2) {
    mechanism = 'oauth2+jwt';
  } else if (foundJwt) {
    mechanism = 'jwt';
  } else if (foundOauth2) {
    mechanism = 'oauth2';
  } else if (otherMechanism) {
    mechanism = otherMechanism;
  }

  if (!mechanism) return { mechanism: null, confidence: null };

  // Validate the mechanism label is not a credential
  if (isCredential(mechanism)) return { mechanism: null, confidence: null };

  return { mechanism, confidence };
}

// ---------------------------------------------------------------------------
// DB detection
// ---------------------------------------------------------------------------

/** Normalize prisma provider names to canonical backend names */
const PRISMA_PROVIDER_MAP = {
  postgresql: 'postgresql',
  postgres:   'postgresql',
  mysql:      'mysql',
  sqlite:     'sqlite',
  mongodb:    'mongodb',
  cockroachdb: 'postgresql',
};

/** DATABASE_URL pattern to backend name */
const ENV_DB_PATTERNS = [
  { pattern: /postgres/i, backend: 'postgresql' },
  { pattern: /mysql/i,    backend: 'mysql' },
  { pattern: /sqlite/i,   backend: 'sqlite' },
  { pattern: /mongo/i,    backend: 'mongodb' },
  { pattern: /redis/i,    backend: 'redis' },
];

/**
 * Check schema.prisma in repoPath (up to 2 dirs deep) for datasource provider.
 * @param {string} repoPath
 * @returns {string|null}
 */
function detectDbFromPrisma(repoPath) {
  // Check repoPath itself and one level deep
  const prismaCandidates = [
    join(repoPath, 'schema.prisma'),
    join(repoPath, 'prisma', 'schema.prisma'),
  ];
  for (const prismaPath of prismaCandidates) {
    if (!existsSync(prismaPath)) continue;
    let content;
    try {
      content = readFileSync(prismaPath, 'utf8');
    } catch {
      continue;
    }
    // Match provider = "value" inside datasource db { ... } block
    const datasourceMatch = content.match(/datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/);
    if (datasourceMatch) {
      const provider = datasourceMatch[1].toLowerCase();
      return PRISMA_PROVIDER_MAP[provider] ?? provider;
    }
  }
  return null;
}

/**
 * Check .env and docker-compose.yml for DATABASE_URL.
 * @param {string} repoPath
 * @returns {string|null}
 */
function detectDbFromEnv(repoPath) {
  const envFiles = ['.env', '.env.local', '.env.production', 'docker-compose.yml', 'docker-compose.yaml'];
  for (const envFile of envFiles) {
    const fullPath = join(repoPath, envFile);
    if (!existsSync(fullPath)) continue;
    let content;
    try {
      content = readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }
    // Find DATABASE_URL = ... line
    const match = content.match(/DATABASE_URL\s*=\s*(.+)/i);
    if (match) {
      const urlValue = match[1].trim();
      for (const { pattern, backend } of ENV_DB_PATTERNS) {
        if (pattern.test(urlValue)) return backend;
      }
    }
  }
  return null;
}

/**
 * Check source files for ORM import signals.
 * @param {string[]} files
 * @param {string|null} language
 * @returns {string|null}
 */
function detectDbFromSources(files, language) {
  const lang = language?.toLowerCase() ?? '';
  const signals = DB_SOURCE_SIGNALS[lang];
  if (!signals) return null;

  for (const filePath of files) {
    // Skip files larger than MAX_FILE_SIZE
    try {
      if (statSync(filePath).size > MAX_FILE_SIZE) continue;
    } catch {
      continue;
    }

    let content;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    for (const { backend, regex } of signals) {
      if (regex.test(content)) return backend;
    }
  }
  return null;
}

/**
 * Detect DB backend for a service using probe order: prisma > env > source files.
 * @param {string} repoPath
 * @param {string[]} files
 * @param {string|null} language
 * @param {object|null} logger
 * @returns {string|null}
 */
function detectDb(repoPath, files, language, logger) {
  return detectDbFromPrisma(repoPath)
    ?? detectDbFromEnv(repoPath)
    ?? detectDbFromSources(files, language);
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Extract auth mechanism and DB backend from service source files.
 *
 * ctx.db is a raw better-sqlite3 Database instance (not QueryEngine).
 * Writes directly via prepared statements.
 *
 * @param {object} ctx - Enricher context from enrichment.js runner
 * @param {number} ctx.serviceId
 * @param {string} ctx.repoPath
 * @param {string|null} ctx.language
 * @param {string|null} ctx.entryFile
 * @param {import('better-sqlite3').Database} ctx.db
 * @param {object|null} ctx.logger
 * @returns {Promise<{ auth_mechanism: string|null, auth_confidence: string|null, db_backend: string|null }>}
 */
export async function extractAuthAndDb(ctx) {
  const { serviceId, repoPath, language, entryFile, db, logger } = ctx;
  const files = collectScanFiles(repoPath, entryFile, language);
  const entryAbsolute = entryFile ? join(repoPath, entryFile) : null;

  // Auth detection
  const { mechanism, confidence } = detectAuth(files, entryAbsolute, language, logger);

  // DB detection
  const dbBackend = detectDb(repoPath, files, language, logger);

  // Write to node_metadata (view='security' for auth, view='infra' for db)
  const upsertMeta = db.prepare(
    `INSERT OR REPLACE INTO node_metadata (service_id, view, key, value, source, updated_at)
     VALUES (?, ?, ?, ?, 'auth-db-extractor', datetime('now'))`
  );

  if (mechanism) {
    upsertMeta.run(serviceId, 'security', 'auth_mechanism', mechanism);
    upsertMeta.run(serviceId, 'security', 'auth_confidence', confidence);
  }
  if (dbBackend) {
    upsertMeta.run(serviceId, 'infra', 'db_backend', dbBackend);
  }

  // Denormalize to services columns for fast graph query (Migration 009)
  try {
    db.prepare('UPDATE services SET auth_mechanism = ?, db_backend = ? WHERE id = ?')
      .run(mechanism ?? null, dbBackend ?? null, serviceId);
  } catch (err) {
    logger?.warn?.(`auth-db-extractor: services column update failed: ${err.message}`);
  }

  return { auth_mechanism: mechanism, auth_confidence: confidence, db_backend: dbBackend };
}
