export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
}

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function getJwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

export async function verifyGoogleIdToken(
  token: string,
  clientId: string,
): Promise<GoogleProfile | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { kid?: string; alg?: string };
  let payload: { iss?: string; aud?: string | string[]; exp?: number; sub?: string; email?: string; name?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (header.alg !== 'RS256') return null;
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') return null;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud ?? ''];
  if (!audiences.includes(clientId)) return null;
  if (typeof payload.exp !== 'number' || Date.now() / 1000 > payload.exp) return null;
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;

  const keys = await getJwks();
  const key = keys.find((k) => k.kid === header.kid && k.kty === 'RSA' && k.n && k.e);
  if (!key) return null;

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    key,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signature = Buffer.from(signatureB64, 'base64url');
  const data = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, data);
  if (!valid) return null;

  return { sub: payload.sub, email: payload.email ?? '', name: payload.name ?? payload.email ?? 'Player' };
}
