# Plan por fases

Cada fase termina con algo demostrable y probado.

| #   | Fase                                                                                                                                                                                                    | Entregable verificable                                                                                                                   | Estado |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 0   | **Cimientos** — monorepo, PostgreSQL con RLS, identidad, RBAC, auditoría, eventos, design system, DataTable, CI                                                                                         | Entrar → elegir empresa → gestionar personas, roles y permisos; sin permiso, 403 y menú oculto; claro/oscuro; un número recolorea la app | ✅     |
| 1   | **CRM y catálogo** — clientes y proveedores unificados, contactos, etiquetas, campos personalizados, adjuntos, actividades, embudos; productos, unidades, impuestos, listas de precios; importación CSV | Importar 500 clientes con mapeo de columnas y abrir una ficha con pestañas                                                               |        |
| 2   | **Ventas** — cotizaciones → facturas → pagos, notas de crédito, PDF, envío por correo, recurrentes                                                                                                      | Cotización → enviar → convertir → pago parcial → saldo y PDF                                                                             |        |
| 3   | **Contabilidad** — PUC colombiano, diarios, asientos, motor de contabilización, años y periodos, balance de prueba, P&G, balance general                                                                | Emitir factura genera asiento; el balance cuadra; cerrar enero bloquea enero; drill-down hasta la factura                                |        |
| 4   | **Compras e inventario** — requisiciones, órdenes, recepciones, facturas de proveedor; bodegas, movimientos, costo promedio                                                                             | OC → recepción → factura → pago; vender descuenta stock y contabiliza el costo                                                           |        |
| 5   | **Proyectos y tiempos** — kanban, subtareas, temporizador, gastos, facturación de horas                                                                                                                 | Registrar 10 h y generar la factura con esas horas como líneas                                                                           |        |
| 6   | **Tickets, calendario y Escritorio** — SLA, calendario con cuatro vistas y recurrencia, los widgets del Escritorio incluido el fichaje                                                                  | El Escritorio muestra datos reales coherentes con los permisos                                                                           |        |
| 7   | **Bancos e informes** — extractos, conciliación con sugerencias, cartera por edades                                                                                                                     | Importar un extracto de 200 líneas y conciliar el 80 %                                                                                   |        |
| 8   | **RRHH y nómina** — empleados, contratos, ausencias, liquidación con seguridad social colombiana                                                                                                        | Liquidar 10 empleados con asiento cuadrado                                                                                               |        |
| 9   | **Facturación electrónica DIAN** — resoluciones, UBL 2.1, CUFE, firma, QR, acuses                                                                                                                       | Factura aceptada en el ambiente de habilitación                                                                                          |        |
| 10  | **Módulos restantes** — suscripciones, activos, reclutamiento, encuestas, referidos, reservas (ReservaFlow migrado), tienda                                                                             | Cada módulo con su listado, ficha y widget                                                                                               |        |
| 11  | **Plataforma** — API pública, webhooks, automatizaciones, portal de cliente, constructor de informes                                                                                                    | Webhook firmado con reintentos; el cliente aprueba una cotización desde el portal                                                        |        |
| 12  | **Diferenciadores** — IA, PWA sin conexión, segundo idioma, Gantt, aprobaciones                                                                                                                         |                                                                                                                                          |        |

## Lo que este sistema hace y el de referencia no

Dos carencias del CRM que sirvió de referencia, y las dos con valor comercial
directo al cubrirlas:

- **No tiene auditoría real.** Aquí cada cambio queda registrado con el detalle
  de qué campo pasó de qué a qué, y la tabla no admite UPDATE ni DELETE.
- **No tiene cierre contable.** Sin cierre, cualquiera puede modificar una
  factura del año pasado y descuadrar un balance ya presentado.

El resto de mejoras, en orden de cuándo se pueden añadir:

**Desde la Fase 0 (no se pueden añadir después sin migrar todo):** multiempresa
con aislamiento en la base de datos, permisos granulares con alcance, vistas
guardadas y filtros en la URL, búsqueda global y paleta ⌘K, modo oscuro, marca
blanca por empresa.

**Más adelante:** conciliación bancaria con sugerencias, firma electrónica de
cotizaciones, portal de cliente y proveedor, API pública con webhooks firmados,
automatizaciones «si pasa X haz Y», flujos de aprobación, informes programados,
presupuesto contra real, Gantt con ruta crítica, 2FA, facturación y nómina
electrónica DIAN, TRM automática del Banco de la República, PWA sin conexión, y
asistencia por IA para resúmenes y categorización de transacciones.
