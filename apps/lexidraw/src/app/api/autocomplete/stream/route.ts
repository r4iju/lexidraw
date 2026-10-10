/** Retired system-key endpoint. Suggestions use the selected AI power source. */
export async function POST(_request: Request) {
  return new Response(
    "Use the selected AI power source for writing suggestions.",
    { status: 410 },
  );
}
