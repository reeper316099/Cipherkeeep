import os from 'node:os';
import path from 'node:path';
import { APP_NAME, DATA_DIR_ENV } from '@cipherkeep/shared';

export interface DataDirInput {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  home?: string;
  /** Electron's app.getPath('userData'), when available. */
  userData?: string;
}

/** Data directory precedence: CIPHERKEEP_DATA_DIR > Electron userData > OS default. */
export function resolveDataDir(input: DataDirInput = {}): string {
  const env = input.env ?? process.env;
  const override = env[DATA_DIR_ENV];
  if (override) return path.resolve(override);
  if (input.userData) return input.userData;
  const platform = input.platform ?? process.platform;
  const home = input.home ?? os.homedir();
  const j = platform === 'win32' ? path.win32.join : path.posix.join;
  if (platform === 'win32') return j(env.APPDATA ?? j(home, 'AppData', 'Roaming'), APP_NAME);
  if (platform === 'darwin') return j(home, 'Library', 'Application Support', APP_NAME);
  return j(env.XDG_CONFIG_HOME ?? j(home, '.config'), APP_NAME);
}
