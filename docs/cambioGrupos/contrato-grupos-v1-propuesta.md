# Propuesta del contrato de cambios de grupos v1

Fecha: 2026-09-08. Estado: **revisado por Back y Front, aprobado por el
orquestador para fundaciones con reservas explícitas**. No es una API implementada.
El SDL exacto está en `contrato-grupos-v1-propuesta.graphql`.

La revisión vigente de horarios, rol de materias, PLA con delimitadores y
capacidades está en `resolucion-fronteras-v1.md`. Sus precisiones sustituyen
las reservas ambiguas del primer borrador. `horariosIdentificados` admite
`null` cuando el dominio no está disponible; `[]` significa vacío autoritativo.
La consulta incluye capacidades técnicas y las operaciones de materias exigen
`rol`. Estas son modificaciones anunciadas de la propuesta, aún no productivas.

## Anuncio del contrato

```text
CONTRATO ACTUALIZADO — V1 APROBADO PARA FUNDACIONES, NO HABILITADO
Módulo: grupos
Versión: v1
Tipo: GraphQL
Operación: grupoParaCambios / aplicarCambiosGrupo
Request: AplicarCambiosGrupoRequest; variables tipadas; sin datos de auditoría
Respuesta éxito: CambioGrupoAplicado con Grupo canónico y revisionGrupoNueva
Rechazo de negocio: CambioGrupoRechazado con errores y advertencias estructurados
Conflicto: CambioGrupoConflicto con Grupo canónico y revisionGrupoActual
Advertencias y confirmación: credencial opaca ligada a actor, objetivo, comando y revisión
Concurrencia: comparación atómica de revisionGrupoEsperada
Idempotencia: clave por actor y objetivo, ligada a la huella del request
Auditoría: valores calculados y persistidos exclusivamente por Backend
Permisos y alcance: matriz-reglas-permisos-v1.md
Impacto front: GrupoCambiosService; lectura versionada y discriminación por __typename
Compatibilidad/migración: aditivo; sin fallback; dominios se habilitan por fase
Fecha / responsable / aprobador: 2026-09-08 / revisión independiente Back y Front / Orquestador
```

## Evidencia y compatibilidad

Se inspeccionaron el schema `src/graphql/schema/grupo.schema.graphql`,
`src/modelos/Grupo.ts` y `src/clases/Grupos.ts` de Back, los inventarios de
Fase 0 y la matriz aprobada. Back está en `master` sin cambios locales;
Front en `chore/graphql-variables-refactor`, con documentos sin seguimiento
en `docs/guardarGrupos/`; no se modificaron esos archivos.

El schema vigente carece de revisión y de identidad estable de horarios.
Se propone una consulta nueva que entrega el grupo y su revisión desde la misma
lectura consistente. No se añade un campo obligatorio al tipo legacy `Grupo`.
Un objetivo inexistente devuelve `null`; autenticación y autorización de lectura
se verifican antes de revelar datos. Un conflicto tampoco expone un grupo fuera
del alcance de lectura del actor.

`Grupo` conserva su nulabilidad vigente. Los mensajes devueltos por las rutas v1
deben representar texto plano, incluido `POPUP`; Back deberá confirmar un
adaptador aislado para no cambiar las lecturas legacy. Fechas nuevas como
`venceEn` usan RFC 3339 UTC (`2026-09-08T18:30:00Z`). Las fechas legacy de `Grupo`
mantienen su formato actual y no sirven como revisión. No hay paginación nueva.

Las rutas v1 entregan DTO de edición aislados. Aunque reutilizan el tipo GraphQL
`Grupo`, no pasan por constructores, parsers de PLA, codificadores POPUP ni
serializadores legacy. Front usa transporte `no-cache` para consulta y mutación
v1, sin escribir estos resultados en la caché normalizada ni almacenes legacy.
Su estado se identifica por objetivo y revisión; una selección parcial no
reemplaza un grupo completo ni se combina con campos de otra revisión. Si una
edición requiere campos no seleccionados, recarga la instantánea v1 correspondiente.
El cambio aplicado puede invalidar lecturas legacy para que se recarguen con su
adaptador original, pero no les inyecta el DTO v1. Así se evita volver a cortar
PLA o codificar POPUP y se conserva el comportamiento de consumidores vigentes.

## Semántica de entradas

