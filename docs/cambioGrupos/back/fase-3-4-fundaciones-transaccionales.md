# Fase 3.4 — Fundaciones transaccionales de Oracle

Fecha: 2026-09-14. Estado: diseño operativo listo para implementación en
Backend; no habilita todavía la API v1 ni autoriza despliegue.

## Objetivo

Cerrar las tres garantías que aún impiden habilitar cambios de grupos en
Oracle:

1. auditoría ligada al commit del origen autoritativo;
2. revisión compartida por todos los escritores del grupo;
3. idempotencia durable para reintentos y pérdida de respuesta.

El alcance de este bloque es Oracle. No se propone una transacción distribuida
Oracle/MSSQL. La bitácora MSSQL actual (`Log.guardarBitacora`) permanece como
reflejo externo pendiente; no puede ser la única evidencia de una operación
confirmada en Oracle.

## Precondición de conexión

El wrapper actual de Oracle (`src/system/oracle.ts`) guarda una conexión única
en `this.conn` y `withTransaction` reutiliza esa conexión global. Antes de
probar concurrencia o habilitar este flujo, Backend debe garantizar una
conexión/transacción aislada por operación (por ejemplo, adquirir una conexión
del pool, hacer `commit`/`rollback` y liberarla en `finally`). No basta con
agregar `SELECT ... FOR UPDATE` si dos requests pueden compartir la misma
conexión o el mismo estado transaccional.

La prueba de esta precondición debe demostrar dos operaciones concurrentes con
conexiones distintas, rollback independiente y ausencia de commit cruzado. Si
el wrapper no se corrige, la revisión de concurrencia queda bloqueada y Oracle
no puede habilitarse.

## Diseño aprobado para implementación

### 1. Estado transaccional autoritativo

Backend debe persistir en Oracle, dentro de la misma transacción que modifica
el grupo:

- una fila de revisión por `(periodo, claveGrupo)` y origen;
- un encabezado de auditoría por operación (`auditoriaId`, actor, origen
  funcional, correlación, revisión anterior y nueva);
- detalles de cambios calculados por Backend, uno por campo o elemento
  efectivo;
- el registro de idempotencia y el resultado durable de la operación.

La estructura exacta y sus nombres quedan a cargo de Back, pero debe cumplir
estas claves mínimas:

| Registro | Identidad/garantía mínima |
| --- | --- |
| Revisión | Única por grupo y origen; todos los writers deben incrementarla dentro de su propia transacción. |
| Auditoría | `auditoriaId` único; detalles vinculados al mismo grupo, actor, operación y revisión. |
| Idempotencia | Única por actor, origen y `idempotencyKey`; la huella enlaza el request normalizado completo. |

No se debe guardar una copia de `cambiosBitacora` enviada por Front como
evidencia. Los valores anterior/nuevo se calculan desde el estado cargado y el
candidato validado por Backend.

### 2. Orden de ejecución y bloqueo

El handler v1 debe ejecutar, dentro de una sola conexión/transacción Oracle,
la siguiente secuencia:

1. Autenticar y autorizar al actor.
2. Adquirir la fila de idempotencia por `(actor, origen, idempotencyKey)`.
   Si ya tiene resultado terminal, devolver exactamente ese resultado sin
   repetir escritura. Si la huella no coincide, rechazar con
   `IDEMPOTENCIA_CLAVE_REUTILIZADA`.
3. Bloquear la fila de revisión del grupo (`SELECT ... FOR UPDATE` o
   equivalente del procedimiento autoritativo).
4. Comparar `revisionGrupoEsperada` con la revisión canónica bajo el mismo
   bloqueo. Si no coincide, persistir un conflicto terminal y no modificar el
   grupo.
5. Cargar el estado canónico completo, aplicar el patch tipado y validar reglas,
   permisos, dependencias y advertencias confirmadas.
6. Ejecutar todas las escrituras de encabezado e hijos requeridas. Cualquier
   fallo relanza el error y revierte la transacción completa.
7. Calcular `revisionGrupoNueva`, insertar encabezado y detalles de auditoría,
   y guardar el resultado serializable en el registro de idempotencia.
8. Confirmar una sola vez. La respuesta GraphQL se reconstruye del resultado
   durable; no depende de una segunda lectura que pueda fallar después del
   commit.

El orden de bloqueos debe ser común a todas las operaciones v1 para evitar
deadlocks. Un timeout o una conexión perdida antes de conocer el commit se
reporta como resultado técnico recuperable: Front conserva el mismo request y
la misma clave, y no genera una nueva escritura.

### 3. Revisión compartida

Una tabla que solo incremente la mutación v1 no es suficiente. Antes de
habilitar Oracle, Back debe censar y adaptar todos los writers que puedan
modificar el agregado, incluidos:

