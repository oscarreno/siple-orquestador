# Especificación técnica: edición de espacios de grupo

**Estado:** implementado en Back y Front el 2026-09-28; pendiente de pruebas integradas en ambiente. La persistencia usa guardado legacy completo.

**Fuente funcional:** [especificación funcional](./especificacion-funcional.md).

**Decisiones funcionales ya aprobadas:** [contrato técnico de trabajo](./contrato-tecnico-propuesto.md), sección 4.

## 1. Objetivo técnico

Incorporar una pestaña `Espacios` al editor de grupo para que el usuario pueda buscar opciones, elegir una propuesta y guardarla junto con los cambios compatibles de la misma edición. La operación puede mover una o varias sesiones del grupo origen; si es un intercambio, mueve de forma recíproca todas las sesiones de un segundo grupo.

La búsqueda no persiste cambios. La persistencia usa explícitamente el mecanismo legacy de guardado completo: Back materializa el estado final de cada grupo afectado y lo entrega al flujo legacy correspondiente. El Front nunca resuelve disponibilidad, autorización ni la contraparte de un intercambio.

La ruta atómica por componentes queda descartada para esta funcionalidad. No se habilita una mezcla de llamadas atomizadas y legacy para guardar espacios. En intercambios, los snapshots completos se guardan en secuencia y existe riesgo aceptado de resultado parcial si falla la segunda escritura.

## 2. Estado comprobado del código actual

| Hecho | Evidencia | Consecuencia |
| --- | --- | --- |
| El contrato v1 ya define `GrupoParaCambios.horariosIdentificados` y `asignacionId`. | `siple-backTS/src/graphql/schema/grupos-v1.schema.graphql` | Es la identidad prevista para una sesión; no se usará índice de arreglo. |
| Back entrega `horariosIdentificados` deterministas por grupo y sesión; si hay claves de sesión duplicadas, devuelve null. | `siple-backTS/src/graphql/resolvers/grupoCambiosV1.ts` | La edición bloquea los casos ambiguos; Front nunca deriva IDs a partir del índice. |
| Las capacidades v1 de `HORARIOS` están deshabilitadas. | Mismo resolver. | El Front no debe exponer escritura basándose en `aplicarCambiosGrupo` actual. |
| Oracle recrea horarios con `SIPF1_ALTAGRUPO2` + `SIPF1_ALTAHORARIO`. | Revisión de SP y `Grupos.ts`. | Es la ruta legacy que se conservará. El primero borra y confirma; el segundo inserta y confirma por defecto, por lo que no se presenta como guardado atómico. |
| MSSQL reemplaza `GrupoHorario` dentro de una transacción, pero para un grupo por llamada. | `guardarGrupoMSSQLAgregado` en `Grupos.ts`. | Puede reutilizarse como guardado legacy de un snapshot completo; un intercambio requiere una orquestación de dos snapshots. |

El código implementa búsqueda, validación y guardado legacy para ORACLE y MSSQL. La implementación aún requiere pruebas integradas en cada origen; no debe confundirse “conectado en código” con “probado en ambiente”.

## 3. Responsabilidades

| Capa | Responsabilidad |
| --- | --- |
| Front | Carga lectura versionada, muestra sesiones/opciones, conserva una propuesta pendiente, solicita confirmaciones y refresca resultados canónicos. No decide permisos ni disponibilidad. |
| Back | Autoriza, compone propuestas, emite identificadores opacos, revalida al guardar, coordina todos los grupos afectados, registra auditoría e inicia notificación posterior. |
| Fuente de datos | Aporta grupos, reservas, espacios, capacidad, alumnos inscritos y catálogos. No se presume equivalencia entre Oracle y MSSQL. |

El actor autenticado se obtiene del contexto de sesión. No se acepta un usuario, rol, departamento, capacidad ni estado PB declarados por el cliente como fuente de verdad.

## 4. Modelo técnico

### 4.1 Identidad de sesión

