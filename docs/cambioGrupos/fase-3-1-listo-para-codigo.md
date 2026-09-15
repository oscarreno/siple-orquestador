# Fase 3.1 — Preparación concluida, siguiente paso: código

Fecha: 2026-09-08. Responsable: Orquestador. Estado: **LISTO PARA IMPLEMENTAR
EL BLOQUE 3.1-A**. No se modificó código productivo ni se aprobó un despliegue.
La Fase 2 permanece aprobada; este documento prepara su primer bloque de
fundaciones y no altera el contrato v1 publicado.

## Hallazgo que determina la secuencia

Cerrar únicamente `Query.guardarBitacora` es insuficiente: Front primero guarda
datos con el fallback legacy y después solicita auditoría. El error de esta
última llamada se captura sin propagarse. El usuario puede recibir éxito aunque
no haya bitácora. Cambiar únicamente ese catch por throw tampoco resuelve el
problema: produciría un error después de una escritura ya realizada.

Además, `debeUsarGuardadoLegacy` admite «Respuesta GraphQL sin datos», que no
demuestra que la mutación anterior no se haya confirmado. El fallback puede
repetir escrituras. La preparación identifica por tanto dos pasos de código
ordenados: contener el fallback automático en Front y restringir después el
resolver público en Back.

## Censo confirmado

| Ruta | Uso y dependencia |
| --- | --- |
| Front `src/app/services/grupos-data.service.ts:614` | `guardarGrupoDBO` intenta `guardarGrupoUnificado`; tras ciertos errores entra en `guardarGrupoLegacy`. |
| Front `grupos-data.service.ts:637` | Fallback: MSSQL guarda y luego audita en `:643`; Oracle guarda encabezado/hijos y después audita en `:691`. |
| Front `grupos-data.service.ts:975` | Clasificador por texto; incluye respuesta sin datos y nombres `guardagrupo` que no corresponden al nombre real `guardarGrupo`. No sirve como evidencia de que no hubo escritura. |
| Front `grupos-data.service.ts:1006` | `registrarCambiosBitacora` envía valores anterior/nuevo fabricados en cliente y no comprueba booleanos. |
| Front `src/app/services/log.service.ts:40` | Único método de envío público identificado; el catch termina sin devolver ni lanzar el error. |
| Front `src/app/services/db.service.ts:75` | La extracción/normalización puede reducir errores GraphQL a texto y arroja error de datos vacíos. No permite inferir atomicidad ni rollback. |
| Back `src/graphql/schema/mensajes.schema.graphql:20` | Expone `guardarBitacora` como Query con usuario y valores arbitrarios. |
| Back `src/graphql/resolvers/queryMensajes.ts:53` | Autentica y exige mismo usuario, pero delega los demás valores sin derivarlos de un cambio servidor. |
| Back `src/clases/Log.ts:136` | Método interno de inserción compartido; no se debe inutilizar para cerrar la ruta pública. |
| Back `src/clases/Grupos.ts:1277` | Guardado Oracle agregado llama internamente a Log después de la transacción. Preservar llamada; atomicidad pendiente de fases posteriores. |
| Back `src/clases/Grupos.ts:1627` | `revisarGrupoPlaneacion` llama internamente a Log después de su transacción. No forma parte del comando parcial v1. |
| Back `src/clases/Grupos.ts:918–1048` | MSSQL agregado construye bitácora dentro de su SQL transaccional. No depende del resolver público. |
| Back `src/graphql/resolvers/queryGrupos.ts:368` | `guardarGrupo` recibe todavía `cambiosBitacora` del cliente. Cerrar el endpoint separado no elimina esta deuda. |

El censo cubre el código local de `src` en Front/Back y scripts de Back. No
demuestra ausencia de clientes desplegados antiguos ni consumidores externos.

## 3.1-A — Próximo cambio exacto, Front

**Objetivo:** una solicitud del editor al backend actual no puede convertirse
automáticamente en una segunda secuencia de escrituras legacy.

1. En `GruposDataService.guardarGrupoDBO`, conservar la llamada a
   `guardarGrupoUnificado` y la normalización de éxito. Ante rechazo, error de
   transporte, respuesta vacía o incompatibilidad de schema, propagar el error;
   no llamar a `guardarGrupoLegacy` ni a `registrarCambiosBitacora`.
2. El backend actual inspeccionado expone `Mutation.guardarGrupo`; esa es la
   ruta admitida para este cliente. La incompatibilidad de un servidor antiguo
   produce error explícito, no una autorización deducida del mensaje para escribir
   por otras rutas. No agregar flags locales que permitan saltarse esta política.
3. Conservar por ahora los métodos/endpoints legacy y el censo para retiro
   controlado en Fase 8. Este bloque restringe la activación automática por error;
   no declara cero uso en servidores o clientes externos ni elimina sus contratos.
4. No cambiar `LogService` de forma aislada, no marcar guardado exitoso después
   de un error y no reintentar automáticamente la mutación agregada.
5. El error de red puede ser posterior al commit. La UI conserva la edición y
   comunica que no pudo confirmar el resultado; no afirma que nada se guardó.
   Antes de una nueva intención de guardado se debe recargar y reconciliar el
   estado. No se promete idempotencia en este flujo legacy agregado.

Archivo principal a modificar: `src/app/services/grupos-data.service.ts`.
Pruebas dedicadas a crear o integrar: `src/app/services/grupos-data.service.spec.ts`.
También modificar el manejo de error de
`src/app/components/editar-grupo/editar-grupo.component.ts`: la inspección de
`:104–138` encontró await seguido de publicación de éxito y un finally, sin
catch local. Agregar presentación de resultado no confirmado, conservar los
cambios pendientes y no emitir `grupoGuardado`, reset ni éxito en esa rama.
Antes de otro guardado, exigir la recarga/reconciliación indicada arriba.
Seguir las guías Angular del área que se intervenga; no ampliar el cambio a
la migración completa del editor.

