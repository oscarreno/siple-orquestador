# Fase 3.2-B — Rollback Oracle del guardado agregado

Fecha: 2026-09-11. Estado: implementada y verificada localmente.

El guardado Oracle atrapaba errores de horarios, mensajes y planes, los dejaba
como advertencias y permitía confirmar la transacción. Cada bloque conserva ahora
el registro de diagnóstico y relanza el error. `withTransaction` recibe el fallo,
ejecuta rollback y evita el commit. Así una falla requerida no deja un grupo
parcialmente guardado.

## Verificación

- `node -r ts-node/register/transpile-only pruebas/validate-guardarGrupo.ts`:
  **OK**. La regresión MSSQL conserva la auditoría calculada por Backend; el caso
  Oracle intermedio confirma rechazo, `rollback=true` y `commit=false`.
- `node -r ts-node/register/transpile-only pruebas/validate-auditoria-servidor.ts`:
  **OK**.
- `node node_modules/typescript/bin/tsc --noEmit`: **OK**.
- `npm run dist`: **OK**; artefacto recompilado.

La prueba usa conexiones y procedimientos simulados. No demuestra todavía que
los procedimientos Oracle reales sean reversibles en todas sus tablas ni que la
bitácora Oracle comparta la misma transacción: esa bitácora sigue escribiéndose
después del commit por `Log.guardarBitacora`.

## Siguiente paso

Diseñar la auditoría Oracle dentro del estado transaccional autoritativo, o un
outbox durable ligado al commit. La auditoría ya no usa los valores enviados por
el cliente, pero sigue siendo post-commit por la ubicación actual de
`Log.guardarBitacora`. La revisión compartida, idempotencia y concurrencia siguen
pendientes antes de habilitar la API v1.
