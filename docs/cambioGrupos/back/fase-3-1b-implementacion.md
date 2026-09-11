# Fase 3.1-B — Restricción de auditoría pública

Fecha: 2026-09-11. Implementado localmente en `C:/SIPLE/siple-backTS`.
Estado: restricción y pruebas focalizadas verificadas; despliegue pendiente.

`Query.guardarBitacora` conserva autenticación y rechaza toda escritura
autenticada con AppError 403 `AUDITORIA_PUBLICA_NO_DISPONIBLE`, antes de obtener
Log o ejecutar SQL. La firma GraphQL permanece con deprecación. La lectura y
Log interno no se modificaron. El formateador recupera el código de un AppError
envuelto por GraphQL, conservando prioridad de códigos explícitos.

Archivos: `src/graphql/resolvers/queryMensajes.ts`,
`src/graphql/schema/mensajes.schema.graphql`, `src/system/errorHandling.ts` y
`scripts/validate-bitacora-publica.ts`.

## Verificación ejecutada

- `node -r ts-node/register/transpile-only scripts/validate-bitacora-publica.ts`:
  OK. Seis rechazos autenticados entre usuarios y orígenes, rechazo sin sesión,
  cero llamadas públicas a Log/SQL, controles de lectura, dos escrituras internas
  con SQL simulado y regresión del formateador. Resolver, autenticación, Log,
  schema y formateador reales; sesión autenticada preestablecida y dependencias
  externas simuladas. Los nombres de usuario no constituyen pruebas de consulta
  de roles: esta ruta rechaza a cualquier identidad sin consultar privilegios.
- `node node_modules/typescript/bin/tsc --noEmit`: OK.
- `git diff --check`: OK; avisos normales LF/CRLF.
- Verificador de espejos v1: OK, tres paquetes idénticos.
- Smoke test HTTP en `127.0.0.1:3101` con JWT sintético: OK. GraphQL devolvió
  `data: null` y `extensions.code: AUDITORIA_PUBLICA_NO_DISPONIBLE`; no hubo
  escritura de bitácora. El proceso temporal se detuvo después de la prueba.
- Suite focalizada del Front actualizada contra su código vigente: `29 SUCCESS`
  en ChromeHeadless 152. La suite confirma que los errores del guardado agregado
  no activan llamadas legacy y que el editor conserva el estado de recuperación.
- `node -r ts-node/register/transpile-only scripts/validate-guardarGrupo.ts`:
  falla en `pruebaRollbackIntermedioORACLE`, `Missing expected rejection`,
  coincidente con el fallo registrado en la línea base. No se declara verde la
  regresión general. Grupos y ese validador no fueron modificados.

La prueba focalizada ejecuta Log interno con persistencia simulada; no recorre
las dos operaciones completas que lo llaman (agregado Oracle y revisión de
planeación). Su código permanece intacto. La cobertura de esas operaciones y
la falla de rollback deben resolverse en las fundaciones posteriores.

## Despliegue y siguiente paso

No hubo despliegue ni conexión a BD. Falta evidencia de actualización de clientes
activos y pestañas antiguas: el censo local no demuestra esa condición.
Desplegar requiere comprobar compatibilidad y ausencia del fallback antiguo,
según `../fase-3-1-listo-para-codigo.md`.

La Fase 3 sigue EN CURSO. Retomar fundaciones servidoras: auditoría derivada del
estado persistido, atomicidad por origen (incluido rollback Oracle), autorización,
revisión compartida con escritores legacy e idempotencia. La API v1 permanece
sin habilitar. El agregado todavía acepta `cambiosBitacora` del cliente.
