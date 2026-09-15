# 3.4-B — Auditoría Oracle basada en el estado efectivo

Fecha: 2026-09-14. Implementado localmente en `siple-backTS` y verificado con
pruebas simuladas; pendiente de validación con datos reales.

El caso `V2026|CPC3326G` mostró dos cambios solicitados, pero la auditoría
agregó `cupoMaximo`, `exportable` y `mensajes`. El diagnóstico fue:

- `cupoMaximo` omitido se conserva en la persistencia Oracle mediante el valor
  anterior; compararlo contra `undefined` generaba `24 -> ""` ficticio.
- `exportable` no forma parte de la escritura Oracle agregada; no debe auditarse
  en esa rama.
- POPUP llegaba como HTML desde la lectura y como Base64 desde el candidato.
  La normalización anterior intentaba decodificar siempre el HTML y producía
  bytes inválidos.
- El orden de los mensajes no es semántico para esta operación y podía variar.

## Cambio

`construyeCambiosBitacoraServidor` ahora recibe el origen. Para Oracle proyecta
el candidato efectivo con las mismas reglas de la persistencia actual, compara
solo campos que la rama Oracle escribe y ordena horarios, mensajes y planes de
forma estable. POPUP solo se decodifica cuando cumple Base64 estricto; el HTML
ya decodificado se conserva.

MSSQL conserva la comparación anterior. El cambio no usa los valores de
`cambiosBitacora` del cliente.

## Verificación

- `validar:auditoria-normalizada`: **OK**; reproduce el grupo del caso real y
  deja únicamente `cupoPrimerIngreso` y `cupoComplementario`.
- `validar:todas`: **OK**; incluye rollback Oracle, bitácora pública,
  auditoría derivada, aislamiento de transacciones y esta regresión.
- TypeScript `--noEmit`: **OK**.
- `npm run dist`: **OK**.
- `git diff --check`: **OK**, con avisos normales de LF/CRLF.

No se conectó a BD ni se modificaron registros reales. La auditoría Oracle
continúa persistiendo después del commit en MSSQL; la atomicidad y la
idempotencia siguen pendientes del siguiente bloque.

## Prueba manual solicitada

Repetir el cambio sobre `V2026|CPC3326G` o un grupo de prueba equivalente:

1. Cambiar solo primer ingreso `0 -> 6` y complementario `24 -> 9`.
2. Mantener POPUP y mensajes sin cambios, aunque el cliente los envíe en otro
   orden o POPUP en Base64.
3. Guardar y revisar el log `[guardarGrupo][ORACLE] detalle`.

La lista `cambiosBitacora` debe contener únicamente los dos cupos. Si el valor
del POPUP cambió realmente, debe aparecer un cambio `mensajes`; si solo cambió
su representación HTML/Base64 u orden, no debe aparecer.
