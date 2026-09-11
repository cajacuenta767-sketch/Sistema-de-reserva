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

// ── CRM ─────────────────────────────────────────────────────────────────────
//
// Se crea una ficha DE VERDAD por la interfaz, no se visita la pantalla vacía:
// un listado sin filas no demuestra que la tabla sepa pintar una.

console.log('2. CRM');
await page.goto(`${WEB}/clientes`, { waitUntil: 'networkidle' });
await shot('10-clientes-vacio');

await page.click('text=Nueva ficha');
await page.waitForSelector('[role=dialog]');
// Acotado al diálogo: fuera hay un buscador cuya etiqueta también dice "correo".
const ficha = page.locator('[role=dialog]');
await ficha.getByLabel('Nombre', { exact: true }).fill('Comercial Los Andes S.A.S.');
await ficha.getByLabel('Razón social').fill('Comercial Los Andes S.A.S.');
await ficha.getByLabel('Número', { exact: true }).fill('890.903.938');
await ficha.getByLabel('Correo', { exact: true }).fill('compras@losandes.co');
await shot('11-cliente-formulario');
await page.click('[role=dialog] button:has-text("Crear")');
await page.waitForURL(/\/clientes\/[0-9a-f-]{36}/, { timeout: 15000 });
await shot('12-cliente-ficha');

// El DV se calcula en el servidor: comprobar que llega a la pantalla verifica
// el camino entero, no solo que la función pura funcione.
const cabecera = await page.textContent('body');
if (!cabecera.includes('890.903.938-8')) {
  throw new Error('la ficha no muestra el NIT con su dígito de verificación');
}
// Nada de valores crudos del enum en pantalla: "COMUN" no es castellano.
if (cabecera.includes('COMUN')) throw new Error('la ficha muestra el régimen sin traducir');

for (const [name, pestana] of [
  ['13-cliente-contactos', 'contactos'],
  ['14-cliente-actividades', 'actividades'],
]) {
  await page.goto(`${page.url().split('?')[0]}?pestana=${pestana}`, { waitUntil: 'networkidle' });
  await shot(name);
}

await page.goto(`${WEB}/clientes`, { waitUntil: 'networkidle' });
await shot('15-clientes-listado');

// ── Catálogo ────────────────────────────────────────────────────────────────

