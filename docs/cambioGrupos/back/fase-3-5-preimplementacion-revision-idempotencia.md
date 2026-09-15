# Fase 3.5 — Preimplementación de revisión e idempotencia

Fecha: 2026-09-14. Estado: detenido antes de nuevos cambios de código.

Este documento cierra el trabajo que puede hacerse desde los repositorios. El
siguiente paso requiere evidencia del esquema y de los procedimientos Oracle
por parte de DBA. No se deben inventar nombres de tablas, columnas, claves ni
semántica transaccional en Backend.

## Resultado de la inspección actual

El flujo Oracle agregado observado en `siple-backTS` es:

1. `guardarGrupo` llama a `guardarGrupoOracleAgregado` en
   `src/clases/Grupos.ts:605`.
2. El agregado usa `Oracle.withTransaction` en la misma clase, alrededor de
   las llamadas a `SIPF1_ALTAGRUPO2`, `SIPF1_ALTAHORARIO`,
   `SIPF1_ALTAMENSAJE` y `SIPF1_ALTAGMAP22`.
3. La bitácora actual se persiste después del commit Oracle, en MSSQL; por lo
   tanto, no es parte de la misma unidad atómica.
4. Los writers legacy independientes siguen siendo:
   `guardarEncabezadoGrupoDBO`, `guardarHorarioGrupoDBO`,
   `guardarMensajeGrupoDBO` y `guardarPlanCompartidoDBO`. Sus llamadas a
   `SIPF1_*` usan operaciones Oracle independientes.
5. `revisarGrupoPlaneacion` modifica MSSQL y pertenece a otro flujo; no debe
   quedar accidentalmente incluido en una revisión Oracle.

La conexión por transacción ya fue aislada localmente y las pruebas simuladas
de rollback/concurrencia pasan. Eso no demuestra todavía que los
procedimientos Oracle respeten la transacción externa.

## Consultas que debe ejecutar DBA

El archivo ejecutable de apoyo es
`docs/cambioGrupos/back/diagnostico-oracle-revision-idempotencia.sql`.
Las consultas deben ejecutarse con un usuario de solo lectura sobre un ambiente
de desarrollo o réplica. No deben incluir credenciales ni datos sensibles en el
repositorio.

Se requiere entregar, como mínimo:

- propietario, tipo y firma completa de los cuatro procedimientos;
- cuerpo fuente o indicación explícita de que está envuelto/no disponible;
- dependencias reales: tablas, vistas, paquetes, funciones y triggers;
- triggers de las tablas que reciben escritura;
- evidencia de cualquier `COMMIT`, `ROLLBACK`, `PRAGMA AUTONOMOUS_TRANSACTION` o
  llamada que delegue en una rutina con esos efectos;
- columnas y restricciones disponibles para implementar revisión, auditoría e
  idempotencia;
- censo de otros writers fuera del repositorio.

Si `ALL_SOURCE` no muestra el cuerpo por ser código wrapped, la ausencia de
`COMMIT` en esa consulta no es evidencia suficiente. En ese caso es obligatoria
la prueba controlada de rollback descrita abajo.

## Prueba controlada de transacción Oracle

Debe ejecutarla DBA u operación en un ambiente desechable, con un grupo creado
para pruebas y con respaldo de su estado inicial. No debe ejecutarse sobre
producción ni sobre un grupo que pueda ser editado por usuarios.

Para cada uno de los cuatro procedimientos:

1. Abrir conexión A y comenzar una transacción explícita.
2. Ejecutar un solo procedimiento con un cambio identificable y válido.
3. Provocar deliberadamente un error en la misma conexión A antes del commit.
4. Hacer `ROLLBACK` en A y cerrar la conexión.
5. Consultar desde una conexión B, independiente, las tablas/vistas afectadas.
6. Confirmar que no quedó ninguna modificación, secuencia auxiliar, auditoría,
   trigger lateral ni cambio de timestamp.
7. Repetir la prueba con el procedimiento ejecutado en una transacción que sí
   hace `COMMIT`, verificando que el cambio esperado queda durable.

Interpretación:

- Si el cambio sobrevive al rollback de A, existe un commit interno,
  transacción autónoma o efecto externo. El procedimiento no es apto para la
  unidad atómica v1 hasta ser adaptado o reemplazado.
- Si el cambio desaparece y el commit explícito lo conserva, el procedimiento
  puede participar en la transacción externa, sujeto a las pruebas de bloqueo.
- Si no se puede observar de forma confiable el efecto, el resultado es
  **desconocido** y se bloquea la habilitación; no se considera aprobado.

También se debe ejecutar una prueba de dos conexiones concurrentes sobre el
mismo grupo:

- A lee la revisión y mantiene el bloqueo durante la escritura;
- B intenta escribir el mismo grupo;
- se registra si B espera, falla por conflicto, sobrescribe o modifica hijos
  parcialmente;
- se repite con grupos distintos para confirmar que el bloqueo no es global.

La evidencia debe incluir identificadores de conexión, timestamps, resultado de
cada sentencia y consultas posteriores desde una conexión independiente. No se
requiere adjuntar valores personales ni secretos.

## Evidencia recibida de DBA

Resultado informado el 2026-09-14:

- `SIPF1_ALTAGRUPO2`: realiza `COMMIT` interno.
- `SIPF1_ALTAHORARIO`: realiza `COMMIT` interno.
- `SIPF1_ALTAMENSAJE`: realiza `COMMIT` interno.
- `SIPF1_ALTAGMAP22`: recibe un parámetro de autocommit cuyo valor por defecto
  es `N`; puede participar en la transacción externa únicamente si la llamada
  aprobada lo envía explícitamente como `N` y la rutina no lo cambia
  indirectamente.

Este resultado bloquea la atomicidad del agregado actual. Una excepción después
de `SIPF1_ALTAGRUPO2`, `SIPF1_ALTAHORARIO` o `SIPF1_ALTAMENSAJE` no puede
deshacer los cambios que esos procedimientos ya confirmaron. Adquirir una
conexión exclusiva, usar `ROLLBACK` desde Node o reordenar las llamadas no
elimina ese `COMMIT` interno.

Antes de modificar Backend, DBA debe proporcionar una de estas alternativas:

1. variantes de los tres procedimientos sin `COMMIT` interno, manteniendo el
   mismo contrato funcional;
2. un procedimiento agregado que reciba todo el cambio y controle un único
   commit al final;
3. autorización para reemplazar las llamadas por DML/repositorios
   transaccionales aprobados, incluyendo triggers y efectos laterales;
4. una decisión explícita de abandonar el requisito todo-o-nada y aceptar un
   protocolo compensatorio, con sus estados y auditoría aprobados.

El parámetro `autocommit=N` de `SIPF1_ALTAGMAP22` no resuelve por sí solo el
problema: solo evita agregar otro commit a una transacción ya comprometida por
los otros procedimientos. Tampoco debe confiarse en el valor por defecto; la
llamada debe fijarlo explícitamente y una prueba debe demostrar que permanece
`N` en todos los caminos.

## Modelo que queda listo para implementar después de la evidencia

La implementación v1 debe conservar estas fronteras:

### Revisión compartida

Una fila autoritativa por `(origen, periodo, clave)` con:

- token de revisión generado por servidor;
- fecha de actualización;
- actor o proceso que realizó el último cambio;
- restricción única por grupo y origen.

La lectura de la revisión, la validación de `revisionGrupoEsperada`, el bloqueo,
la escritura del grupo y el incremento de revisión deben estar en la misma
transacción Oracle. El token enviado por Front nunca es autoridad para decidir
la nueva revisión.

### Idempotencia

Una tabla durable con clave única por actor, origen y clave de idempotencia,
además de:

- huella de la solicitud normalizada;
- estado (`EN_PROCESO`, `APLICADA`, `RECHAZADA` o equivalente aprobado por DBA);
- respuesta durable o referencia a la respuesta;
- timestamps de creación, actualización y expiración;
- referencia a la revisión y auditoría resultantes.

Una repetición con la misma clave y la misma huella debe devolver el resultado
durable sin volver a ejecutar los procedimientos. La misma clave con otra
huella debe rechazarse como reutilización inválida. Un ACK perdido debe poder
recuperarse sin duplicar hijos ni auditoría.

