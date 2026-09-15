# Control durable Oracle — implementación 2026-09-15

## Corrección de migración y nombres — 2026-09-15

Tablas definitivas: `dbo.GrupoControlOracle` y `dbo.GrupoOperacionOracle`.
Se alinearon nombres de índices, restricciones y consultas Backend con la
preferencia del usuario de no repetir el nombre de la base de datos.

El error 207 de Activa provenía del UPDATE compilado en el mismo lote que
ALTER TABLE ADD. La migración difiere su compilación con sp_executesql y hace
lo mismo para el índice filtrado, comprobando primero que exista la columna.
La inicialización sigue ejecutándose solo al agregar Activa; repetir la
migración no reabre ni cierra reservas existentes. Ejecutar el archivo completo
actualizado, incluidos los separadores GO, sobre las tablas ya renombradas.

Fundamento: [compilación separada de sp_executesql](https://learn.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/sp-executesql-transact-sql).
Verificado con TypeScript, validador del control y revisión de ambas copias SQL;
no se ejecutó esta migración contra una base de datos desde el agente.

## Estado y alcance

Implementado en Backend, con migración preparada y control habilitado en el
entorno de pruebas. La migración y las pruebas contra BD fueron ejecutadas por
el equipo fuera del agente. Sustituye la secuencia de transacción larga de la
preimplementación 3.6.

El registro EJECUTANDO se confirma en MSSQL antes de ejecutar Oracle. Un índice
único filtrado por Activa=1 reserva el grupo entre procesos y reinicios. El
registro no expira automáticamente: una caída no habilita otro escritor.
Mantener la intención sin confirmar durante Oracle habría permitido perderla
en un rollback MSSQL y repetir los SP; esa propuesta anterior queda retirada.

## Cambios

- `ControlGuardadoOracle.ts`: reserva, huella, replay, finalización y consulta.
- `Database.queryRawParams`: parámetros y resultados JSON sin normalización ni
  truncamiento. Las transacciones cortas se ejecutan en un solo batch MSSQL.
- `Grupos.guardarGrupo`: integración activable e invalidación de caché al fallar.
- GraphQL: argumento opcional `idempotencyKey` y consulta `estadoGuardadoOracle`.
- `ORACLE_GUARDADO_SELECTIVO=SI`: en la ruta legacy agregada, un cambio efectivo
  de cupos/datos generales invoca solo `SIPF1_ALTAGRUPO2`; horarios, mensajes y
  planes se ejecutan solo cuando el diff del servidor incluye ese dominio.
- Front de edición: conserva una clave por intento Oracle y consulta el estado
  durable antes de permitir otro guardado tras una respuesta incierta.
- Migración en `siple-backTS/scripts/sql/control-plane-oracle-legacy.sql`, con
  copia idéntica en este directorio.
- Validador nuevo `validar:control-oracle`, incluido en `validar:todas`.

No se implementó `Database.withTransaction`: no hace falta mantener una conexión
SQL prestada mientras Oracle trabaja. El índice durable conserva la exclusión.

## Activación en pruebas

1. Ejecutar completa la migración en MSSQL de pruebas con el usuario DBA.
   No ignorar errores: si existen dos operaciones activas del mismo grupo, la
   creación del índice debe fallar hasta reconciliarlas.
2. Conceder al usuario Backend SELECT/INSERT/UPDATE sobre las dos tablas y
   visibilidad de los metadatos del índice. No requiere permisos DDL en runtime.
3. Configurar `ORACLE_CONTROL_GUARDADO=SI` y reiniciar el Backend.
4. Para habilitar la primera vertical selectiva, configurar también
   `ORACLE_GUARDADO_SELECTIVO=SI` y reiniciar el Backend.
5. Usar `Mutation.guardarGrupo`. Los cuatro endpoints Oracle legacy separados
   y los procesos externos siguen fuera de esta coordinación. Evitar su uso
   simultáneo en las pruebas.

La migración no se ejecuta automáticamente. El flag ausente mantiene el flujo
actual. Enviar una clave mientras el control está deshabilitado devuelve
`ORACLE_CONTROL_NO_DISPONIBLE` para evitar una promesa de idempotencia falsa.
El flag selectivo es independiente: si está ausente, el control durable funciona
pero la ruta agregada conserva la secuencia completa anterior.

## Pruebas manuales

Usar un grupo de pruebas. Añadir `idempotencyKey: "prueba-20260915-001"` a la
mutación existente con variables para el grupo. Mantener la misma clave y el
mismo contenido ante un reintento.

1. Guardado normal: comprobar valores en una lectura nueva; la operación debe
   quedar APLICADA y Activa=0.
2. Con `ORACLE_GUARDADO_SELECTIVO=SI`, cambiar solo un cupo y revisar el detalle:
   `sp.encabezado=true` y `sp.horarios`, `sp.mensajes`, `sp.planesCompartidos`
   en `false`.
3. Repetir exactamente el mismo request: misma respuesta persistida, sin nuevas
   llamadas SP ni otra inserción de bitácora. La notificación socket puede
   repetirse; no forma parte de la garantía de replay.
4. Cambiar un valor conservando la clave: `IDEMPOTENCIA_CLAVE_REUTILIZADA`.
5. Dos instancias, mismo grupo y claves distintas durante ejecución: una reserva
   gana y la otra obtiene `ORACLE_GRUPO_PENDIENTE`. Grupos distintos avanzan.
6. Caída controlada después de un SP: queda EJECUTANDO/PARCIAL/INCIERTA con
   Activa=1; ninguna nueva clave debe ejecutar SP para ese grupo.
7. Caída después de confirmar resultado MSSQL: repetir la misma clave recupera
   APLICADA. Si no se confirmó, conserva la reserva y requiere revisión.

Consulta de estado, con las credenciales del actor original:

```graphql
query {
  estadoGuardadoOracle(idempotencyKey: "prueba-20260915-001") {
    estado codigoError periodo clave
    resultado { clave periodo cupoPrimerIngreso cupoComplementario }
  }
}
```

Se exige `editarGrupos` también para consultar/revelar resultados. Otro actor
no obtiene la operación. RequestJson y ResultadoJson contienen datos de negocio:
restringir acceso y no purgar claves ni reservas automáticamente.

## Reconciliación operativa

La recuperación es supervisada. No se programó compensación ni reejecución de
SP. Para encontrar intentos pendientes, DBA puede consultar:

```sql
SELECT OperacionId, Actor, Origen, Periodo, Grupo, Estado, Etapa,
       CodigoError, CreadoEn, ActualizadoEn
FROM dbo.GrupoOperacionOracle
WHERE Activa=1
ORDER BY CreadoEn;
```

Antes de liberar una reserva:

1. Confirmar que el proceso y la sesión Oracle originales terminaron; la edad
   de EJECUTANDO no demuestra que hayan terminado.
2. Leer Oracle directamente y contrastar con RequestJson y los efectos reales
   de los SP. No usar la caché, ni atribuir cambios de terceros al intento.
3. Registrar evidencia, responsable y resolución en la bitácora operativa.
4. Si se determina el resultado, DBA puede cerrar exclusivamente esa OperacionId
   mediante una actualización condicional y transacción corta: conservar la
   clave y el resultado histórico, poner Activa=0 únicamente cuando sea seguro.
   Para APLICADA se necesita un ResultadoJson válido y completo; si no puede
   reconstruirse, conservar PARCIAL/INCIERTA y un código de revisión manual.
5. Si se necesitan correcciones, el usuario recarga el estado y crea una nueva
   operación con clave nueva después del cierre supervisado.

Una reserva incierta permanece activa mientras no haya evidencia suficiente.
La interfaz administrativa de resolución queda pendiente; no se debe cambiar
Activa masivamente ni borrar el ledger para desbloquear usuarios.

## Garantías y límites

- Coordina `guardarGrupo` Oracle que usa este Backend y esta misma BD MSSQL.
- Sin clave del cliente genera una clave servidor: conserva exclusión y
  evidencia, pero no reconoce un replay posterior a un éxito.
- La huella ordena propiedades de objetos, conserva orden de arrays y omisiones;
  el cliente debe repetir el request exacto, no convertir HTML/Base64 ni
  reordenar colecciones. Ignora `cambiosBitacora` del cliente.
- RevisionControl/EstadoHash son información del último resultado observado.
  No se usan para prometer conflicto atómico frente a writers externos.
- La auditoría anterior sigue siendo post-commit; APLICADA significa que el
  flujo terminó y se guardó su respuesta, no auditoría atómica Oracle/MSSQL.
- No se habilita el contrato v1 aprobado: exige garantías más fuertes.
- Desactivar el flag elimina esta coordinación. Antes de hacerlo hay que parar
  nuevos guardados y revisar reservas activas; no es recuperación automática.

## Verificación

TypeScript, suite completa (seis validadores), schema GraphQL integrado y dist
correctos. Pruebas nuevas cubren replay, claves distintas, reserva concurrente,
aislamiento de actores, persistencia del resultado con ACK perdido, caída al
finalizar y al registrar un parcial, rechazo antes de Oracle cuando MSSQL falla,
integración con Grupos y JSON de más de 4000 caracteres sin alteración.

La prueba simula almacenamiento durable; no sustituye ejecutar migración y
probar el índice/concurrencia contra SQL Server y Oracle reales.

## Evidencia de ejecución en pruebas

El control se habilitó en el entorno de pruebas con:

```text
ORACLE_CONTROL_GUARDADO=SI
ORACLE_GUARDADO_SELECTIVO=SI
```

Se verificó un guardado real mixto de `V2026|CPC061D`: el detalle registró
`encabezado=true`, `mensajes=true`, `horarios=false` y
`planesCompartidos=false`. La operación quedó `APLICADA`, `Activa=0`, con la
clave `9206e083-15c0-4738-8ea4-ce4cdbc90382`.

El Frontend de producción quedó configurado para enviar clave explícita y el
build de producción terminó correctamente con hash `430575054d2bdd32`. La
suite unitaria Angular sigue bloqueada por fallas base del repositorio
(`zone.js/dist/zone-testing` y el tipo de `setInterval` en
`websockets.service.ts`); el build no presenta ese bloqueo.

La edición de espacios/horarios permanece fuera del alcance de este hito
porque el Frontend todavía no permite modificar esos datos.