console.log('3. Catálogo');
await page.goto(`${WEB}/productos?nuevo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[role=dialog]');
const formulario = page.locator('[role=dialog]');
await formulario.getByLabel('Nombre', { exact: true }).fill('Gaseosa cola 1.5 L');
await formulario.getByLabel('Precio de venta', { exact: true }).fill('4500');
await formulario.getByLabel('Precio de compra', { exact: true }).fill('3200');
await shot('16-producto-formulario');
await page.click('[role=dialog] button:has-text("Crear")');
await page.waitForURL(/\/productos\/[0-9a-f-]{36}/, { timeout: 15000 });
await shot('17-producto-ficha');

// El margen y el IVA por defecto se calculan en el servidor.
const fichaProducto = await page.textContent('body');
// El margen se escribe en es-CO: coma decimal, como el resto de cifras.
if (!fichaProducto.includes('28,89')) throw new Error('la ficha no muestra el margen en formato es-CO');
if (!fichaProducto.includes('19 %')) throw new Error('la ficha no muestra el IVA por defecto');
if (fichaProducto.includes('AVERAGE')) throw new Error('la ficha muestra el método de costo sin traducir');

await page.goto(`${page.url().split('?')[0]}?pestana=precios`, { waitUntil: 'networkidle' });
await shot('18-producto-precios');

for (const [name, path] of [
  ['19-productos', '/productos'],
  ['20-categorias', '/categorias'],
  ['21-listas-precios', '/listas-de-precios'],
  ['22-impuestos', '/impuestos'],
  ['23-unidades', '/unidades'],
  ['24-importaciones', '/importaciones'],
]) {
  console.log(`→ ${path}`);
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' });
  await shot(name);
}

// Los impuestos colombianos tienen que estar sembrados y legibles: "19 %" y no
// "19.000000", que es como los devuelve la base sin normalizar.
await page.goto(`${WEB}/impuestos`, { waitUntil: 'networkidle' });
const impuestos = await page.textContent('body');
for (const esperado of ['IVA19', 'INC8', 'ReteFuente', '19 %']) {
  if (!impuestos.includes(esperado)) throw new Error(`la pantalla de impuestos no muestra ${esperado}`);
}
if (/\d+\.000000/.test(impuestos)) throw new Error('las tarifas salen sin normalizar (19.000000)');

// ── Ventas ──────────────────────────────────────────────────────────────────
//
// El recorrido completo, por la interfaz: facturar, emitir y cobrar. Lo que se
// comprueba son las cifras que calcula el servidor, no que las pantallas pinten.

console.log('4. Ventas');
await page.goto(`${WEB}/facturas/nueva`, { waitUntil: 'networkidle' });

await page.getByLabel('Cliente', { exact: true }).fill('Comercial');
await page.waitForSelector('button:has-text("Comercial Los Andes")');
await page.click('button:has-text("Comercial Los Andes")');

await page.getByLabel('Concepto o producto').fill('Gaseosa');
await page.waitForSelector('button:has-text("Gaseosa cola")');
await page.click('button:has-text("Gaseosa cola")');
await page.getByLabel('Cantidad').first().fill('10');
await shot('30-factura-borrador');

await page.click('button:has-text("Guardar borrador")');
await page.waitForURL(/\/facturas\/[0-9a-f-]{36}$/, { timeout: 15000 });
await shot('31-factura-ficha');

// 10 × 4.500 = 45.000 de base, IVA 19 % = 8.550, total 53.550. Lo calcula el
// servidor: si la pantalla mostrara otra cosa, este recorrido lo diría.
const factura = await page.textContent('body');
for (const esperado of ['45.000', '8.550', '53.550', 'Borrador']) {
  if (!factura.includes(esperado)) {
    throw new Error(`la ficha de la factura no muestra ${esperado}`);
  }
}

console.log('→ emitir');
await page.click('button:has-text("Emitir")');
await page.waitForSelector('text=/FV-\\d{6}/', { timeout: 15000 });
await shot('32-factura-emitida');

const emitida = await page.textContent('body');
if (!/FV-\d{6}/.test(emitida)) throw new Error('la factura emitida no muestra su consecutivo');
if (!emitida.includes('Emitida')) throw new Error('la factura emitida no aparece como emitida');

console.log('→ cobrar');
await page.click('button:has-text("Registrar cobro")');
await page.waitForSelector('[role=dialog]');
await shot('33-cobro');
await page.click('[role=dialog] button:has-text("Registrar")');
await page.waitForSelector('text=Pagada', { timeout: 15000 });
await shot('34-factura-pagada');

const pagada = await page.textContent('body');
if (!pagada.includes('Pagada')) throw new Error('la factura cobrada no figura como pagada');

for (const [name, path] of [
  ['35-facturas', '/facturas'],
  ['36-cotizaciones', '/cotizaciones'],
  ['37-cobros', '/cobros'],
  ['38-cartera', '/cartera'],
]) {
  console.log(`→ ${path}`);
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' });
  await shot(name);
}

console.log('→ paleta de comandos');
await page.keyboard.press('Control+k');
await shot('25-paleta');
await page.keyboard.press('Escape');

console.log('→ modo oscuro');
await page.evaluate(() => localStorage.setItem('erp.theme', 'dark'));
await page.goto(`${WEB}/productos`, { waitUntil: 'networkidle' });
await shot('26-oscuro-productos');
await page.goto(`${WEB}/clientes`, { waitUntil: 'networkidle' });
await shot('27-oscuro-clientes');
await page.goto(`${WEB}/facturas`, { waitUntil: 'networkidle' });
await shot('39-oscuro-facturas');

console.log('→ móvil 400px');
await page.setViewportSize({ width: 400, height: 780 });
await page.evaluate(() => localStorage.setItem('erp.theme', 'light'));
await page.goto(`${WEB}/productos`, { waitUntil: 'networkidle' });
await shot('28-movil-productos');
await page.goto(`${WEB}/clientes`, { waitUntil: 'networkidle' });
await shot('29-movil-clientes');
await page.goto(`${WEB}/facturas`, { waitUntil: 'networkidle' });
await shot('40-movil-facturas');

console.log(errors.length ? `\n❌ ${errors.length} error(es) de consola:` : '\n✅ Sin errores de consola');
errors.slice(0, 10).forEach((e) => console.log('   ', e.slice(0, 200)));
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