`asignacionId` es una identidad opaca determinista emitida por Back para una sesión dentro de la revisión leída. Se calcula desde origen, periodo, grupo y datos normalizados de esa sesión; no es una clave primaria persistida y cambia si cambia la sesión. Si dos horarios producen la misma clave normalizada, la lectura no ofrece IDs.

No son identidades válidas:

- la posición de una sesión en `grupo.horarios`;
- una concatenación fabricada por Front;
- solo día/hora/espacio;
- la plantilla como heurística.

En un intercambio, Back empareja sesiones de forma uno-a-uno por día, hora de inicio y hora final exactas. Si el emparejamiento es ambiguo, falta un `asignacionId`, o no coincide la totalidad de sesiones, no se ofrece el intercambio. La plantilla no desempata silenciosamente.

### 4.2 Estado PB

La búsqueda recibe el estado PB **final propuesto** para el grupo origen, no solo el valor del checkbox aislado. El Front lo deriva del editor completo, incluidos los cambios pendientes de generales/modificadores.

El Back compara ese valor con el estado canónico, valida que el actor pueda solicitarlo y lo vuelve a validar al guardar. Si la representación persistente de PB no puede incluirse en el mismo flujo legacy completo de la propuesta, la operación se declara no disponible para ese origen/caso.

### 4.3 Identidad de búsqueda y propuesta

`busquedaId` es un identificador opaco emitido por Back. Queda ligado a:

- actor autenticado;
- origen, periodo y grupo origen;
- revisión del grupo origen;
- conjunto seleccionado de `asignacionId`;
- modo, `mismoEspacio` y estado PB final;
- revisiones de las contrapartes incluidas, cuando aplique;
- opciones devueltas y vencimiento.

En la implementación actual, Back guarda la propuesta en memoria por diez minutos, ligada al actor y a las revisiones. No es durable: reiniciar el Back invalida las búsquedas activas. El Front no inspecciona ni fabrica su contenido.

En el modo de intercambio, `familiaIntercambioId` agrupa opciones que pertenecen al mismo intercambio completo. El Front no puede combinar una opción de una familia con otra. En espacios libres, las opciones se pueden seleccionar por sesión, pero Back valida la combinación final.

## 5. Contrato GraphQL propuesto

Los nombres siguientes son parte de esta propuesta. Se agregan al esquema v1; no cambian las consultas ni mutaciones legacy existentes.

