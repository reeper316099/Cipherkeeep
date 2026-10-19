import { randomBytes } from 'node:crypto';
import { buildApp } from './app.ts';
import { createContext, type Context } from './context.ts';

export * from './config.ts';
export * from './context.ts';
export * from './app.ts';
export { tokenize, parseQuery, SearchIndex } from './search.ts';

export interface RunningServer {
  url: string;
  token: string;
  ctx: Context;
  close(): Promise<void>;
}

/** Start the API on 127.0.0.1 with an ephemeral port and a per-launch bearer token. */
export async function startServer(opts: {
  dataDir: string;
  token?: string;
  port?: number;
  watch?: boolean;
  logger?: boolean;
}): Promise<RunningServer> {
  const token = opts.token ?? randomBytes(32).toString('base64url');
  const ctx = await createContext({ dataDir: opts.dataDir, watch: opts.watch });
  try {
    const app = await buildApp({ ctx, token, logger: opts.logger });
    await app.listen({ host: '127.0.0.1', port: opts.port ?? 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return {
      url: `http://127.0.0.1:${port}`,
      token,
      ctx,
      async close() {
        await app.close();
        await ctx.close();
      },
    };
  } catch (e) {
    await ctx.close();
    throw e;
  }
}
