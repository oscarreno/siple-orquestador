# Fase 0 — Inventario vigente del Backend

**Fecha del corte:** 2026-09-04  
**Rama:** `master`  
**Repositorio:** `siple-backTS`  
**Estado:** inventario inicial completado y consolidado en el orquestador.

## Resumen

El backend expone una mutación agregada `guardarGrupo` y seis escrituras legacy
de grupos dentro de `Query`. Todas las escrituras de grupo usan actualmente el
permiso `editarGrupos`. La bitácora pública acepta valores fabricados por el
cliente. El flujo agregado tiene transacción MSSQL/Oracle, pero Oracle convierte
fallos requeridos de horarios, mensajes y planes en warnings y continúa hasta
confirmar.

## Schema y resolvers

Fuente: `src/graphql/schema/grupo.schema.graphql:58-90`.

| Operación | Tipo actual | Resolver | Permiso actual |
| --- | --- | --- | --- |
| `guardarGrupo` | `Mutation`, devuelve `Grupo!` | `queryGrupos.ts:368-399` | `editarGrupos` |
| `guardarEncabezadoGrupoDBO` | `Query`, devuelve `Int!` | `queryGrupos.ts:230-250` | `editarGrupos` |
| `guardarHorarioGrupoDBO` | `Query`, devuelve `Boolean!` | `queryGrupos.ts:254-266` | `editarGrupos` |
| `guardarPlanCompartidoGrupoDBO` | `Query`, devuelve `Boolean!` | `queryGrupos.ts:268-277` | `editarGrupos` |
| `guardarMensajeGrupoDBO` | `Query`, devuelve `Boolean!` | `queryGrupos.ts:279-287` | `editarGrupos` |
| `guardarGrupoMSSQL` | `Query`, devuelve `Boolean!` | `queryGrupos.ts:289-299` | `editarGrupos` |
| `guardarPlanCompartidoMSSQL` | `Query`, devuelve `Boolean!` | `queryGrupos.ts:301-313` | `editarGrupos` |
| `revisarGrupoPlaneacion` | `Query`, devuelve `Boolean!` | `queryGrupos.ts:356-365` | `editarGrupos` |
| `guardarBitacora` | `Query`, devuelve `Boolean!` | `queryMensajes.ts:53-61` | Autenticación + mismo usuario |

La mutación actual recibe `origen`, `grupo: GrupoInput!` y
`cambiosBitacora`; no recibe versión esperada, idempotencia, advertencias
confirmadas ni origen funcional tipado.

## Persistencia y auditoría

- `Grupos.guardarGrupo` enruta por origen en `src/clases/Grupos.ts:573-618`.
- MSSQL construye una transacción con actualización del encabezado y
  `delete + insert` de materias, horarios, mensajes y planes
  (`Grupos.ts:867-1085`).
- Oracle usa `withTransaction` y los procedimientos `SIPF1_ALTAGRUPO2`,
  `SIPF1_ALTAHORARIO`, `SIPF1_ALTAMENSAJE` y `SIPF1_ALTAGMAP22`
  (`Grupos.ts:1089-1265`).
- Oracle captura excepciones de horarios, mensajes y planes, registra warning y
  continúa (`Grupos.ts:1201-1259`); después actualiza fecha y registra bitácora
  fuera de la transacción (`Grupos.ts:1269-1289`).
- `Log.guardarBitacora` inserta directamente en `BitacoraSIPLE`
  (`src/clases/Log.ts:136-155`).
- `revisarGrupoPlaneacion` tiene su propia transacción MSSQL y bitácora
  (`Grupos.ts:1586-1627`), por lo que debe censarse por separado del guardado de
  características.

## Permisos y alcance

- Los resolvers de escritura invocan `requierePermiso(..., "editarGrupos")` con
  `allowLegacyArgs: false`.
- El resolver no aplica todavía la matriz v1 de `modificarCupos`,
  `editarEspacios` y `editarGrupos` por dominio.
- El inventario inicial no encontró validación servidor explícita de alcance por
  departamento/grupo en estas operaciones.
- `guardarBitacora` recibe `usuario`, `cambio`, `campo`, `valorAnterior` y
  `valorNuevo` desde el request (`mensajes.schema.graphql:20`); requiere
  restricción o conversión a mecanismo interno.

## Versionado e idempotencia

No se encontró contrato de `versionEsperada`, `rowversion`, tabla de versión por
grupo ni `idempotencyKey` asociado a `guardarGrupo`. La mutación actual no tiene
control condicional de concurrencia.

## Pruebas y línea base

| Comando | Resultado |
| --- | --- |
| `cmd /c npm run validar:guardar-grupo` | **FALLA BASE REPRODUCIBLE** en `scripts/validate-guardarGrupo.ts:269`. `pruebaRollbackIntermedioORACLE` esperaba rechazo y rollback, pero el procedimiento de prueba terminó en commit porque `guardarGrupoOracleAgregado` convierte fallos de hijos en warnings. |
| Suite declarada | No existe script `test` ni se encontraron specs dedicadas para el guardado; el validador anterior es la cobertura específica disponible. |

## Riesgos y discrepancias confirmadas

1. Éxito parcial silencioso en Oracle.
2. Bitácora fuera de la transacción y susceptible a datos enviados por Front.
3. `GrupoInput` completo como contrato de escritura y reemplazo de colecciones.
4. Rutas legacy expuestas como `Query` y aún consumibles.
5. Permiso único `editarGrupos`, sin matriz por dominio ni alcance documentado.
6. Sin versión ni idempotencia efectivas.
7. Rehidratación posterior al commit puede fallar sin estado recuperable explícito.

**Siguiente paso:** consolidar con el inventario Front, congelar el mapa de
escrituras y proponer el contrato v1; no corregir estos riesgos dentro de la
Fase 0.