- `guardarGrupoOracleAgregado` y sus procedimientos hijos;
- rutas legacy de encabezado, horario, mensaje y plan;
- `revisarGrupoPlaneacion` y cualquier proceso administrativo que cambie el
  estado visible del grupo;
- jobs, scripts o procedimientos externos que el censo de despliegue identifique.

Cada writer debe actualizar la misma revisión o invocar un procedimiento
autoritativo que la actualice. Si existe un writer que no puede participar, el
origen Oracle permanece no disponible para v1. No se acepta `last writer wins`,
un contador exclusivo de la API nueva ni una lectura previa sin bloqueo.

La revisión debe cubrir todos los campos que participan en autorización,
validación, auditoría o respuesta canónica. Un cambio externo que no sea
visible para la revisión invalida la garantía de conflicto.

### 4. Idempotencia y recuperación

El registro debe distinguir al menos estos estados:

`EN_CURSO`, `APLICADA`, `RECHAZADA`, `CONFLICTO` y `ERROR_RECUPERABLE`.

Reglas:

- La huella incluye actor, objetivo, revisión esperada, origen funcional,
  cambios normalizados y confirmaciones; excluye solo la clave como dato de
  negocio.
- Misma clave y misma huella devuelven el resultado persistido sin duplicar
  cambio, revisión ni auditoría.
- Misma clave con otra huella devuelve
  `IDEMPOTENCIA_CLAVE_REUTILIZADA`.
- Un request `EN_CURSO` se serializa sobre la misma clave; no se ejecuta en
  paralelo por un segundo intento.
- Los resultados terminales deben conservarse junto con una evidencia de uso
  de la clave. Purgar el payload no permite reciclar una clave confirmada.
- La autorización para revelar un resultado previo se comprueba con el actor
  actual; no se reutilizan credenciales de la solicitud original.

## Auditoría externa MSSQL

La llamada actual a `Log.guardarBitacora` ocurre después del commit Oracle y no
puede hacer que la operación principal se considere fallida. Para conservar un
reflejo MSSQL sin prometer atomicidad distribuida, la alternativa permitida es:

1. insertar un outbox Oracle en la misma transacción del cambio y la auditoría
   nativa;
2. publicar el evento con `auditoriaId` como clave de correlación;
3. consumirlo con reintentos e inserción idempotente en MSSQL;
4. exponer estado pendiente/fallido del outbox y alertarlo operativamente.

El outbox no reemplaza la auditoría Oracle ni autoriza responder éxito si la
transacción autoritativa no confirmó. Si no se implementa el outbox, la
bitácora MSSQL queda explícitamente fuera de la garantía atómica de Oracle.

## Pruebas mínimas antes de habilitar

Back debe añadir pruebas simuladas y, cuando existan procedimientos disponibles,
pruebas de integración que demuestren:

1. dos requests con la misma revisión: uno aplica y el otro devuelve conflicto;
2. dos requests concurrentes para el mismo grupo: no hay sobrescritura ni
   auditoría duplicada;
3. reintento con la misma clave: mismo resultado, una escritura, una revisión y
   una auditoría;
4. misma clave con request distinto: `IDEMPOTENCIA_CLAVE_REUTILIZADA`;
5. fallo de cada hijo Oracle: rollback de encabezado, hijos, revisión,
   auditoría e idempotencia aplicada;
6. pérdida de respuesta después del commit: reintento recupera el resultado sin
   volver a escribir;
7. writer legacy concurrente: la revisión compartida detecta el cambio o el
   writer queda bloqueado antes de habilitar v1;
8. auditoría derivada: se ignoran valores de bitácora fabricados por el cliente;
9. outbox, si se adopta: un reintento no duplica el reflejo MSSQL.

La regresión existente de `guardarGrupo` debe seguir verde para los casos
compatibles. Las pruebas simuladas no sustituyen la evidencia de que los
procedimientos Oracle reales hagan rollback en todas las tablas afectadas.

## Puerta de salida

Este diseño queda **listo para implementación**, no aprobado para producción.
La Fase 3.4 podrá marcarse como implementada solo cuando Back entregue:

- migración/procedimientos o mecanismo equivalente para revisión, auditoría e
  idempotencia;
- censo de writers y evidencia de que todos actualizan la revisión;
- pruebas de concurrencia, replay, rollback y pérdida de respuesta;
- resultado durable reconstruible y, si aplica, outbox con monitoreo;
- TypeScript, build, regresión completa y revisión de seguridad sin secretos ni
  escrituras reales no autorizadas en las pruebas.

Hasta entonces, `aplicarCambiosGrupo` continúa sin habilitarse y la Fase 3
permanece `EN CURSO`.
