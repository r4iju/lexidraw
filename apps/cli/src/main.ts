#!/usr/bin/env bun
import { run } from "./cli";
import { realIo } from "./context";

process.exitCode = await run(Bun.argv.slice(2), realIo());