```graphql
enum ModoBusquedaEspaciosGrupo {
  ESPACIOS_LIBRES
  INCLUIR_INTERCAMBIOS
}

input BuscarPropuestasEspacioGrupoInput {
  objetivo: GrupoRefInput!
  revisionGrupoEsperada: String!
  asignacionesSeleccionadas: [ID!]!
  modo: ModoBusquedaEspaciosGrupo!
  mismoEspacio: Boolean!
  pbOrigenFinal: Boolean!
}

type SesionPropuestaEspacio {
  asignacionId: ID!
  plantilla: String
  numDiaSemana: Int!
  horaInicio: String!
  horaFin: String!
  espacioActual: EspacioPropuesta!
  opciones: [OpcionPropuestaEspacio!]!
}

type EspacioPropuesta {
  clave: String!
  capacidad: Int
  tipo: String
}

type GrupoContrapartePropuesta {
  origen: OrigenDatosGrupo!
  periodo: String!
  clave: String!
  materiaClave: String
  materiaNombre: String
  pb: Boolean!
}

type OpcionPropuestaEspacio {
  opcionId: ID!
  espacioDestino: EspacioPropuesta!
  condicion: String! # LIBRE o INTERCAMBIO
  familiaIntercambioId: ID
  contraparte: GrupoContrapartePropuesta
  info: [DetalleReglaGrupo!]!
}

type BusquedaPropuestasEspacioDisponible {
  busquedaId: ID!
  venceEn: String!
  objetivo: GrupoRef!
  revisionGrupoActual: String!
  sesiones: [SesionPropuestaEspacio!]!
}

type BusquedaPropuestasEspacioConflicto {
  codigo: String!
  mensaje: String!
  grupoActual: Grupo!
  revisionGrupoActual: String!
}

type BusquedaPropuestasEspacioRechazada {
  errores: [ErrorReglaGrupo!]!
}

union BuscarPropuestasEspacioGrupoResultado =
    BusquedaPropuestasEspacioDisponible
  | BusquedaPropuestasEspacioConflicto
  | BusquedaPropuestasEspacioRechazada

input SeleccionPropuestaEspacioInput {
  busquedaId: ID
  opcionesSeleccionadas: [ID!]
  seleccionesPorSesion: [SeleccionSesionPropuestaEspacioInput!]
}

input SeleccionSesionPropuestaEspacioInput {
  asignacionId: ID!
  busquedaId: ID!
  opcionId: ID!
}

input AplicarCambioEspaciosGrupoRequest {
  objetivo: GrupoRefInput!
  revisionGrupoEsperada: String!
  seleccion: SeleccionPropuestaEspacioInput!
  cambiosOrigen: CambiosGrupoInput
  advertenciasConfirmadas: [String!]!
  idempotencyKey: String!
}

type GrupoAfectadoCambioEspacios {
  objetivo: GrupoRef!
  grupo: Grupo!
  revisionGrupoNueva: String!
  sesionesCambiadas: [HorarioIdentificadoGrupo!]!
  cuposAjustados: Boolean!
  auditoriaId: ID!
}

enum EstadoNotificacionCambioEspacios {
  SIN_NOTIFICACION
  PENDIENTE
  ENCOLADA
}

type CambioEspaciosAplicado {
  gruposAfectados: [GrupoAfectadoCambioEspacios!]!
  advertenciasAplicadas: [AdvertenciaGrupo!]!
  estadoNotificacion: EstadoNotificacionCambioEspacios!
}

type CambioEspaciosRechazado {
  errores: [ErrorReglaGrupo!]!
  advertencias: [AdvertenciaGrupo!]!
}

type CambioEspaciosConflicto {
  codigo: String!
  mensaje: String!
  gruposActuales: [GrupoAfectadoCambioEspacios!]!
}

union AplicarCambioEspaciosGrupoResultado =
    CambioEspaciosAplicado
  | CambioEspaciosRechazado
  | CambioEspaciosConflicto

extend type Query {
  buscarPropuestasEspacioGrupo(
    request: BuscarPropuestasEspacioGrupoInput!
  ): BuscarPropuestasEspacioGrupoResultado!
}

extend type Mutation {
  aplicarCambioEspaciosGrupo(
    request: AplicarCambioEspaciosGrupoRequest!
  ): AplicarCambioEspaciosGrupoResultado!
}
```

`CambiosGrupoInput` en `cambiosOrigen` no acepta `horarios`: las sesiones que se mueven provienen exclusivamente de `busquedaId` y de las opciones seleccionadas. Back rechaza antes de escribir cualquier dominio que no pueda coordinar en la misma unidad con los espacios.

### 5.1 Consulta: ejemplo de request

```graphql
query BuscarEspacios($request: BuscarPropuestasEspacioGrupoInput!) {
  buscarPropuestasEspacioGrupo(request: $request) {
    __typename
    ... on BusquedaPropuestasEspacioDisponible {
      busquedaId
      venceEn
      revisionGrupoActual
      sesiones {
        asignacionId
        numDiaSemana
        horaInicio
        horaFin
        espacioActual { clave capacidad }
        opciones {
          opcionId
          condicion
          familiaIntercambioId
          espacioDestino { clave capacidad tipo }
          contraparte { clave periodo materiaClave pb }
          info { clave valor }
        }
      }
    }
    ... on BusquedaPropuestasEspacioRechazada {
      errores { codigo regla ruta mensaje detalles { clave valor } }
    }
    ... on BusquedaPropuestasEspacioConflicto {
      codigo
      mensaje
      revisionGrupoActual
    }
  }
}
```

