// Standalone dev entry: `npm run dev --workspace @cipherkeep/server`
import { resolveDataDir } from './config.ts';
import { startServer } from './index.ts';

const dataDir = resolveDataDir();
const s = await startServer({ dataDir, logger: true, port: Number(process.env.PORT ?? 0) });
console.log(`API:   ${s.url}/api/v1\nToken: ${s.token}\nData:  ${dataDir}`);
const stop = () => void s.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
