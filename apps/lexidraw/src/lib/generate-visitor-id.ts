type Props = {
  userAgent: string;
  country: string;
  city: string;
  region: string;
};

export async function generateVisitorId({
  userAgent,
  country,
  city,
  region,
}: Props) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${userAgent}-${country}-${city}-${region}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
}