```json
{
  "request": {
    "objetivo": { "origen": "MSSQL", "periodo": "O2026", "clave": "A01" },
    "revisionGrupoEsperada": "revision-leida",
    "asignacionesSeleccionadas": ["852", "853"],
    "modo": "ESPACIOS_LIBRES",
    "mismoEspacio": true,
    "pbOrigenFinal": false
  }
}
```

Una búsqueda válida sin candidatos se expresa como `BusquedaPropuestasEspacioDisponible` con las sesiones solicitadas y `opciones: []` donde corresponda. No es error técnico ni permiso denegado; el Front muestra el estado vacío y deshabilita Guardar.

### 5.2 Mutación: ejemplo de request

```graphql
mutation AplicarCambioEspacios($request: AplicarCambioEspaciosGrupoRequest!) {
  aplicarCambioEspaciosGrupo(request: $request) {
    __typename
    ... on CambioEspaciosAplicado {
      estadoNotificacion
      gruposAfectados {
        objetivo { origen periodo clave }
        revisionGrupoNueva
        cuposAjustados
      }
    }
    ... on CambioEspaciosRechazado {
      errores { codigo regla ruta mensaje detalles { clave valor } }
      advertencias { codigo mensaje confirmacion venceEn }
    }
    ... on CambioEspaciosConflicto {
      codigo
      mensaje
    }
  }
}
```

```json
{
  "request": {
    "objetivo": { "origen": "MSSQL", "periodo": "O2026", "clave": "A01" },
    "revisionGrupoEsperada": "revision-leida",
    "seleccion": {
      "busquedaId": "opaco-del-back",
      "seleccionesPorSesion": [
        { "asignacionId": "sesion-lu", "busquedaId": "busqueda-salon", "opcionId": "opcion-852" },
        { "asignacionId": "sesion-ju", "busquedaId": "busqueda-laboratorio", "opcionId": "opcion-853" }
      ]
    },
    "cambiosOrigen": {
      "cupos": { "cupoGeneral": 25, "primerIngreso": 10, "reingreso": 15, "complementario": 0 }
    },
    "advertenciasConfirmadas": [],
    "idempotencyKey": "uuid-generado-por-front"
  }
}
```

El Front reutiliza la misma `idempotencyKey` solo al reintentar exactamente el mismo request por una falla de transporte. Si cambia selección, revisión, confirmaciones o cambios origen, genera otra clave.

## 6. Reglas de resolver

### 6.1 `buscarPropuestasEspacioGrupo`

1. Autenticar actor y verificar que puede leer/editar el grupo origen.
2. Cargar el grupo canónico y comparar `revisionGrupoEsperada`. Si difiere, devolver conflicto sin revelar contrapartes.
3. Comprobar que `asignacionesSeleccionadas` es un conjunto no vacío, sin duplicados y contenido en la lectura actual.
4. Validar ventana, departamento y permisos de enlace; administrador conserva las excepciones funcionales aprobadas.
5. Si `modo = INCLUIR_INTERCAMBIOS`, exigir que estén seleccionadas todas las sesiones del grupo origen. Si no, rechazar con `INTERCAMBIO_SESIONES_INCOMPLETAS`.
6. Resolver destinos físicos/virtuales, vigencia, estatus, disponibilidad exacta y capacidad desde Back. Las reglas para enlace filtran antes de devolver opciones; las advertencias administrativas se incluyen en `info`, sin autorizar el guardado todavía.
7. Con `mismoEspacio = true`, conservar únicamente claves destino compatibles con todas las sesiones seleccionadas del grupo origen. Un intercambio que deje al origen en claves distintas se excluye de la respuesta.
8. Para intercambio, comprobar coincidencia total y emparejamiento único entre ambos grupos; emitir una misma `familiaIntercambioId` en todas sus opciones asociadas.
9. Emitir `busquedaId` con vencimiento. No reservar espacios durante la búsqueda ni modificar PB/cupos.

