/**
 * Recorrido de humo con navegador real.
 *
 * No sustituye a los tests, pero atrapa lo que ningún test unitario ve: errores
 * de consola, HTML inválido, contraste roto en modo oscuro y diseños que se
 * desmontan a 400 px. Requiere la API en :4000 y la web en :5173.
 *
 *   node scripts/walkthrough.mjs
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const OUT = process.env.SHOTS_DIR ?? '/tmp/claude-0/shots';
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CO' });
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const shot = async (name) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  📸 ${name}`);
};

const suffix = Date.now().toString(36).slice(-5);
const email = `ana.${suffix}@andina.co`;

console.log('1. Registro');
await page.goto(`${WEB}/registro`, { waitUntil: 'networkidle' });
await shot('01-registro');
await page.fill('input[autocomplete="email"]', email);
await page.locator('form input').first().fill('Ana');
await page.locator('form input').nth(1).fill('Restrepo');
await page.fill('input[autocomplete="new-password"]', 'Andina2026!');
await page.locator('form input').last().fill('Distribuidora Andina SAS');
await page.click('button[type=submit]');
try {
  await page.waitForURL(`${WEB}/`, { timeout: 15000 });
} catch {
  const alert = await page.locator('[role=alert]').first().textContent().catch(() => null);
  console.log('  ⚠️  registro falló:', alert ?? '(sin mensaje)');
  await shot('01b-registro-error');
  throw new Error('registro falló');
}

for (const [name, path] of [
  ['02-escritorio', '/'],
  ['03-personas', '/personas'],
  ['04-roles', '/roles'],
  ['05-auditoria', '/auditoria'],
  ['06-empresa', '/empresa'],
]) {
  console.log(`→ ${path}`);
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' });
  await shot(name);
}

console.log('→ paleta de comandos');
await page.keyboard.press('Control+k');
await shot('07-paleta');
await page.keyboard.press('Escape');

console.log('→ modo oscuro');
await page.evaluate(() => localStorage.setItem('erp.theme', 'dark'));
await page.goto(`${WEB}/personas`, { waitUntil: 'networkidle' });
await shot('08-oscuro');

console.log('→ móvil 400px');
await page.setViewportSize({ width: 400, height: 780 });
await page.evaluate(() => localStorage.setItem('erp.theme', 'light'));
await page.reload({ waitUntil: 'networkidle' });
await shot('09-movil');

console.log(errors.length ? `\n❌ ${errors.length} error(es) de consola:` : '\n✅ Sin errores de consola');
errors.slice(0, 10).forEach((e) => console.log('   ', e.slice(0, 200)));
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
