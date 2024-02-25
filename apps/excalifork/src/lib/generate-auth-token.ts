import env from '@packages/env';

export async function generateAuthToken() {
  const encoder = new TextEncoder();
  const timestamp = new Date().toISOString();
  const data = encoder.encode(`${timestamp}-${env.SHARED_KEY}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${timestamp}:${hashHex}`;
}