La lectura Oracle agrupa los horarios solicitados en una consulta por bloque de hasta 800 espacios únicos, usa rangos de fecha sobre `FECHAHORAINICIAL` y devuelve ocupaciones distintas. Back conserva la identidad de las ocupaciones para resolver libres e intercambios y agrupa las reservas por espacio/día. Las pruebas y la medición del 2026-10-02 están en [Optimización de búsqueda Oracle](./optimizacion-busqueda-oracle.md); la validación integrada del editor y del guardado sigue pendiente.

### 6.2 `aplicarCambioEspaciosGrupo`

1. Autenticar actor, validar forma, idempotencia y vínculo de `busquedaId`.
2. Cargar nuevamente todos los grupos y reservas participantes. Verificar revisiones, selección, opciones, disponibilidad, permisos, ventana, PB, capacidad y cupos resultantes.
3. Verificar que la selección contiene exactamente una opción por sesión solicitada. Para intercambio, todas las opciones deben pertenecer a una sola `familiaIntercambioId` y representar el intercambio completo.
4. Si hay advertencia administrativa válida, devolver `CambioEspaciosRechazado` con `advertencias` y sin escribir. Una segunda llamada solo procede con la confirmación opaca vigente, ligada al actor, request y revisiones.
5. Antes de iniciar escritura, construir y validar el snapshot completo resultante de cada grupo afectado: encabezado, horarios, mensajes, planes y demás datos que el guardado legacy requiere conservar. Si falta un dato necesario o el origen no tiene ruta legacy soportada, rechazar antes de escribir.
6. Ejecutar el guardado legacy correspondiente para cada snapshot. Para un solo grupo se reutiliza su flujo histórico completo; para intercambio, Back debe orquestar los snapshots de origen y contraparte y comprobar por relectura el estado final de ambos.
7. Releer estado canónico, calcular revisiones nuevas y persistir una intención durable de notificación antes de confirmar el resultado de negocio.
8. Devolver todos los grupos afectados. La entrega de correo ocurre después del commit y no altera el éxito del cambio confirmado.

## 7. Reglas Front

### 7.1 Carga

- Abrir el editor con `grupoParaCambios` en modo `no-cache` y conservar `revisionGrupoActual` junto con `horariosIdentificados`.
- Si `horariosIdentificados` es `null` o la capacidad de edición de espacios no está habilitada, mostrar la pestaña como no disponible. No derivar IDs de `grupo.horarios`.
- Seleccionar inicialmente todas las sesiones identificadas.
- Mostrar PB canónico y calcular `pbOrigenFinal` a partir del estado pendiente de toda la edición.

### 7.2 Búsqueda y selección

- `Buscar` solo está habilitado con sesiones seleccionadas y una lectura válida.
- Cambiar la selección invalida la propuesta activa y puede iniciar una búsqueda automática. La elección previa de cada sesión conserva su propio `busquedaId`; al guardar, `seleccionesPorSesion` permite combinar búsquedas vigentes del mismo grupo y revisión. Las opciones de sesiones desmarcadas no se guardan automáticamente: el Front pregunta si deben marcarse e incluirse.
- Con `mismoEspacio`, vincular dropdowns solo con opciones que comparten la misma clave. Si alguna sesión queda sin esa opción, la propuesta es inválida.
- Al elegir una opción de intercambio, seleccionar automáticamente las opciones de la misma `familiaIntercambioId` para todas las sesiones. No permitir mezcla de familias ni selección parcial.
- Si una sesión queda sin opción válida, bloquear el Guardar general y marcar el renglón; no mandar un request incompleto al Back.

### 7.3 Guardado y respuesta

