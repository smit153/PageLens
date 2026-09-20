// Local development server for the proxy.
//
// `vercel dev` is the "official" way to run this, but it needs a linked Vercel
// project and, inside a monorepo, resolves the project root to the repo root
// rather than proxy/ (see docs/DEPLOYMENT.md). This runs the exact same
// api/search.ts handler on Node's built-in HTTP server instead: no Vercel
// account, no project linking, no extra dependencies.
//
//   node --env-file=.env.local dev-server.ts
//
// Deliberately outside tsconfig.json's "include" (which covers only api/ and
// lib/): this runs in Node, not Vercel's Edge Runtime, and keeping it out
// stops Node's global types leaking into the Edge-targeted code.

import { createServer } from 'node:http';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// api/ and lib/ import each other with `.js` extensions that point at `.ts`
// files -- the TypeScript ESM convention, and the only form Vercel's function
// builder can follow. It compiles each file to JavaScript separately without
// rewriting specifiers, so a literal `../lib/jev.ts` import survives into the
// emitted `search.js` and dangles there:
//
//     The Edge Function "api/search" is referencing unsupported modules:
//       ../lib/jev.ts, ../lib/sentences.ts, ../lib/rate-limit.ts
//
// Node's resolver is the opposite: it wants the real file on disk and will not
// remap `.js` to `.ts` itself. So this maps them back before the handler graph
// loads, which keeps `pnpm dev:proxy` a plain `node` invocation with no build
// step and no dependencies -- the whole point of this file.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const asTs = new URL(specifier, context.parentURL).href.replace(/\.js$/, '.ts');
      if (existsSync(fileURLToPath(asTs))) return { url: asTs, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

// Imported dynamically, because the hook above has to be registered before
// anything in the handler's module graph is resolved.
const { default: handler } = await import('./api/search.ts');

const PORT = Number(process.env.PORT ?? 3000);
const ROUTE = '/api/search';

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Dev-only visibility into how a real search scored, so a thin result list can
// be traced to chunk quality rather than guessed at.
function logScores(payload) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return;
  }
  if (!parsed?.ok || !Array.isArray(parsed.scores)) return;

  const scores = parsed.scores.map((s) => s.score).sort((a, b) => b - a);
  const above = scores.filter((s) => s >= 1.5).length;
  const spans = parsed.scores.filter((s) => s.span).length;
  const cov = parsed.coverage
    ? `${parsed.coverage.scored}/${parsed.coverage.total} scored`
    : `${scores.length} chunks`;
  console.log(
    `  ${cov} | ${above} >= 1.5 | ${spans} span(s) | top: ${scores
      .slice(0, 5)
      .map((s) => s.toFixed(2))
      .join(', ')}`,
  );
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${PORT}`}`);

  if (url.pathname !== ROUTE) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `No route for ${url.pathname}. Try ${ROUTE}.` }));
    return;
  }

  try {
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: await readBody(req),
    });

    const response = await handler(request);
    const payload = await response.text();
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(payload);
    console.log(`${req.method} ${url.pathname} -> ${response.status}`);
    logScores(payload);
  } catch (error) {
    console.error('Handler threw:', error);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Local dev server error; see terminal.' }));
  }
});

server.listen(PORT, () => {
  console.log(`PageLens proxy listening on http://localhost:${PORT}${ROUTE}`);
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.warn('WARNING: AI_GATEWAY_API_KEY is not set. Run with --env-file=.env.local');
  }
});
