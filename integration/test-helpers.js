import { spawnSync } from 'node:child_process';
import path from 'node:path';

export function hasChromiumInstalled(projectRoot) {
  const check = spawnSync(
    'node',
    [
      '-e',
      "const { chromium } = require('playwright'); const fs = require('fs'); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1);",
    ],
    { cwd: projectRoot, timeout: 10_000 }
  );
  return check.status === 0;
}

export function parseResultsDir(projectRoot, stderrText) {
  const ansiRe = new RegExp('\\u001B\\[[0-9;]*m', 'g');
  const stripped = stderrText.replace(ansiRe, '');
  const match = stripped.match(/📂\s+(.+)/);
  return match ? path.resolve(projectRoot, match[1].trim()) : null;
}
