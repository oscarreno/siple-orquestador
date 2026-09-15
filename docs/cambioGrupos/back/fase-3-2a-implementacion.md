# Fase 3.2-A - Auditoria derivada por Backend

Fecha: 2026-09-11. Estado: implementada y verificada localmente; pendiente de
prueba funcional adicional y despliegue persistente.

En `Grupos.guardarGrupo`, Backend carga el grupo persistido antes de escribir,
compara sus campos y colecciones con el candidato y construye
`cambiosBitacora` desde esa diferencia. La lista recibida del Front se ignora
para la auditoria en ambos origenes. Se cubren encabezado, cupos, materia,
profesor, mensajes, horarios, planes, materias adicionales y programas
revisados. El guardado MSSQL sigue usando una sola transaccion que incluye las
filas de bitacora calculadas por Backend; Oracle usa la misma diferencia para
su bitacora post-commit.

La lectura previa tambien evita aceptar silenciosamente una auditoria
fabricada. Si el grupo no existe, el guardado legacy conserva su comportamiento
de alta y no crea una bitacora basada en datos del cliente. Oracle mantiene
pendiente la atomicidad de la bitacora porque `Log.guardarBitacora` escribe en
MSSQL despues del commit Oracle.

## Verificacion

- `pruebas/validate-auditoria-servidor.ts`: OK. En MSSQL y Oracle, un candidato
  con cambios reales en `tipo` y `cupoGeneral`, mas un cambio falso enviado por
  el cliente, produce solo las dos diferencias reales.
- `pruebas/validate-guardarGrupo.ts`: la regresion MSSQL y el guardado Oracle
  simulado pasan; el caso Oracle intermedio confirma rollback.
- `node node_modules/typescript/bin/tsc --noEmit`: OK.
- `npm run dist`: OK; artefacto `dist` recompilado.
- `git diff --check`: OK, con avisos normales de LF/CRLF.

No se ejecuto un guardado real adicional desde este bloque. Las pruebas
manuales MSSQL y Oracle del usuario quedan como casos felices aprobados del
flujo actual.

## Limites y siguiente paso

Esta vertical no implementa todavia revision compartida, idempotencia ni
comparacion bajo bloqueo; una lectura previa aislada puede quedar obsoleta
antes del commit. Tampoco resuelve la auditoria Oracle posterior al commit ni
los campos derivados que el guardado legacy recalcula. El siguiente bloque debe
disenar auditoria atomica desde el mismo estado transaccional, o un outbox
durable ligado al commit, antes de habilitar la API v1.