- Integrar la selección de espacios al comando general de Guardar, no lanzar una escritura durante la búsqueda.
- Al recibir `CambioEspaciosAplicado`, reemplazar el estado local de **todos** los grupos devueltos o invalidar sus cachés para recargarlos; no modificar el estado con una inferencia local.
- En conflicto, descartar propuesta y solicitar una nueva lectura/búsqueda. En rechazo, mantener la edición no aplicada y mostrar el mensaje de negocio. En confirmación requerida, mostrar el efecto para cada grupo y reenviar solo después de confirmación explícita.
- `estadoNotificacion = PENDIENTE` o `ENCOLADA` se comunica como “Cambio guardado; notificación en proceso”. Nunca como error de guardado ni con opción de repetir la mutación.

### 7.4 Presentación de resultados

- Cada opción muestra la clave, el tipo de espacio, la capacidad y la condición de ocupación devuelta por Back (`LIBRE` o `INTERCAMBIO`, incluyendo la contraparte cuando aplique).
- Las opciones se ordenan alfabéticamente por clave, con orden natural para claves que incluyan números.
- En la búsqueda de personas no administradoras, Back solo ofrece destinos cuyo tipo coincida con el tipo del espacio de origen. La misma regla se valida al guardar. Administrador/DSE conserva la posibilidad de elegir otro tipo.
- Oracle obtiene el nombre de tipo desde `V_SIPF1_TIPOESPACIO`; la vista de espacios no expone el ID de tipo, por lo que el catálogo se enlaza por el nombre de tipo.

## 8. Códigos de negocio mínimos

| Código | Momento | Efecto Front |
| --- | --- | --- |
| `REVISION_CONFLICTO` | búsqueda o guardado | Recargar grupo y realizar nueva búsqueda. |
| `INTERCAMBIO_SESIONES_INCOMPLETAS` | búsqueda | Pedir seleccionar todas las sesiones para usar intercambio. |
| `INTERCAMBIO_NO_CORRESPONDENCIA_UNICA` | búsqueda | Mostrar que no hay intercambio elegible; no inventar emparejamiento. |
| `VENTANA_ESPACIOS_CERRADA` | búsqueda/guardado | Informar que el enlace no puede gestionar cambios en ese periodo. |
| `ESPACIO_SIN_PERMISO` | búsqueda/guardado | Informar la restricción de departamento/espacio. |
| `ESPACIO_NO_DISPONIBLE` | guardado | Invalidar propuesta y pedir nueva búsqueda. |
| `PB_RESTRINGIDO_ENLACE` | búsqueda/guardado | Bloquear cambio para enlace. |
| `CAPACIDAD_INSUFICIENTE` | guardado | Rechazar enlace o producir advertencia confirmable para administrador. |
| `RUTA_LEGACY_NO_DISPONIBLE` | guardado | Informar que el origen no tiene el guardado legacy necesario para esa propuesta; no iniciar escrituras parciales. |
| `PROPUESTA_VENCIDA` | guardado | Realizar nueva búsqueda. |
| `SELECCION_PROPUESTA_INVALIDA` | guardado | Descartar selección local y realizar nueva búsqueda. |

Los códigos se devuelven mediante `ErrorReglaGrupo.codigo`; `regla` identifica la regla de negocio y `detalles` aporta grupos, sesiones, capacidad o espacios, sin exponer información fuera del alcance del actor.

## 9. Cupos y capacidad implementados

Back calcula `capacidadLimite` usando todos los horarios físicos del snapshot final de cada grupo, incluidas las sesiones que no se seleccionaron para buscar. `cupoGeneral` adopta siempre la capacidad mínima de esos espacios, suba o baje y sin importar el tipo. Todo delta aplicado a `cupoGeneral` se traslada por la misma cantidad, positiva o negativa, a `cupoReingreso`, tomando como base los cupos que trae el snapshot propuesto antes del ajuste.

