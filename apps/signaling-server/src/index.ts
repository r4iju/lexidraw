// @ts-expect-error fine for now
import { startServer } from "./server.ts";

startServer(8080, { secret: process.env.SIGNALING_SECRET });