- `origen` admite únicamente `ORACLE` y `MSSQL`. `periodo` y `clave` son cadenas
  opacas no vacías del catálogo SIPLE; no se convierten a números ni se pierden
  ceros iniciales. Back resuelve y valida la identidad autoritativa.
- Un campo de patch omitido se conserva. Un `null` explícito se rechaza como
  `ENTRADA_INVALIDA`, salvo `datos.plantilla`, donde significa sin plantilla.
  En los campos condicionales se exige omisión cuando no son aplicables.
- `cambios` requiere al menos una operación efectiva solicitada. Objetos vacíos,
  listas vacías como único cambio y operaciones duplicadas sobre el mismo
  elemento se rechazan; no se interpretan como limpieza de una colección.
- Los cupos incluidos sustituyen únicamente su valor; los omitidos se toman del
  estado canónico. El mapeo de salida es `primerIngreso` → `cupoPrimerIngreso`,
  `reingreso` → `cupoReingreso`, `complementario` → `cupoComplementario`.
  Se evalúa el estado resultante completo con la matriz aprobada.
- Un comando que no produce diferencias devuelve `SIN_CAMBIOS` como rechazo
  tipado, sin nueva revisión ni bitácora de modificación. Semántica ratificada
  para el contrato; no implica que ya exista handler.
- `generales` contiene exclusivamente `tipo`, `idioma`, `liberable` y
  `contenido`, los campos emitidos por el editor actual. Exige `editarGrupos`
  y alcance según la matriz. `false` es un valor válido de `liberable`;
  `contenido: ""` solicita limpiar el contenido. Omitir conserva el valor.
  No envía `tipoAsistencia` ni `exigencia`: el editor inspeccionado no los edita.
  Sus valores canónicos deben conservarse al persistir otro dominio, junto con
  profesores, inscritos y otros datos no solicitados.

### Colecciones

| Dominio | Operación y datos exactos | Efecto |
| --- | --- | --- |
| Mensajes | `REEMPLAZAR`: tipo y texto obligatorios; `ELIMINAR`: solo tipo | Sustituye o elimina exclusivamente el tipo indicado; texto vacío no significa baja. |
| Modificadores | `agregar` y `quitar`, ambas listas obligatorias, al menos una no vacía | Opera códigos del catálogo; un código no puede aparecer en ambas. Backend deriva PB. |
| Horarios | `ALTA`: datos, sin asignacionId; `ACTUALIZACION`: asignacionId y datos completos | Crea o sustituye una sola asignación, nunca la colección. |
| Horarios | `BAJA`: solo asignacionId; `CAMBIO_ESPACIO`: asignacionId y claveEspacio | Elimina una asignación o cambia únicamente su espacio. |
| Planes | `ALTA`/`ACTUALIZACION`: programa, materia y cupo; `BAJA`: programa y materia | Identidad compuesta; `BAJA` devuelve `OPERACION_NO_DISPONIBLE` hasta contar con persistencia. |
| Materias | Siempre rol; `ALTA`/`BAJA`: materia; `REEMPLAZO`: materia y materiaNueva | Opera una relación identificada; principal queda reservada según `resolucion-fronteras-v1.md`. |

Las operaciones de actualización/baja requieren que exista la identidad;
una alta requiere que no exista. Las excepciones administrativas funcionales
siguen la matriz, pero no fabrican identidades ni convierten un fallo técnico
en éxito. La ausencia de soporte de una operación es indisponibilidad técnica.

`asignacionId` lo entrega y controla el servidor; no es un índice de arreglo
ni una clave fabricada por Front. Back debe demostrar estabilidad y unicidad en
ambos orígenes antes de habilitar horarios. Se usa hora `HH:mm` de 24 horas,
sin zona, inicio inclusivo y fin exclusivo dentro del día. `numDiaSemana` usa
1 = lunes, 2 = martes, 3 = miércoles, 4 = jueves, 5 = viernes, 6 = sábado,
7 = domingo, confirmado en `normalizaNumeroDiaSemana`. El mapeo de plantilla
debe ratificarse contra la persistencia antes de habilitar horarios: el helper legacy
admite coincidencias aproximadas y no demuestra una asignación exacta.

`datos` es una sustitución completa de una sola asignación para ALTA y
ACTUALIZACION. Dentro de ese objeto, omitir `plantilla` equivale a `null`
(sin plantilla); no conserva la anterior ni activa inferencia aproximada.
CAMBIO_ESPACIO conserva todos los demás campos, incluida la plantilla.

