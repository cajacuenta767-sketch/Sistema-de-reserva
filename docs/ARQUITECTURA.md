# Arquitectura

## Por qué PostgreSQL y no algo más simple

La contabilidad de partida doble necesita `NUMERIC` exacto, restricciones
diferidas para comprobar que débito iguala a crédito al cerrar la transacción, y
`SELECT … FOR UPDATE` para asignar consecutivos de factura sin huecos ni
repeticiones. Nada de eso existe en SQLite.

Y sobre todo: **Row Level Security**. Con 20 módulos y varios cientos de
endpoints, la probabilidad de que alguien olvide un `WHERE organization_id` en
algún punto tiende a 1. Con RLS, olvidarlo no filtra datos de otra empresa:
devuelve cero filas.

## Aislamiento entre empresas

Hay dos clases de tabla, y la frontera entre ellas es la decisión de seguridad
más importante del sistema.

**Tablas de negocio.** Llevan `organization_id NOT NULL`, RLS activada y
_forzada_ (`FORCE ROW LEVEL SECURITY`, que aplica la política incluso al dueño de
la tabla). Cada petición abre una transacción con `SET LOCAL
app.organization_id`, y `SET LOCAL` se deshace solo al terminar, de modo que una
conexión devuelta al pool nunca arrastra el tenant de la petición anterior.

**Tablas de frontera** (`users`, `memberships`, `invitations`). Hay que
consultarlas _antes_ de saber en qué empresa está el usuario: al iniciar sesión,
al listar sus empresas, al aceptar una invitación. `users` y `memberships`
llevan una política de doble modo —por organización cuando hay una activa, por
usuario cuando todavía no la hay— y las invitaciones se localizan por el hash de
su token, que es el secreto que demuestra que a esa persona la invitaron.

Esta frontera costó un fallo real: `memberships` quedó exenta de RLS y el
listado de personas devolvía usuarios de otras empresas. La lección es que
"filtrar a mano en cada consulta" no es una defensa, y por eso el arreglo fue
una política de base de datos y no un `WHERE` más.

## Módulos

Un módulo declara qué necesita y qué ofrece:

```ts
defineModule({
  id: 'invoicing',
  dependsOn: ['crm', 'catalog'],
  permissions: [...],
  register(ctx) { /* repos y casos de uso */ return api },
  routes(ctx, api) { /* Router de Express */ },
  subscriptions(ctx, api) { /* reacciones a eventos */ },
})
```

El registro los ordena por dependencias, los construye y monta sus rutas en
bucle. `container.ts` no conoce ningún módulo concreto y por eso no crece.

Dentro, cada módulo respeta la hexagonal:

```
modules/invoicing/
├─ index.ts          API pública: lo ÚNICO importable desde fuera
├─ module.ts         registro
├─ domain/           entidades planas y funciones puras (cálculo de impuestos,
│                    máquinas de estado) — se prueban sin base de datos
├─ application/      puertos y casos de uso; NUNCA importa infraestructura
└─ infrastructure/   repositorios PostgreSQL, rutas HTTP, PDF, trabajos
```

`apps/api/tests/architecture.test.ts` analiza los imports reales y falla si
alguien cruza una de esas fronteras. Se probó primero con
`eslint-plugin-boundaries`, pero su versión 7 no clasificaba estos elementos y
dejaba pasar violaciones evidentes; una regla que no falla cuando debe es peor
que no tenerla.

## Comunicación entre módulos

Por eventos, no por referencias. `invoicing` no conoce `accounting`: publica
`invoice.issued` y `accounting` lo escucha. Eso elimina la mayoría de las
aristas del grafo de dependencias.

El bus tiene dos modos, y la diferencia importa:

- **Transaccional** — el manejador corre dentro de la misma transacción. Es lo
  que garantiza que no exista una factura emitida sin su asiento contable. Se
  reserva para lo que debe ser atómico.
- **Diferido** — el evento se escribe en `outbox_events` en la misma transacción
  y un trabajador lo entrega después, con reintentos. Correos, PDF y webhooks van
  por aquí: que el servidor de correo esté caído no puede impedir facturar.

En los dos casos, el evento y el cambio se guardan juntos o no se guarda nada.

## Permisos

Clave `modulo:recurso:accion`, con alcance `OWN < TEAM < BRANCH < ORG`. El
permiso efectivo es la unión de los roles más las excepciones ALLOW menos las
DENY, y **DENY siempre gana**.

El catálogo no se escribe a mano: cada módulo declara sus permisos y el arranque
los sincroniza con la tabla. Exigir un permiso que no existe revienta al
arrancar, no en silencio.

Se comprueba en tres niveles:

1. **Middleware** — puerta gruesa, rechaza sin tocar la base de datos.
2. **Alcance empujado a la consulta** — `OWN` se traduce a
   `ownerMembershipId = …` _en el SQL_. Listar todo y filtrar en memoria
   funciona con diez filas y filtra datos ajenos con diez mil. Los agregados del
   dashboard usan el mismo filtro, así que nunca muestran cifras que el usuario
   no puede abrir.
3. **Políticas en el caso de uso** — lo que un permiso no puede expresar: una
   factura pagada exige nota de crédito, un periodo cerrado no admite asientos.

## El contrato de listado

Un solo formato para todos los módulos:

```
GET /api/v1/sales/invoices?page=1&pageSize=25&sort=-issue_date&q=acme
    &filter[status]=ISSUED,OVERDUE&filter[issue_date][gte]=2026-01-01
→ { items, total, page, pageSize, aggregates }
```

Los campos que se pueden filtrar y ordenar están declarados en una lista blanca;
un nombre de columna jamás llega del cliente al SQL. Sin eso, `sort` sería una
inyección de manual.

Esa uniformidad es lo que permite que la DataTable del frontend funcione con
cualquier módulo sin adaptadores, y que un módulo nuevo tenga su pantalla de
listado completa en un día.

## Frontend

El mismo patrón: cada módulo aporta su menú, sus rutas, sus widgets del
Escritorio y sus comandos de la paleta ⌘K. `app/features.tsx` es la única lista
que crece.

Toda la identidad visual sale de un número: `--brand-h`. La escala se deriva en
OKLCH, cuya luminancia es perceptualmente uniforme, así que la rampa mantiene el
contraste con cualquier matiz —con HSL, pasar de azul a amarillo destrozaría la
legibilidad—. `organizations.brand_hue` lo hace configurable por empresa, sin
recompilar.

La regla que sostiene el modo oscuro: ningún componente escribe un color crudo.
Solo `bg-surface`, `text-fg-muted`, `border-border`, `bg-accent`. Lo verifica el
lint, porque basta un `bg-white` olvidado para que una pantalla quede ilegible en
oscuro y nadie lo note mirando en claro.