La restricción del fallback es una medida de contención documentada en Fase 3,
no el retiro general de legacy de Fase 8. Preserva el camino legítimo actual
de guardado agregado. No promete compatibilidad de escritura con servidores
anteriores que carezcan de la mutación; esa compatibilidad necesitaría un
contrato específico de despliegue, no una inferencia del cliente.

## 3.1-B — Restricción Back, posterior a 3.1-A

1. Conservar autenticación en `queryMensajes.Query.guardarBitacora`, y rechazar
   cualquier intento de escritura pública, incluido administrador y mismo usuario,
   antes de instanciar/invocar Log o ejecutar SQL.
2. Usar `AppError` del proyecto con código estable
   `AUDITORIA_PUBLICA_NO_DISPONIBLE` y mensaje presentable. Es error de una ruta
   restringida legacy, no rechazo funcional confirmable del comando v1.
3. Conservar temporalmente la firma del schema, marcada deprecated, para que
   clientes viejos reciban rechazo reconocible. No devolver true/false de éxito
   ficticio ni agregar token/usuario interno elegible desde GraphQL.
4. Mantener `Log.guardarBitacora` como mecanismo interno usado por operaciones
   servidoras. No bloquear sus dos llamadas legítimas ni `bitacoraGrupo` de lectura.
5. No declarar resuelta la auditoría del agregado: aún acepta `cambiosBitacora`.
   La eliminación de autoridad cliente y la atomicidad por origen pertenecen a
   los handlers/fundaciones posteriores y conservan sus puertas de habilitación.

Rutas a modificar: `src/graphql/resolvers/queryMensajes.ts` y
`src/graphql/schema/mensajes.schema.graphql`. Prueba dedicada propuesta:
`pruebas/validate-bitacora-publica.ts`, con autenticación y persistencia simuladas,
sin tocar credenciales ni conectarse a una BD. Verificar el código GraphQL a
través del formateador real de errores, no solo llamando al método aislado.

## Casos de aceptación antes de integrar código

| Caso | Resultado exigido |
| --- | --- |
| Front: agregado devuelve grupo canónico | Una mutación; normalización/publicación existente conservada; ninguna llamada a auditoría pública. |
| Front: timeout, error de red o respuesta sin datos | Cero llamadas legacy posteriores; no reintento automático ni mensaje que afirme rollback. |
| Front: el editor recibe un rechazo de la promesa | Mantiene cambios pendientes, libera estaGrabando, muestra resultado no confirmado y no publica éxito/grupoGuardado. |
| Front: schema sin guardarGrupo o input incompatible | Error explícito; cero escrituras de fallback. |
| Front: cambiosBitacora vacío o ausente | Misma restricción; no sirve como excepción para activar fallback. |
| Back: autenticado como enlace o administrador, mismo usuario | Error AUDITORIA_PUBLICA_NO_DISPONIBLE; cero llamadas Log/SQL. |
| Back: no autenticado | Error de autenticación conservado; cero llamadas Log/SQL. |
| Back: lectura bitacoraGrupo | Autenticación y comportamiento de lectura existentes conservados. |
| Back: auditoría interna del agregado y revisarGrupoPlaneacion | No dependen del resolver público; llamadas internas permanecen ejecutables en pruebas simuladas. |
| Back: firma legacy aún expuesta | Deprecación y error verificables; no éxito silencioso. |

No bastan búsquedas de nombres o tests que solo repitan el código. Las pruebas
deben observar llamadas de transporte/SQL simuladas y demostrar que no se crea
una segunda escritura tras un fallo de resultado incierto.

## Orden de integración y despliegue

Implementar y revisar 3.1-A primero; después 3.1-B. Antes de desplegar la
restricción pública, verificar versión del backend agregado, entrega del Front
actualizado y censo de clientes activos. Una pestaña vieja puede seguir usando
fallback. Si no se puede asegurar su actualización, el despliegue queda pendiente
de una estrategia servidor que rechace esas rutas antes de escribir; no se
resuelve reabriendo auditoría arbitraria ni ocultando fallos posteriores.

Esta condición bloquea **despliegue**, no la preparación ni modificación local
del código ya descrito. No se han aprobado cambios en producción.

## Línea base y límites de esta preparación

Ramas: Back `master`, Front `chore/graphql-variables-refactor`. Solo aparecen
los contratos publicados y los documentos Front previos sin seguimiento.
No se modificó código ni se ejecutaron pruebas funcionales en esta preparación.

La línea base histórica de Fase 0 registra build Front OK; tests Front bloqueados
por zone.js/TS2322/caché; y validador Back con falla Oracle de rollback. No se
reprodujeron aquí y no se presentan como resultados actuales. El implementador
debe ejecutar los checks proporcionales al cambio, separar fallas previas de
regresiones y no dar por aprobada una prueba que no llegó a ejecutar sus casos.

Lectura complementaria: el agente Front confirmó fallback ambiguo y catch que
oculta errores, pero su revisión no llegó a dictamen final por falta de créditos
de ejecución; la revisión Back solicitada tampoco terminó. La preparación se
cierra con inspección directa y responsabilidad del orquestador, sin atribuirles
una aprobación que no emitieron. Esto no modifica sus ratificaciones previas
del contrato de Fase 2.

**Punto de reanudación:** abrir `siple-front`, comprobar estado y guías del área,
escribir los casos de regresión de 3.1-A y modificar `guardarGrupoDBO` según esta
secuencia. No hace falta otra ronda documental para empezar ese bloque.
