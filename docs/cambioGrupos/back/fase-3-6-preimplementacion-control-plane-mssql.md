# Fase 3.6 — Preimplementación del control plane MSSQL

> Histórico, sustituido el 2026-09-15 por
> `fase-3-6-implementacion-control-oracle.md`. La intención ahora se confirma
> antes de Oracle y la exclusión usa una reserva durable con índice único.
> No implementar la transacción larga descrita abajo: perdería la intención
> ante una caída y rollback MSSQL.

Fecha: 2026-09-14. Estado: diseño y DDL preparados; no se modificó código en
este bloque ni se ejecutó DDL.

## Decisión de arquitectura

Los procedimientos Oracle no se moverán pronto y tres de ellos hacen `COMMIT`
interno. Por eso el control de revisión, serialización e idempotencia no puede
depender de una transacción Oracle que prometa todo-o-nada.

La propuesta compatible es:

1. MSSQL conserva el estado de control de la operación.
2. Una fila por grupo se bloquea con `UPDLOCK, HOLDLOCK` dentro de una
   transacción MSSQL.
3. La transacción mantiene el bloqueo mientras Backend invoca los SP Oracle.
4. El resultado de la operación se guarda como `APLICADA`, `PARCIAL` o
   `INCIERTA` antes de liberar el bloqueo.
5. Un reintento consulta el ledger y nunca repite automáticamente una operación
   terminal con la misma clave.

Esto serializa las operaciones que pasan por este control plane, incluso desde
varias instancias del Backend. No bloquea por sí mismo los endpoints legacy o
procesos externos que escriban Oracle sin adquirir la fila MSSQL.

## Tablas propuestas

El DDL está en
`docs/cambioGrupos/back/control-plane-oracle-legacy.sql`. Los nombres son
provisionales y deben ser revisados por DBA antes de ejecutar el archivo.

### `dbo.GrupoControlOracle`

Una fila por `(Origen, Periodo, Grupo)`:

- `RevisionControl`: contador generado por MSSQL para operaciones que usan el
  control plane;
- `EstadoHash`: huella del estado canónico observado después de la última
  operación conocida;
- `FechaEstado` y `ActualizadoPor`;
- clave primaria sobre origen, periodo y grupo.

Esta revisión no se presenta como revisión Oracle universal. Si un writer
externo cambia Oracle sin actualizar el control plane, el siguiente guardado
debe comparar la huella canónica observada con `EstadoHash` y marcar conflicto o
reconciliación requerida.

### `dbo.GrupoOperacionOracle`

Ledger durable por intento de operación:

- identidad de actor y objetivo;
- `IdempotencyKey` y `RequestHash`;
- estado y etapa alcanzada;
- revisión/hash anterior y posterior;
- resultado serializable, código de error y detalle operativo;
- timestamps de creación, actualización y expiración.

La restricción única propuesta sobre `(Actor, Origen, IdempotencyKey)` impide que
una clave confirmada se recicle para otro objetivo. Si el negocio necesita que
la clave sea global por usuario, esta restricción ya lo soporta; si necesita
otro alcance, DBA debe modificarla antes de implementar.

## Máquina de estados

Estados terminales:

- `RECHAZADA`: validación o autorización sin escritura Oracle;
- `CONFLICTO`: la huella/revisión esperada no coincide;
- `APLICADA`: todos los pasos esperados terminaron y el resultado quedó
  persistido;
- `PARCIAL`: un SP posterior falló después de que otro SP pudo confirmar;
- `INCIERTA`: se perdió la conexión o el proceso antes de conocer el resultado.

Estado transitorio:

- `EJECUTANDO`: la clave fue reservada y la operación tiene el bloqueo del grupo.

Reglas de replay:

| Registro encontrado | Misma huella | Acción |
| --- | --- | --- |
| `APLICADA` | Sí | devolver el resultado durable, sin SP |
| `RECHAZADA`/`CONFLICTO` | Sí | devolver el rechazo durable, sin SP |
| `PARCIAL` | Sí | devolver estado parcial y exigir reconciliación; no repetir automáticamente |
| `INCIERTA` | Sí | consultar estado canónico y reconciliar; no repetir a ciegas |
| cualquier estado | No | `IDEMPOTENCIA_CLAVE_REUTILIZADA` |
| `EJECUTANDO` vigente | Sí | esperar o devolver operación en curso, sin segundo SP |

