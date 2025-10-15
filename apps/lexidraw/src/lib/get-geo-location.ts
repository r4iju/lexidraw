import { geolocation } from "@vercel/functions";
import type { ServerRuntime } from "next";

export const runtime: ServerRuntime = "edge";

export function getGeoInfo(request: Request) {
  const { city, country, region } = geolocation(request);
  return { city, country, region };
}