Los tipos actuales de mensajes son `PLA`, `INS`, `TIPO 3`, `POPUP` y `GPO`.
Se conserva `String!` para consultar el catálogo servidor sin inventar un alias
GraphQL para `TIPO 3`. El adaptador MSSQL inspeccionado no tiene un caso explícito
para ese tipo: requiere comprobación antes de habilitarlo.

`PLA` comparte persistencia con modificadores. La revisión del editor confirma
que el texto de planeación es la parte posterior al último `|`, mientras que
el prefijo contiene los modificadores. El contrato v1 trata `mensajes` de tipo
`PLA` como **solo el texto**, y `modificadores` como la colección de códigos.
No se prohíbe combinarlos en un comando: Backend aplica ambos al estado canónico
y recompone una sola escritura física después de validar PB y permisos.

- Cambiar o eliminar el texto `PLA` conserva los modificadores omitidos y PB.
- Cambiar modificadores conserva el texto omitido. Quitar PB requiere una
  operación explícita de modificadores; no puede producirse al borrar un mensaje.
- `ELIMINAR` de `PLA` limpia el texto lógico; si quedan modificadores, conserva
  el registro físico necesario para ellos. Audita el cambio lógico efectivo.
- El adaptador v1 no debe reutilizar `normalizaMensajesGrupo` sin corregir su
  comportamiento: hoy reemplaza el contenido de `PLA` por la cadena de códigos.
- La codificación legacy no representa sin ambigüedad cualquier texto con `|`.
  Antes de habilitar `PLA`, Back debe probar una codificación reversible para
  ese caso o devolver `OPERACION_NO_DISPONIBLE` sin perder texto ni códigos.
  No se permite recortar silenciosamente el texto ni interpretar texto como PB.

Esta separación conserva la edición simultánea que ya prepara Front y elimina
el rechazo provisional de `PLA` + modificadores del primer borrador. Es una
corrección ratificada en la revisión final del contrato.

## Advertencias, concurrencia e idempotencia

1. Back autentica y valida la identidad y el formato necesarios para buscar
   idempotencia. Verifica autorización actual para revelar el resultado y resuelve
   un request ya confirmado antes de comprobar disponibilidad actual, revisión
   antigua o vencimiento de las credenciales originales. Una clave reutilizada
   con otro request se rechaza. Solo una operación nueva pasa a autorización
   de escritura, disponibilidad y validación completa.
2. Carga el estado canónico, comprueba `revisionGrupoEsperada` y construye el
   estado candidato. Reglas funcionales se tratan según rol y matriz aprobada.
3. Si requiere confirmación devuelve `CambioGrupoRechazado`, con advertencias y
   sin escribir. Cada advertencia lleva un código estable para UX y una
   `confirmacion` opaca para enviar en `advertenciasConfirmadas`.
4. Cada credencial debe vincular, mediante registro servidor o firma, actor,
   objetivo, revisión, origen funcional, huella del cambio, código, vencimiento,
   efecto candidato y dependencias observadas que justifican la advertencia
   (por ejemplo inscritos, capacidad y ajustes derivados). La huella del cambio
   excluye confirmaciones e idempotencyKey. No basta un código libre reutilizable.
   Si cambia el efecto o una dependencia relevante, se emite una advertencia
   actualizada sin escribir; la confirmación anterior no autoriza ese resultado.
5. Front muestra el efecto y, tras confirmación explícita, envía el mismo cambio
   y revisión con las credenciales y una nueva clave de idempotencia. Modificar
   el cambio invalida las credenciales. Back revalida todas las reglas y permisos.
6. El commit incluye cambios, revisión, auditoría y resultado recuperable de
   idempotencia en el origen autoritativo. Una falla requerida revierte todo.

La credencial es el refinamiento ratificado de `[String!]!`; mantiene el tipo
pero sustituye el boceto de códigos simples. Front devuelve credenciales opacas
emitidas por Back y usa `codigo` únicamente para presentación de reglas.

