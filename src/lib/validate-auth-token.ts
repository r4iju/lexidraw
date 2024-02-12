import { env } from '~/env.js';

export async function validateAuthToken(authHeader: string | null) {
  if (!authHeader) {
    return false;
  }
  const token = authHeader.replace('Bearer ', '');
  const lastColonIndex = token.lastIndexOf(':');
  const timestamp = token.substring(0, lastColonIndex);
  const signature = token.substring(lastColonIndex + 1);
  const encoder = new TextEncoder();
  const data = encoder.encode(`${timestamp}-${env.SHARED_KEY}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const isValid = hashHex === signature;
  return isValid;
}