El vencimiento de `EJECUTANDO` no autoriza a reejecutar. Primero se debe
consultar el estado Oracle y decidir `APLICADA`, `PARCIAL` o `INCIERTA`.

## Secuencia transaccional compatible

El siguiente cambio de código deberá recibir un contexto de transacción MSSQL
que conserve la misma conexión durante todo el flujo:

1. Iniciar transacción MSSQL.
2. Insertar el control del grupo si no existe.
3. Leer la fila de control con `UPDLOCK, HOLDLOCK`.
4. Consultar la operación por actor/origen/clave y comparar la huella.
5. Insertar `EJECUTANDO` o devolver el resultado existente.
6. Leer el grupo Oracle y calcular la huella canónica bajo el bloqueo MSSQL.
7. Comparar `revisionGrupoEsperada` y/o `EstadoHash`.
8. Ejecutar prevalidaciones y llamar los SP Oracle en orden fijo.
9. Si todo termina, actualizar control, resultado y estado `APLICADA`.
10. Si falla después del primer SP, guardar `PARCIAL` con etapa y error seguro;
    no ejecutar rollback ficticio ni repetir automáticamente.
11. Confirmar MSSQL para conservar el ledger y liberar el bloqueo.
12. Publicar bitácora normal y resultado GraphQL desde el estado durable.

La transacción MSSQL no revierte Oracle. Su función aquí es serializar, guardar
la intención/resultado y evitar replays ciegos. El manejo de una caída de
proceso entre Oracle y MSSQL debe terminar en `INCIERTA` o reconciliación según
la evidencia que pueda obtenerse al reintentar.

## Reconciliación

Debe existir una operación interna o procedimiento operativo que reciba
`OperacionId` y:

1. vuelva a leer el grupo Oracle;
2. calcule la huella del estado efectivo;
3. compare contra el candidato normalizado y contra `EstadoHash`;
4. marque `APLICADA` solo si el estado completo coincide;
5. marque `PARCIAL` si coincide solo una parte o faltan hijos;
6. marque `INCIERTA` si la lectura no permite determinarlo;
7. registre quién reconcilió y cuándo.

No debe invocar nuevamente los SP automáticamente. La compensación, si existe,
debe ser una decisión explícita de operación y contar con procedimientos
inversos aprobados.

## Revisiones y límites de seguridad

- La huella debe excluir `idempotencyKey` y valores de bitácora enviados por el
  cliente; incluye actor, objetivo, revisión esperada, origen funcional,
  cambios normalizados y confirmaciones cuando aplique.
- `ResultadoJson`, `RequestHash` y errores no deben contener tokens,
  contraseñas ni payloads personales innecesarios.
- La lectura de un resultado previo debe volver a autorizar al actor actual.
- La retención mínima del ledger debe superar la ventana máxima de reintentos y
  reconciliación. No se permite reciclar una clave confirmada solo porque se
  purgó su resultado.
- Los endpoints legacy quedan fuera del control hasta migrarse o bloquearse.
  El control plane debe emitir una métrica de operaciones fuera de alcance si
  se dispone de telemetría.

## Evidencia necesaria antes de modificar código

DBA/operación debe confirmar:

1. que Backend puede crear las dos tablas e índices en el esquema MSSQL elegido;
2. tamaño y retención autorizados para `ResultadoJson` y `RequestHash`;
3. permisos para mantener una transacción MSSQL abierta durante las llamadas
   Oracle;
4. timeout máximo aceptable del bloqueo por grupo;
5. política para `EJECUTANDO` abandonado;
6. quién ejecuta reconciliaciones `PARCIAL`/`INCIERTA`;
7. si el control se habilitará primero solo para `Mutation.aplicarCambiosGrupo`
   o también para `guardarGrupo` legacy.

Hasta confirmar esos puntos, el siguiente cambio de código queda delimitado a:

- `Database.withTransaction` con una conexión/request MSSQL dedicada;
- repositorio del control plane;
- cálculo de hash y transición de estados;
- pruebas simuladas de replay, conflicto, timeout y parcial.

No se requiere modificar los SP Oracle para ese bloque, pero tampoco se debe
llamar a este mecanismo transacción distribuida.