El snapshot resultante mantiene `cupoPrimerIngreso <= cupoGeneral`, `cupoReingreso <= cupoGeneral`, `cupoComplementario <= cupoGeneral`, `cupoComplementario <= cupoReingreso` y `cupoPrimerIngreso + cupoReingreso >= cupoGeneral`. El cupo complementario se reduce hasta el nuevo RE cuando hace falta; los cupos que excedan CG también se reducen. `cupoMaximo` continúa acotado por la capacidad mínima. Si el delta deja RE negativo o el resultado no cumple todas las reglas, Back rechaza antes de escribir.

Back aplica automáticamente cualquier ajuste de cupos derivado de la capacidad de los espacios, tanto al subir como al bajar, sin autorización por rol. La restricción de Enlaces para reducir cupos manualmente corresponde al Front. Para Enlaces, capacidad menor a inscritos rechaza antes de escribir. Aplica por separado al origen y a la contraparte; si falta la capacidad de algún espacio, Back rechaza la propuesta.

## 10. Persistencia legacy, auditoría y notificación

### 10.1 Estrategia de persistencia

La estrategia acordada para espacios es legacy; no existe una decisión dinámica de “intentar atómico y caer a legacy”. El preflight comprueba que puede armar el snapshot completo antes de comenzar:

```text
¿Back tiene el estado completo de todos los grupos afectados y una ruta legacy soportada?
  Sí → materializar los snapshots finales y ejecutar el guardado legacy.
  No → rechazar antes de escribir con RUTA_LEGACY_NO_DISPONIBLE.
```

En Oracle, `SIPF1_ALTAGRUPO2` borra detalles y `SIPF1_ALTAHORARIO` los repone; ambos pueden confirmar internamente. Por ello el Back debe enviar el snapshot íntegro: horarios, mensajes y planes que deban conservarse, además del encabezado. La conservación completa ya es una regla del flujo legacy y no se omiten detalles aunque no hayan cambiado.

En MSSQL, el snapshot completo se guarda mediante el flujo histórico que reemplaza `GrupoHorario` dentro de su transacción. El intercambio guarda un grupo por llamada, secuencialmente. Si falla una escritura, Back relee cada grupo y devuelve `CambioEspaciosParcial`; el resultado no se presenta como atómico y no se reintenta automáticamente.

### 10.2 Auditoría

Cada grupo afectado registra una bitácora con: propuesta/origen de operación, sesiones anteriores y resultantes, espacios previos/nuevos, capacidad considerada, cupos previos/resultantes, PB previo/resultante, usuario, fecha y grupos vinculados. Las bitácoras solo se confirman con la operación completa.

### 10.3 Notificación

La notificación se genera solo para cambios confirmados. Debe llegar a profesores y alumnos de cada grupo afectado, con sesiones y espacios previos/resultantes.

La implementación registra notificaciones en la tabla institucional `Notificaciones` después de confirmar los guardados; se aprovecha el proceso ya existente. La respuesta informa `ENCOLADA`, `PENDIENTE` o `SIN_NOTIFICACION`. No se agregó un outbox nuevo. Hay que verificar en ambiente que las filas insertadas sean procesadas y que la deduplicación existente funcione.

## 11. Validación y pruebas de aceptación técnica

Antes de habilitar cada origen:

1. Lectura entrega `asignacionId` no nulo, único y estable para cada sesión.
2. Búsqueda de espacios libres con una sesión y con varias sesiones; `mismoEspacio` filtra correctamente.
3. Búsqueda sin candidatos devuelve estado vacío, no error.
4. Búsqueda de intercambio solo aparece con todas las sesiones y correspondencia total/única.
5. Enlace fuera de ventana, sin permiso, con PB o con capacidad insuficiente es rechazado sin escritura.
6. Administrador recibe advertencia y requiere confirmación opaca antes de la excepción de PB/capacidad.
7. Cambio de varias sesiones libres conserva los horarios, mensajes y planes no modificados después del guardado legacy y devuelve la relectura canónica.
8. Intercambio A↔B materializa los dos snapshots completos, conserva sus detalles no modificados y devuelve la relectura de ambos grupos. Se prueba el manejo definido para falla después del primer guardado legacy antes de publicar la capacidad.
9. Repetir la misma mutación con la misma clave de idempotencia no duplica movimientos ni notificaciones.
10. Cambio confirmado con fallo de entrega de correo devuelve éxito de negocio y conserva notificación pendiente para reintento.

