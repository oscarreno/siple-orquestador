# Fase 3.4 — Handoff de implementación para Backend

Fecha: 2026-09-14. Este documento acompaña a
`fase-3-4-fundaciones-transaccionales.md` y no sustituye cambios en
`siple-backTS`.

## Estado del repositorio receptor

La inspección de solo lectura encontró cambios locales que deben preservarse
antes de integrar este bloque:

- `src/clases/Grupos.ts` modificado;
- `src/graphql/resolvers/queryMensajes.ts` modificado;
- `src/graphql/schema/mensajes.schema.graphql` modificado;
- `src/system/database.ts` y `src/system/errorHandling.ts` modificados;
- `pruebas/` y `docs/contratos/` sin seguimiento;
- el validador anterior fue movido de `scripts/` a `pruebas/`.

Por eso 3.4 debe comenzar con una rama/commit de resguardo o con un diff
exportado de esos cambios. No se debe usar `git reset`, `git checkout` ni una
limpieza automática.

## Puntos concretos de integración

### `src/clases/Grupos.ts`

El flujo actual de `guardarGrupo`:

1. normaliza origen, periodo y clave;
2. carga `grupoActual` para derivar auditoría;
3. llama a `guardarGrupoMSSQLAgregado` o
   `guardarGrupoOracleAgregado`;
4. limpia caché y rehidrata después del commit;
5. en Oracle llama después del commit a `Log.guardarBitacora`.

El handler v1 no debe reutilizar esta firma como si ya tuviera revisión e
idempotencia. Debe introducir una ruta separada que reciba el request tipado,
calcule el candidato y ejecute la secuencia transaccional definida en el diseño
3.4. La ruta legacy puede conservarse durante la migración, pero no debe
actualizar la revisión de forma incompatible ni quedar como writer invisible.

### Persistencia Oracle

Antes de escribir el handler se necesita confirmar con el DBA:

- tabla/procedimiento para revisión por grupo y bloqueo de fila;
- tabla/procedimiento para encabezado y detalle de auditoría Oracle;
- tabla/procedimiento para idempotencia y almacenamiento del resultado;
- si los procedimientos `SIPF1_*` participan en la misma transacción y
  revierten todas sus tablas;
- lista completa de writers que pueden modificar el agregado.

No se deben inventar nombres de tablas, columnas ni procedimientos en
producción a partir de los nombres `SIPF1_*` actuales.

### GraphQL

El contrato aprobado ya reserva `aplicarCambiosGrupo`,
`revisionGrupoEsperada`, `revisionGrupoNueva`, `auditoriaId` e
`idempotencyKey`. La mutación no debe publicarse como funcional hasta que el
resolver pueda devolver resultados durables para `APLICADA`, `RECHAZADA` y
`CONFLICTO`. Un schema publicado sin persistencia equivalente crearía una
garantía falsa para Front.

## Secuencia de implementación propuesta

1. Respaldar el estado local de Backend y ejecutar la regresión existente.
2. Corregir o sustituir el wrapper Oracle para adquirir una conexión aislada por
   transacción, hacer `commit`/`rollback` y liberarla en `finally`.
3. Confirmar el mecanismo Oracle con el DBA y documentar DDL/procedimientos.
4. Añadir el repositorio transaccional de revisión, auditoría e idempotencia,
   con una conexión Oracle explícita.
5. Añadir pruebas unitarias/simuladas de fingerprint, replay y conflicto.
6. Integrar el handler v1 sin conectarlo todavía a Front.
7. Añadir pruebas de dos transacciones concurrentes y fallo de cada hijo.
8. Ejecutar TypeScript, `dist`, regresión completa y validación GraphQL.
9. Revisar todos los writers legacy; si alguno no actualiza la revisión, dejar
   Oracle bloqueado y no desplegar.

## Criterio de aceptación del handoff

Este handoff queda listo para que Back implemente, pero la Fase 3.4 no se
considera terminada mientras no existan:

- DDL/procedimientos confirmados;
- código transaccional en `siple-backTS`;
- pruebas de concurrencia, idempotencia, rollback y replay;
- evidencia de que la respuesta puede reconstruirse tras perder el ACK;
- censo cerrado de writers Oracle;
- revisión del diff local existente y ausencia de regresiones.