### Auditoría

La auditoría autoritativa debe registrar dentro de la misma transacción:

- actor, origen, operación y grupo;
- revisión anterior y nueva;
- cambios calculados por Backend a partir del estado efectivo;
- referencia a la idempotencia;
- fecha y resultado.

El reflejo actual en MSSQL sigue siendo posterior al commit Oracle. Si se
requiere consistencia eventual, debe definirse un outbox durable y un proceso de
reintento; no se debe presentar como transacción distribuida.

## Criterios de decisión

No se inicia la siguiente modificación de código si ocurre cualquiera de estos
casos:

- un `SIPF1_*` hace commit interno o usa transacción autónoma;
- existe un writer de grupo no censado que puede modificar los mismos datos;
- no se conoce la tabla/columna que sostendrá la revisión o idempotencia;
- el bloqueo concurrente permite `last writer wins` sin conflicto;
- no hay forma de consultar el resultado durable después de un ACK perdido.

Se puede pasar a implementación únicamente cuando DBA confirme por escrito que:

1. los cuatro procedimientos participan en la transacción externa, o existe
   una sustitución transaccional aprobada;
2. los writers legacy quedan migrados, bloqueados o explícitamente fuera del
   alcance con una barrera operativa;
3. el DDL, sus índices y sus procedimientos auxiliares están versionados;
4. las pruebas de rollback, commit y concurrencia tienen evidencia reproducible;
5. el alcance del outbox MSSQL está aprobado, si se necesita reflejo durable.

## Secuencia posterior, una vez aprobado el punto de decisión

1. Versionar DDL y procedimientos aprobados por DBA.
2. Implementar repositorios transaccionales de revisión, idempotencia y
   auditoría sobre el contexto de conexión de `withTransaction`.
3. Adaptar el handler GraphQL v1, sin reutilizar los valores de bitácora
   enviados por el cliente.
4. Añadir pruebas de replay, huella, conflicto, rollback por hijo y ACK
   perdido.
5. Ejecutar regresión local y luego pruebas controladas contra Oracle.
6. Habilitar la ruta v1 únicamente con telemetría y rollback operativo.

Con la evidencia recibida, la implementación atómica v1 queda descartada para
este tramo. El avance posible es una **modalidad compatible con SP legacy**:

- prevalidar y preparar todos los datos antes de invocar el primer SP;
- enviar y verificar `autocommit=N` explícitamente a `SIPF1_ALTAGMAP22`;
- serializar la operación por grupo para reducir carreras;
- distinguir `APLICADO`, `FALLIDO` y `APLICACIÓN_PARCIAL`;
- persistir la evidencia y dejar una ruta de reconciliación para fallos después
  de un `COMMIT` interno.

Esta modalidad no promete rollback todo-o-nada en Oracle. La API debe informar
un resultado incierto/parcial cuando falle un paso posterior al primer SP, y no
debe responder como si el grupo hubiera sido revertido.

## Primer bloque implementado en Backend

Se aplicó el primer bloque compatible sin mover los SP:

- las plantillas de horarios se resuelven antes de invocar el encabezado;
- `SIPF1_ALTAGMAP22` recibe `autocommit=N` explícitamente;
- el log ya no afirma que todo el agregado fue transaccional;
- un fallo después de invocar el encabezado produce el error público
  `ORACLE_APLICACION_PARCIAL`, con la etapa registrada para reconciliación;
- la prueba simulada conserva el rollback técnico del wrapper, pero verifica
  que el contrato visible distingue la posible persistencia previa de los SP.

Este bloque reduce fallos previsibles y evita diagnósticos falsos, pero todavía
no proporciona idempotencia durable ni bloqueo distribuido entre instancias. Esas
dos garantías requieren el control plane MSSQL/Oracle que se definirá en el
siguiente bloque compatible.

La propuesta para resolver esas dos garantías sin mover los SP está en
`fase-3-6-preimplementacion-control-plane-mssql.md` y
`control-plane-oracle-legacy.sql`.