11. La apertura y cierre de la edición para Enlace/CSI puede cambiarse sin reiniciar el servicio; queda pendiente definir el mecanismo de administración, recarga, auditoría y aplicación a solicitudes nuevas.

**Excepción de persistencia de planes (acordada):** si falla el guardado de un plan compartido, ese fallo no aborta el guardado del grupo ni los movimientos restantes del intercambio. Back continúa el flujo legacy, informa en la respuesta qué plan no pudo persistirse y conserva el detalle técnico en el log. No debe convertir ese fallo aislado en `CambioEspaciosParcial` ni en un mensaje genérico de fallo total; los fallos de horarios/encabezado y la incertidumbre real de la escritura siguen el manejo parcial y la relectura descritos arriba. Esta tolerancia no cambia la ruta aprobada: espacios sigue usando exclusivamente el guardado legacy completo, sin selección dinámica ni fallback desde la ruta atómica.

## 12. Pruebas integradas pendientes

1. Movimiento libre de una y varias sesiones, verificando que se conserven horarios no seleccionados, mensajes y planes.
2. Intercambio recíproco en Oracle y MSSQL; inyectar una falla entre escrituras para comprobar el estado parcial, las lecturas y que no se repita automáticamente.
3. Conflictos de revisión, restricciones PB, ventana/departamento, capacidad y confirmación de advertencias.
4. Validar la fórmula de cupos incluida `cupoMaximo` con negocio y casos reales.
5. Confirmar notificación institucional, duplicados y visualización posterior del grupo en el Front.
6. Ejecutar build/pruebas de repositorios antes del despliegue.

### Verificador diagnóstico opcional

`EDICION_ESPACIOS_VERIFICAR_RESULTADO=SI` habilita una relectura final de solo horarios por grupo afectado, después del flujo normal, tanto en resultado aplicado como parcial. Compara espacios/sesiones esperados con los observados y reporta coincidencias, diferencias o imposibilidad de verificar en el log del Back. Está desactivado por defecto. No condiciona ni revierte escrituras, no altera el orden del intercambio ni la ruta legacy aprobada. Su lectura adicional es secuencial por grupo; usarlo principalmente durante pruebas.

## 13. Estado de salida

**Implementación en código terminada; validación integrada pendiente.** El Front conserva la opción y el `busquedaId` de cada sesión cuando cambia la selección y consulta otro tipo de espacio. Antes de guardar, usa un diálogo PrimeNG para ofrecer incluir las sesiones preparadas pero desmarcadas; al aceptar, marca esas sesiones y combina sus selecciones. La entrada GraphQL admite `seleccionesPorSesion`, y Back valida que cada opción pertenezca a la búsqueda, sesión, actor y revisión actuales. Los errores del editor se presentan junto a “Opciones encontradas”.

Al ajustar cupos por capacidad, los aumentos y reducciones se aplican automáticamente en Back. La capacidad inferior al número de inscritos conserva la validación existente para Enlaces.

Validado el 2026-10-02: `node node_modules/typescript/bin/tsc --noEmit` en Back; `node -r ts-node/register/transpile-only pruebas/validate-busqueda-espacios-oracle.ts`; `node -r ts-node/register/transpile-only pruebas/validate-grupo-cambios-v1.ts`; `npm.cmd run build` en Front; `git diff --check` en Front y Back. El build de producción del Front y las verificaciones del Back pasaron. La verificación TypeScript general del Front aún señala fallos ajenos a esta entrega en `nuevotemplate`, temporizadores y fixtures. Falta probar el recorrido completo y el guardado en el ambiente integrado. La persistencia sigue usando guardado legacy completo, no escritura atómica por componentes.
