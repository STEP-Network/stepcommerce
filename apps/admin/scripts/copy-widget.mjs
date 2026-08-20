// Builds the widget bundle and copies it into public/ so one Vercel deploy
// serves w.js, /api/serve, /api/events and /c/* from the same origin
// (CNAME-friendly: shop.publisherdomain.dk → this app, spec §7).
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const widgetDir = join(here, '..', '..', '..', 'packages', 'widget');
execSync('node build.mjs', { cwd: widgetDir, stdio: 'inherit' });
mkdirSync(join(here, '..', 'public'), { recursive: true });
copyFileSync(join(widgetDir, 'dist', 'w.js'), join(here, '..', 'public', 'w.js'));
console.log('Copied widget bundle to public/w.js');