La misma clave y request normalizado devuelven el resultado persistido sin repetir
escritura ni auditoría. Misma clave con otro request devuelve
`IDEMPOTENCIA_CLAVE_REUTILIZADA`. La huella de idempotencia sí incluye confirmaciones.
Back deberá fijar retención y tratamiento de solicitudes en curso en Fase 3.
Ante pérdida de respuesta o error de red, Front conserva y reenvía exactamente
request y clave; no genera otra clave. Un conflicto requiere recarga y decisión
del usuario; el siguiente comando usa la nueva revisión y una clave nueva.

La respuesta aplicada debe poder reconstruirse desde el resultado durable de la
transacción: no depender de una rehidratación externa después del commit.
No se habilita Oracle hasta demostrar esta garantía y auditoría atómica local;
un reflejo externo requiere el outbox previsto por el documento canónico.

La revisión cubre todos los cambios relevantes del agregado, incluidos writers
legacy y externos, no solo llamadas v1. Antes de habilitar un origen, Back debe
demostrar un mecanismo compartido (revisión mantenida por todos los writers,
triggers o comparación autoritativa equivalente bajo bloqueo) que detecte sus
cambios. Un contador aumentado solo por v1 no cumple el contrato. La comprobación
de revisión, reglas dependientes de estado y escritura deben cerrar la ventana
de carrera mediante transacción/bloqueos o comprobaciones condicionales en el
origen. Si hay writers no cubiertos, el origen permanece no disponible.

Rechazos, conflictos y advertencias son resultados terminales para esa clave;
la Fase 3 debe persistir su respuesta o un registro suficiente para reproducirla
sin iniciar una escritura con el mismo request. Una solicitud idéntica en curso
se serializa sobre la misma clave; no se ejecuta por segunda vez. El plazo exacto
de retención y espera es configuración que Back debe publicar antes de habilitar
el endpoint; al expirar el plazo de espera se produce fallo técnico recuperable,
sin declarar rollback si el resultado aún es desconocido. No se recicla una clave
confirmada como operación nueva tras purgar su respuesta: conservar evidencia
durable de uso o rechazarla como expirada evita duplicados tardíos.

## Resultados y códigos

`__typename` discrimina la unión. Las listas de errores/advertencias nunca son
null; un rechazo tiene al menos un error o advertencia. `campo` identifica el
campo lógico; `ruta` usa una ruta como `cambios.mensajes[0].texto`. `detalles`
es una lista tipada de clave/valor textual, no JSON libre ni SQL interno.

| Código propuesto | Resultado |
| --- | --- |
| `ENTRADA_INVALIDA`, `CAMBIOS_INCOMPATIBLES`, `SIN_CAMBIOS` | Rechazo de estructura semántica o ausencia de diferencias. |
| `PERMISO_INSUFICIENTE`, `FUERA_DE_ALCANCE` | Rechazo o advertencia administrativa según matriz. |
| `CUPO_INVALIDO`, `CUPO_MENOR_INSCRITOS`, `ESPACIO_INCOMPATIBLE`, `HORARIO_COLISION`, `CATALOGO_INVALIDO` | Rechazo o advertencia funcional según matriz y rol. |
| `OPERACION_NO_DISPONIBLE`, `GRUPO_NO_EXISTE` | Rechazo; no simula persistencia. |
| `CONFIRMACION_INVALIDA`, `IDEMPOTENCIA_CLAVE_REUTILIZADA` | Rechazo sin escritura. |
| `CONFLICTO_REVISION_GRUPO` | Conflicto con estado y revisión actuales, previa autorización de lectura. |

Errores de coerción GraphQL se devuelven antes del handler. Autenticación y
fallas técnicas usan `errors` de GraphQL; nunca se convierten en advertencias.
Mensajes son presentables al usuario; Front decide el comportamiento con códigos.
`auditoriaId` identifica la operación auditada que agrupa todos sus cambios
efectivos, incluidos ajustes confirmados; no es un dato que envíe Front.

## Ejemplos de transporte

Estos ejemplos son fixtures ilustrativos, no respuestas de un servidor activo.

```graphql
mutation CambiarGrupo($request: AplicarCambiosGrupoRequest!) {
  aplicarCambiosGrupo(request: $request) {
    __typename
    ... on CambioGrupoAplicado {
      grupo { llaveUnica cupoGeneral }
      revisionGrupoNueva
      auditoriaId
      advertenciasAplicadas { codigo confirmacion }
    }
    ... on CambioGrupoRechazado {
      errores { codigo campo ruta mensaje detalles { clave valor } }
      advertencias { codigo mensaje confirmacion venceEn }
    }
    ... on CambioGrupoConflicto {
      codigo mensaje revisionGrupoActual
      grupoActual { llaveUnica cupoGeneral }
    }
  }
}
```

