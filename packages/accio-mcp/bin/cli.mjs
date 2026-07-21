#!/usr/bin/env node
import { main } from '../src/main.mjs';

main(process.argv.slice(2)).catch((err) => {
  console.error(`[geoly] fatal: ${err?.message || err}`);
  process.exit(1);
});
