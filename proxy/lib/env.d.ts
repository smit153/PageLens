// Vercel's Edge Runtime is a WebWorker-like environment (see tsconfig's "lib":
// ["ES2022", "WebWorker"]), which has no ambient `process`. Vercel injects a
// minimal `process.env` shim into Edge Functions regardless, so we declare
// just enough of it here rather than pulling in the full @types/node globals.
declare const process: {
  env: Record<string, string | undefined>;
};