Variables (identidades ilustrativas; revisión previamente obtenida del servidor):

```json
{"request":{"objetivo":{"origen":"ORACLE","periodo":"2026-2","clave":"GRUPO-EJEMPLO"},"revisionGrupoEsperada":"rev-17","origenOperacion":"CAMBIO_RAPIDO","cambios":{"cupos":{"cupoGeneral":30}},"advertenciasConfirmadas":[],"idempotencyKey":"ejemplo-cupo-001"}}
```

Éxito, suponiendo distribuciones e inscritos compatibles:

```json
{"data":{"aplicarCambiosGrupo":{"__typename":"CambioGrupoAplicado","grupo":{"llaveUnica":"grupo-ejemplo","cupoGeneral":30},"revisionGrupoNueva":"rev-18","auditoriaId":"auditoria-ejemplo","advertenciasAplicadas":[]}}}
```

Rechazo para enlace, suponiendo 35 inscritos:

```json
{"data":{"aplicarCambiosGrupo":{"__typename":"CambioGrupoRechazado","errores":[{"codigo":"CUPO_MENOR_INSCRITOS","campo":"cupoGeneral","ruta":"cambios.cupos.cupoGeneral","mensaje":"El cupo es menor que los alumnos inscritos.","detalles":[{"clave":"inscritos","valor":"35"}]}],"advertencias":[]}}}
```

Conflicto, suponiendo que otro comando ya cambió el grupo:

```json
{"data":{"aplicarCambiosGrupo":{"__typename":"CambioGrupoConflicto","codigo":"CONFLICTO_REVISION_GRUPO","mensaje":"El grupo cambió desde la lectura.","revisionGrupoActual":"rev-19","grupoActual":{"llaveUnica":"grupo-ejemplo","cupoGeneral":40}}}}
```

Una advertencia administrativa usa el mismo resultado rechazado con `errores: []`
y la advertencia `CUPO_MENOR_INSCRITOS`; Front presenta mensaje, inscritos y
efecto del cambio antes de reenviar su credencial. El valor concreto de esa
credencial siempre lo obtiene del servidor; no lo construye del código.

## Alcance reservado y puerta de implementación

La reserva masiva define request, no una mutación ejecutable: mismo origen y
periodo, objetivos únicos, revisión por objetivo y solo `TODO_O_NADA`. Su respuesta
por objetivo se formalizará antes de Fase 7. El comando unitario no puede usarse
en un ciclo para simular un lote atómico ni un intercambio entre grupos.

Back y Front ratificaron la representabilidad y las reservas después de revisión
independiente del código. `revision-aprobacion-v1.md` registra dictámenes,
correcciones y evidencia. La aprobación permite iniciar Fase 3; no declara
disponible ningún dominio ni permite conectar consumidores a una API inexistente.

Antes de habilitar cada operación, el responsable de su fase debe demostrar:

1. Revisión compartida con writers legacy, autorización y alcance, idempotencia
   durable, reglas, confirmaciones y commit atómico en el origen.
2. Para PLA/modificadores: adaptación reversible sin perder texto o PB. Casos
   ambiguos y tipos de mensaje sin soporte por origen siguen no disponibles.
3. Para horarios: identidad durable y cobertura completa de sesiones, plantilla
   y pruebas de concurrencia con todas las ocupaciones relevantes.
4. Para materias/principal e intercambios: políticas de relaciones y ajustes
   aprobadas, sin eliminar planes ni modificar otro grupo por inferencia.
5. Consumo Front con lectura versionada, estado aislado, manejo de todos los
   resultados y regresión proporcional de las pantallas migradas.

Toda ampliación de una reserva exige reabrir el punto de control del contrato
antes de cambiar su semántica. La disponibilidad se aprueba por fase/origen.

Validación ejecutada: `node docs/cambioGrupos/validar-propuesta-v1.cjs` — **OK**.
El SDL se integró con el schema actual usando las dependencias locales de Back;
se validaron la operación GraphQL, la coerción de variables, cuatro bloques JSON,
los campos superiores de sus resultados y la codificación UTF-8. Es validación
estática; no demuestra ejecución de resolvers, reglas funcionales ni atomicidad.
