# Fase 3.3 - Lectura robusta de bitacora

Fecha: 2026-09-11. Estado: implementada y verificada localmente.

## Hallazgo

La consulta de `BitacoraSIPLE` si devolvia filas, pero `database.arreglaObjeto`
construia un JSON manual para convertir cada registro. Valores de auditoria con
comillas, barras invertidas o saltos de linea podian producir `JSON.parse`:

`Expected ',' or '}' after property value in JSON`

## Correccion

`arreglaObjeto` ahora construye directamente el objeto de salida, conservando
la normalizacion de nombres, fechas, nulos y saltos de linea. Ya no serializa y
vuelve a parsear los valores de la fila.

## Verificacion

- `pruebas/validate-guardarGrupo.ts`: OK; incluye comillas, barra invertida y
  salto de linea en un valor MSSQL.
- `npm run validar:todas`: OK.
- `node node_modules/typescript/bin/tsc --noEmit`: OK.
- `npm run dist`: OK.

El siguiente paso funcional es consultar nuevamente la bitacora del grupo
`CPC3326G` en `V2026` desde la interfaz. El ajuste corrige el lector común; no
modifica los registros existentes.
