export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

export function requireAdmin(request, env) {
  const expected = env.AUTO_AI_ADMIN_KEY;
  const supplied = request.headers.get("x-auto-ai-admin-key") || "";
  return Boolean(expected && supplied && supplied === expected);
}

export function redirect(url, status = 302) {
  return Response.redirect(url, status);
}

export function callbackUrl(request, env) {
  return env.YOUTUBE_REDIRECT_URI || new URL("/api/youtube/callback", request.url).toString();
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function encryptionKey(env) {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is not configured.");
  const raw = base64ToBytes(env.TOKEN_ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array([...iv, ...new Uint8Array(encrypted)]));
}

export async function decryptSecret(value, env) {
  const packed = base64ToBytes(value);
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  const key = await encryptionKey(env);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

export async function ensureYoutubeTables(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS youtube_oauth_states (
    state TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS youtube_connections (
    account_id TEXT PRIMARY KEY,
    channel_id TEXT,
    channel_title TEXT,
    refresh_token_encrypted TEXT NOT NULL,
    connected_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();
}
