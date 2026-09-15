# Fase 3.4 — Cierre de preparación antes de modificar Backend

Fecha: 2026-09-14. Estado: preparación completada; no se modificó código en
`siple-backTS`.

## Evidencia inspeccionada

Repositorio Backend: `master`, con cambios locales existentes en:

- `package.json`;
- `src/clases/Grupos.ts`;
- `src/graphql/resolvers/queryMensajes.ts`;
- `src/graphql/schema/mensajes.schema.graphql`;
- `src/system/database.ts`;
- `src/system/errorHandling.ts`;
- `pruebas/` y `docs/contratos/` sin seguimiento;
- `scripts/validate-guardarGrupo.ts` eliminado y el validador actual ubicado en
  `pruebas/`.

No se debe limpiar, revertir ni sobrescribir ese estado.

## Línea base verificada antes de modificar

Sobre el estado local actual de Backend se ejecutó, sin conexión a una base de
datos real:

- `cmd /c npm run validar:todas`: **OK**;
- `node node_modules/typescript/bin/tsc --noEmit`: **OK**;
- `git diff --check`: **OK**, con avisos normales de normalización LF/CRLF.

La suite simulada confirma rollback Oracle, rechazo de bitácora pública y
auditoría calculada por Backend. Esta línea base no demuestra todavía
concurrencia real, aislamiento de conexiones, DDL Oracle ni reversibilidad de
procedimientos productivos.

## Hallazgos que afectan la implementación

1. `Mutation.guardarGrupo` sigue aceptando `GrupoInput` completo y
   `cambiosBitacora`; no existe todavía el handler v1
   `aplicarCambiosGrupo` en el schema productivo.
2. La rama Oracle ejecuta `SIPF1_ALTAGRUPO2`, `SIPF1_ALTAHORARIO`,
   `SIPF1_ALTAMENSAJE` y `SIPF1_ALTAGMAP22` dentro de `withTransaction`, pero
   llama a `Log.guardarBitacora` después del commit y esa bitácora se guarda en
   MSSQL.
3. Los métodos legacy `guardarEncabezadoGrupoDBO`,
   `guardarHorarioGrupoDBO`, `guardarMensajeGrupoDBO` y
   `guardarPlanCompartidoDBO` usan operaciones Oracle independientes mediante
   `ejecuta`; no participan en la transacción del agregado.
4. `revisarGrupoPlaneacion` modifica `GrupoRevisado` en MSSQL y audita después
   del commit; no actualiza una revisión Oracle compartida.
5. `actualizarFechaModificacionGrupo` es un efecto MSSQL posterior al commit
   Oracle y actualmente absorbe su propio fallo en el agregado.
6. El wrapper Oracle crea un pool pero conserva una sola conexión global en
   `this.conn`; `withTransaction` no adquiere/libera una conexión por request.
   Esto es un bloqueo previo para probar concurrencia real.
7. No se encontraron migraciones, DDL ni procedimientos versionados para
   revisión, auditoría Oracle, idempotencia u outbox. Los nombres y columnas
   deben confirmarse con DBA; no deben inventarse en el código.

## Matriz de writers que debe cerrarse

| Writer | Origen | Estado frente a revisión v1 | Acción antes de habilitar |
| --- | --- | --- | --- |
| `guardarGrupoOracleAgregado` | Oracle | No actualiza revisión ni auditoría Oracle nativa | Migrar a repositorio transaccional v1. |
| `guardarEncabezadoGrupoDBO` | Oracle | Escritura independiente | Envolver, bloquear o retirar del alcance antes de v1. |
| `guardarHorarioGrupoDBO` | Oracle | Escritura independiente | Igualar revisión o bloquear ruta. |
| `guardarMensajeGrupoDBO` | Oracle | Escritura independiente | Igualar revisión o bloquear ruta. |
| `guardarPlanCompartidoDBO` | Oracle | Escritura independiente | Igualar revisión o bloquear ruta. |
| `revisarGrupoPlaneacion` | MSSQL | No aplica a revisión Oracle, pero cambia estado visible | Definir si es otro agregado/origen; no ignorarlo en el censo. |
| `guardarGrupoMSSQLAgregado` | MSSQL | Tiene transacción propia; sin revisión/idempotencia v1 | Tratar en su vertical/origen, no mezclar con Oracle. |
| `guardarPlanCompartidoMSSQL` | MSSQL | Escritura independiente | Incluir en censo MSSQL antes de habilitar ese origen. |
| procesos/procedimientos externos | Oracle/MSSQL | No censados desde el repositorio | Confirmar con DBA y operación; si no participan, bloquear origen. |

La tabla no prueba que sean los únicos writers. Es la lista mínima observada en
el código; el censo operativo y de base de datos sigue siendo requisito.

## Decisiones que deben quedar cerradas antes del primer cambio

### Persistencia

- ¿La auditoría autoritativa se almacenará en tablas Oracle nuevas o mediante
  un procedimiento existente?
- ¿El outbox será necesario para mantener el reflejo MSSQL?
- ¿Quién crea y versiona DDL/procedimientos: Backend o DBA?
- ¿Qué retención tendrá el payload de idempotencia y qué evidencia de clave se
  conserva después de purgarlo?

### Revisión

- ¿La revisión se mantendrá en una tabla por grupo o se derivará de un estado
  autoritativo con bloqueo?
- ¿Los procedimientos `SIPF1_*` pueden actualizar la revisión en la misma
  transacción?
- ¿Qué writer externo queda fuera y cómo se impide habilitar v1 mientras exista?

### Conexión y transacción

- ¿Se cambiará `Oracle` para adquirir una conexión por transacción y liberarla
  siempre?
- ¿Las llamadas existentes a `query`, `ejecuta` y `querySinResultados` deben
  permanecer fuera de esa conexión o recibir un contexto transaccional?
- ¿Los procedimientos Oracle hacen commits internos? Si alguno lo hace, la
  atomicidad del handler no está demostrada y ese procedimiento debe adaptarse o
  quedar fuera de alcance.

## Plan de pruebas listo para ejecutar después del cambio

1. Prueba de wrapper: dos transacciones concurrentes usan conexiones distintas;
   un rollback no afecta al otro.
2. Prueba de revisión: dos requests con la misma revisión producen exactamente
   una aplicación y un conflicto.
3. Prueba de replay: la misma clave devuelve el resultado durable una segunda
   vez sin repetir procedimientos ni auditoría.
4. Prueba de huella: misma clave con request normalizado distinto devuelve
   `IDEMPOTENCIA_CLAVE_REUTILIZADA`.
5. Pruebas de fallo por hijo: horario, mensaje y plan revierten encabezado,
   hijos, revisión, auditoría e idempotencia aplicada.
6. Prueba de ACK perdido: el reintento recupera la respuesta sin duplicar.
7. Prueba de writer legacy: la modificación concurrente provoca conflicto o el
   writer queda bloqueado explícitamente.
8. Prueba de auditoría: los valores enviados por Front no aparecen como
   evidencia si difieren del estado calculado por Backend.
9. Regresión existente: `validar:todas`, TypeScript, `dist` y validación del
   schema, separando fallos previos de regresiones nuevas.

## Punto exacto de detención

La preparación termina aquí. El siguiente acto sería modificar, como mínimo,
el wrapper de Oracle y crear el repositorio/handler transaccional en
`siple-backTS`. No se realizó ninguna de esas modificaciones.
