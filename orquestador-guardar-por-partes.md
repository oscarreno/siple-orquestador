# Orquestador: guardado parcial y coordinado de grupos

## Estado vigente — 2026-09-15

Control durable Oracle implementado localmente en `guardarGrupo`, activable con
`ORACLE_CONTROL_GUARDADO=SI` después de ejecutar la migración MSSQL. La reserva
se confirma antes de Oracle y conserva la exclusión tras una caída; sustituye
la propuesta anterior de mantener una transacción MSSQL abierta durante los SP.
Incluye clave de idempotencia opcional, replay, consulta autenticada de estado e
invalidación de caché al fallar. La suite completa, TypeScript, schema y dist
pasan. Migración sin ejecutar; sin despliegue ni cambios Front.

Siguiente paso: aplicar migración en pruebas, activar y verificar replay y
concurrencia real. La reconciliación sigue supervisada; no hay revisión universal
de writers externos ni auditoría distribuida. Guía vigente:
`docs/cambioGrupos/back/fase-3-6-implementacion-control-oracle.md`.

## 1. Misión

Este documento es el contexto operativo para el agente orquestador responsable de
replantear e implementar el guardado de características de grupos a través del
frontend y del backend de SIPLE.

El resultado buscado no es una pantalla nueva ni una refactorización aislada. Es
una capacidad de dominio segura, reutilizable y auditable que permita modificar
un grupo desde distintos puntos de la aplicación sin repetir ni eludir reglas de
negocio.

Casos que debe soportar la solución final:

- Edición completa desde `editar-grupo`.
- Cambio rápido de una característica: cupo, mensaje, modificador, etc.
- Cambio directo de espacio u horario desde plantilla de horarios.
- Edición masiva de características homogéneas: cupos, materias, planes, etc.

La regla central es: **la pantalla que inicia el cambio no define su validez**.
Las reglas de autorización, cupos, espacios, accesibilidad, concurrencia y
auditoría deben ser comunes a todos los orígenes de la operación.

---

## 2. Alcance, autoridad y forma de trabajo

### Repositorios y responsabilidades

| Rol          | Repositorio                       | Responsabilidad principal                                                                                                                  |
| ------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Orquestador  | Ambos, sin mezclar implementación | Decisiones, contrato, secuencia, revisión de evidencia y aceptación final.                                                                 |
| Agente Front | `siple-front`                     | UX, formularios, adaptadores/servicios, consumo del contrato, estado, errores y actualización visual.                                       |
| Agente Back  | `siple-backTS`                    | Schema GraphQL, autenticación, autorización, comandos, reglas de negocio, persistencia, transacciones, auditoría y pruebas de integración. |

Usar una instancia de Codex por repositorio. El orquestador no debe copiar una
regla de negocio entre repositorios ni aceptar implementaciones que dependan de
un comportamiento no documentado del otro lado.

### Artefactos obligatorios

Antes de conectar cambios, el orquestador debe mantener actualizados:

1. Este documento, con estado y decisiones.
2. Un contrato versionado en `docs/contratos/` o ruta equivalente en ambos repositorios.
3. La matriz de permisos y reglas por tipo de cambio.
4. La evidencia de pruebas: caso feliz, rechazo de regla y conflicto de revisión del grupo.

Todo cambio de contrato debe anunciarse con este formato:

```txt
CONTRATO ACTUALIZADO
Módulo: grupos
Tipo: GraphQL
Operación:
Request:
Respuesta éxito:
Errores de negocio:
Concurrencia:
Auditoría:
Impacto front:
Compatibilidad/migración:
```

### Principios no negociables

- No confiar en permisos, usuario, valores previos ni bitácora enviados por frontend.
- La bitácora se calcula, persiste y controla exclusivamente en Backend; el
  frontend no envía textos ni valores de auditoría.
- Toda inserción, actualización o eliminación efectiva debe dejar historial en
  base de datos con actor, fecha, origen, correlación y estado anterior/nuevo
  calculados por el servidor.
- No usar `GrupoInput` completo para un cambio parcial.
- No aplicar `last writer wins` por defecto.
- No informar éxito si una parte requerida del cambio falló.
- No conservar nuevas rutas legacy de escritura.
- No registrar auditoría arbitraria desde una operación pública.
- No interpolar valores en GraphQL; usar siempre variables tipadas.
- No usar `any` en TypeScript.
- Todo texto nuevo debe mantenerse sin mojibake; usar formato UTF-8 con acentos y puntuación en Español.
- El nombre de la capa cliente será `GrupoCambiosService` (o un `Service`
  equivalente acordado). Los servicios existentes cuyo nombre contiene
  `Facade` deben inventariarse, migrarse y renombrarse; no usar el término
  `Facade` para nuevos componentes, servicios, tipos ni documentación de la
  solución objetivo.
- Cada modificación debe preservar el comportamiento existente no involucrado:
  efectos secundarios indeseables o regresiones funcionales son inaceptables.

---

## 3. Diagnóstico confirmado al inicio

Este estado proviene de la revisión del frontend y del diagnóstico entregado por
el agente backend. El orquestador debe corroborarlo contra el código vigente
antes de modificar cada área, pues puede cambiar durante la iniciativa.

### Estado del frontend

El guardado actual está concentrado en:

- `src/app/components/editar-grupo/editar-grupo.component.ts`
- `src/app/services/grupos-facade.service.ts`
- `src/app/services/grupos-data.service.ts`

Flujo actual:

1. Los subcomponentes de `editar-grupo` guardan estado local y emiten arreglos
   `iCambioRealizado` mediante `EventoGenericoService` y el evento
   `solicitarCambios`.
2. El componente padre convierte esos cambios en una copia mutable de `Grupo`.
3. El padre recompone mensajes, planes y el indicador `discapacidad`/`PB`.
4. `GruposFacadeService.guardarGrupo()` delega a `GruposDataService.guardarGrupoDBO()`.
5. La capa de datos invoca la mutación `guardarGrupo` y, si el schema no la
   reconoce, usa rutas legacy de guardado.

Problemas detectados:

- El servicio actual sólo persiste y publica actualizaciones; no contiene reglas.
- Permisos y validación de cupos/capacidad viven en `EditarCuposComponent`.
- La regla de `PB` se deriva en el componente a partir de un texto de modificadores.
- Se transmite un `Grupo` completo, con riesgo de sobrescribir cambios recientes.
- No hay manejo estructurado de conflictos, advertencias ni errores por campo.
- `EditarEspaciosComponent` hoy sólo prepara datos de visualización; no es aún un
  caso de uso real de cambio de espacio.
- Existen condiciones y logs de depuración que no deben perpetuarse en el nuevo flujo.

### Estado del backend

Operación vigente principal:

```graphql
Mutation.guardarGrupo(origen, grupo: GrupoInput, cambiosBitacora)
```

Hallazgos relevantes:

- El input declara campos opcionales, pero en MSSQL se comporta como reemplazo
  de agregado: encabezado y colecciones pueden borrarse/reinsertarse.
- Un input incompleto puede convertir valores de encabezado en `0`, `false` o
  cadena vacía; no es un patch seguro.
- MSSQL usa transacción para encabezado, hijos y bitácora.
- Oracle confirma el encabezado aun cuando falle un horario, mensaje o plan:
  captura la falla como warning y continúa. Esto es un éxito parcial silencioso.
- La rehidratación final puede fallar después de persistir el cambio, por lo que
  el cliente puede recibir error aunque el cambio exista.
- Todas las escrituras exigen sólo `editarGrupos`. `modificarCupos` no se aplica
  y su implementación actual devuelve `false`; `editarEspacios` tampoco se exige.
- No se valida alcance por departamento/grupo.
- No existen validaciones servidoras de cupos, capacidad, PB/accesibilidad,
  colisiones, vigencia de materias o consistencia de planes.
- No hay control efectivo de concurrencia, revisión del grupo, ETag ni comparación
  condicional de fecha de modificación.
- El actor de la bitácora sí proviene del contexto autenticado, pero los valores
  anterior/nuevo vienen del frontend y no se verifican contra lo persistido.
- Hay una ruta de bitácora autenticada que permite registrar texto arbitrario.
- Las rutas legacy siguen activas, mutan estado siendo `Query`, carecen de una
  semántica uniforme y pueden omitir bitácora, socket e invalidación de caché.
- No existe operación masiva.

### Riesgo de integración dominante

No conectar nuevos puntos de modificación directamente a `guardarGrupo` ni a las
rutas legacy. En particular, no implementar cambio rápido o masivo como un ciclo
de llamadas a `guardarGrupo`: produciría sobrescrituras, resultados parciales y
auditorías incongruentes.

---

## 4. Arquitectura objetivo

### Flujo de una modificación individual

```text
Componente origen
  -> prevalidacion visual opcional
  -> GrupoCambiosService (frontend)
  -> aplicarCambiosGrupo (GraphQL)
  -> handler/orquestador de dominio (backend)
  -> carga grupo canonico + aplica patch tipado
  -> autorizacion + validadores de dominio
  -> persistencia, revisión del grupo y auditoría
  -> Grupo canonico / rechazo tipado / conflicto
  -> Service publica actualizacion; componente presenta UX
```

### Límites de responsabilidad

| Capa                       | Responsabilidad                                                                              | No debe hacer                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Componente                 | Captura, prevalidación UX, confirmación, estado de carga, visualización de errores.          | Autorizar, calcular auditoría, decidir la validez definitiva.                  |
| Service Front              | Construir comando tipado, invocar API, adaptar resultado, publicar actualización local.      | Contener reglas sensibles o mutar un `Grupo` completo para una edición rápida. |
| Resolver GraphQL           | Autenticación, parsing y delegación.                                                         | Acumular lógica de dominio o SQL.                                              |
| Handler de cambios         | Cargar estado, aplicar patch, coordinar permisos, reglas, persistencia, revisión del grupo y auditoría. | Convertirse en una clase monolítica: debe delegar políticas especializadas.    |
| Políticas/validadores Back | Reglas de cupos, espacios, PB, horarios, planes, materias y permisos.                        | Saber detalles de UI.                                                          |
| Persistencia               | Transacciones de origen, acceso a datos y outbox cuando aplique.                             | Aceptar una bitácora fabricada por cliente.                                    |

El nombre acordado es `GrupoCambiosService` en frontend y
`GrupoCambiosService` o `AplicarCambiosGrupoHandler` en backend. El contrato y
los límites importan más que el nombre, pero no se empleará `Facade` en la
solución objetivo.

---

## 5. Contrato objetivo v1

**Contrato aprobado vigente:** `docs/contratos/grupos-v1/grupos-v1.md` y
`grupos-v1.graphql`, con copias idénticas en Front y Back. Los ejemplos de esta
sección resumen el diseño; el paquete versionado fija tipos y reservas exactos.

Usar una respuesta tipada para resultados de negocio. Los `GraphQL errors` se
reservan para errores técnicos no recuperables, autenticación o infraestructura.

```graphql
enum OrigenOperacionGrupo {
  EDICION_COMPLETA
  CAMBIO_RAPIDO
  PLANTILLA_HORARIOS
  EDICION_MASIVA
}

input GrupoRefInput {
  origen: String!
  periodo: String!
  clave: String!
}

input AplicarCambiosGrupoRequest {
  objetivo: GrupoRefInput!
  revisionGrupoEsperada: String!
  origenOperacion: OrigenOperacionGrupo!
  cambios: CambiosGrupoInput!
  advertenciasConfirmadas: [String!]!
  idempotencyKey: String!
}

union AplicarCambiosGrupoResultado = CambioGrupoAplicado | CambioGrupoRechazado | CambioGrupoConflicto
```

`CambiosGrupoInput` debe desglosarse por dominio. No introducir todos los campos
en una bolsa sin semántica. Como mínimo definir inputs para:

- `cupos`: general, primer ingreso, reingreso y complementario.
- `mensajes`: alta, actualización o eliminación por tipo.
- `modificadores` y su derivación de accesibilidad en servidor.
- `horarios`: agregar, quitar, reemplazar o cambiar espacio de una asignación
  identificable; nunca reemplazo implícito de toda la colección.
- `planesCompartidos`: operaciones identificadas por programa/materia.
- `materias`: sólo con semántica de alta, baja o reemplazo definida.

Respuesta de éxito mínima:

```graphql
type CambioGrupoAplicado {
  grupo: Grupo!
  revisionGrupoNueva: String!
  auditoriaId: ID!
  advertenciasAplicadas: [AdvertenciaGrupo!]!
}
```

Rechazo de regla:

```graphql
type ErrorReglaGrupo {
  codigo: String!
  regla: String!
  campo: String
  ruta: String
  mensaje: String!
  detalles: [DetalleReglaGrupo!]!
}

type CambioGrupoRechazado {
  errores: [ErrorReglaGrupo!]!
  advertencias: [AdvertenciaGrupo!]!
}
```

Conflicto:

```graphql
type CambioGrupoConflicto {
  codigo: String! # CONFLICTO_REVISION_GRUPO
  mensaje: String!
  grupoActual: Grupo!
  revisionGrupoActual: String!
}
```

### Confirmación de advertencias

El backend debe validar de nuevo al aplicar. `advertenciasConfirmadas` contiene
credenciales opacas emitidas por servidor, vinculadas a actor, objetivo, revisión,
comando, efecto candidato, dependencias relevantes y vencimiento. El código de
regla se usa para presentar la advertencia, no como credencial. Si cambia el
efecto o una dependencia relevante, se exige nueva confirmación sin escribir.
La prevalidación no sustituye la validación de escritura.

### Concurrencia e idempotencia

- `revisionGrupoEsperada` es obligatoria; Front la obtiene del grupo canónico y
  Backend la genera/controla.
- MSSQL puede apoyarse en `rowversion`; Oracle requiere un mecanismo equivalente
  controlado por servidor o una tabla de revisión por grupo.
- El cambio y la emisión de `revisionGrupoNueva` deben ser condicionales y atómicos en el
  origen autoritativo.
- Una clave de idempotencia impide duplicar una operación por reintento de red.
- Ante conflicto, no reintentar automáticamente un cambio destructivo: la UI
  debe mostrar el estado canónico y pedir que el usuario decida.

---

## 6. Reglas que el backend debe hacer cumplir

El agente Back debe proponer una política explícita y pruebas para cada regla;
el orquestador no acepta como suficiente una restricción de interfaz.

| Dominio              | Reglas mínimas                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Identidad y permisos | Actor desde `context.auth`; permiso por tipo de cambio; rol de administrador y alcance real por departamento/grupo.    |
| Cupos                | Enteros válidos, no negativos, relación entre cupo general y distribuciones, relación con inscritos, espacio y planes. |
| Espacios             | Existencia, vigencia/activo, capacidad, tipo, departamento si aplica y normalización segura de clave.                  |
| Accesibilidad        | Derivar PB/modificador en servidor y comprobar compatibilidad con nivel/servicios del espacio.                         |
| Horarios             | Formato, intervalos válidos, colisiones curriculares y no curriculares, restricciones de plantilla.                    |
| Materias y planes    | Existencia, vigencia, relación programa-materia, cupos y semántica de altas/bajas.                                     |
| Mensajes             | Tipo permitido, contenido, normalización y sanitización.                                                               |
| Auditoría            | Estado anterior y estado validado calculados por servidor; actor, operación y origen funcional obligatorios.           |

Decisiones de negocio cerradas por el orquestador y formalizadas en
`docs/cambioGrupos/matriz-reglas-permisos-v1.md`:

1. PB/espacio: el administrador puede ejecutar las restricciones funcionales
   con advertencia confirmable y auditoría; el enlace queda rechazado.
2. Capacidad: se compara contra alumnos inscritos; los ajustes por menor
   capacidad requieren confirmación y auditoría. Si hay que aumentar cupos,
   sólo aumentan `cupoGeneral` y `reingreso`.
3. Cupos: son enteros no negativos; cada distribución no supera el cupo
   general; `complementario <= reingreso`; `cupoGeneral <= primerIngreso +
   reingreso`; no se exige suma exacta. Un administrador puede dejar el cupo
   general por debajo de inscritos mediante advertencia confirmable.
4. Permisos: por dominio y alcance real; la matriz completa está en el documento
   de Fase 1.
5. Oracle: mensajes reemplazables por tipo; `POPUP` se trata como texto plano
   en el dominio y HTML/Base64 como adaptación de persistencia; horarios, planes
   y materias usan operaciones explícitas por elemento. La baja `BAJA` de planes queda
   reservada, pero la API actual aún no puede eliminar esos registros.
6. Atomicidad: no se mezclan Oracle y MSSQL en v1; los lotes son homogéneos y
   `TODO_O_NADA`. Esto conserva una sola autoridad transaccional, evita estados
   parciales y permite validar cada versión antes de escribir.
7. Advertencias administrativas: para las restricciones funcionales registradas
   en la matriz, un administrador puede continuar con advertencia confirmable.
   Fallas técnicas de transporte, base de datos o infraestructura siguen siendo
   fallas técnicas, no advertencias funcionales.

Si una decisión no está cerrada, la implementación debe bloquear ese caso o
declararlo fuera de alcance; no debe inventar una política silenciosa.

---

## 7. Persistencia, auditoría y fuentes de verdad

### MSSQL

Mantener una transacción única para el cambio, sus entidades hijas, revisión del grupo y
bitácora. Corregir únicamente los riesgos necesarios para que las operaciones
v1 sean seguras y compatibles: auditabilidad, control de revisión del grupo, idempotencia,
autorización y ausencia de éxito parcial. La optimización o refactorización
profunda de MSSQL es prioridad secundaria, pues la concentración futura de la
operación estará en Oracle. Cambiar de `delete + insert` global a actualizaciones
selectivas sólo cuando sea necesario para el alcance v1 o para eliminar un
  riesgo comprobado; si se conserva reemplazo, debe ser explícito y protegido por
revisión del grupo.

### Oracle y consistencia entre orígenes

No capturar errores de hijos como warnings para después responder éxito. Para una
operación declarada atómica, todos los procedimientos requeridos deben fallar o
confirmar juntos dentro del origen Oracle.

Cuando una escritura Oracle requiera reflejo, auditoría o caché en MSSQL, no
prometer una transacción distribuida si la infraestructura no la soporta. Usar un
outbox durable en el origen autoritativo, con reintento, correlación, monitoreo y
estado visible. El cambio nunca debe quedar sin un rastro recuperable.

### Auditoría

- Deshabilitar o restringir `guardarBitacora` para que sea sólo una operación
  interna del handler autorizado.
- No aceptar del cliente textos, `valorAnterior`, `valorNuevo` ni ningún otro
  dato de auditoría como evidencia.
- Para toda inserción, actualización o eliminación efectiva, guardar
  `origenOperacion`, actor, correlación, hora, revisión anterior/nueva del grupo y cambios
  efectivos calculados en backend.
- Persistir auditoría junto con el cambio en el mismo origen transaccional o
  mediante outbox fiable cuando haya dos orígenes.

---

## 8. Edición masiva

La primera versión debe ser segura y limitada:

```graphql
input AplicarCambiosGruposRequest {
  objetivos: [GrupoVersionadoInput!]!
  origenOperacion: OrigenOperacionGrupo! # EDICION_MASIVA
  cambiosComunes: CambiosGrupoInput!
  modo: TODO_O_NADA!
  advertenciasConfirmadas: [String!]!
  idempotencyKey: String!
}
```

Reglas de v1:

- Todos los objetivos deben pertenecer al mismo origen y período.
- Validar todo el lote antes de escribir.
- Si una regla falla, no aplicar ningún grupo.
- Responder con errores por objetivo/campo suficientes para corregir la selección.
- Auditar cada grupo y asociarlo a una misma correlación de lote.
- Rechazar lotes que mezclen Oracle y MSSQL hasta tener una estrategia de saga
  diseñada y probada.

`PARCIAL` no es una optimización menor. Sólo debe exponerse después de contar con
resultados detallados, idempotencia por elemento, una política de reintento y una
decisión explícita de negocio sobre resultados mixtos.

### Justificación de la política de lotes

- Un solo origen y periodo mantiene al lote dentro de un dominio de consistencia
  y una transacción autoritativa. Mezclar Oracle y MSSQL exigiría coordinar dos
  fuentes con fallos independientes y no existe una transacción distribuida
  aprobada para v1.
- La revisión del grupo por objetivo evita sobrescribir una modificación concurrente que
  ocurrió después de la lectura del lote. Cada grupo se compara contra su
  `revisionGrupoEsperada` antes de escribir.
- Validar todo antes de escribir evita que los primeros grupos queden guardados
  cuando otro objetivo falla por permiso, revisión del grupo, cupo o integridad. La
  auditoría y la respuesta representan entonces un resultado único y completo.
- `TODO_O_NADA` significa que el lote confirma todos sus objetivos o no confirma
  ninguno. `PARCIAL` requeriría resultados mixtos por elemento, reintentos,
  idempotencia por elemento, reglas de compensación y una UX para corregir sólo
  los fallidos; eso no está definido ni probado.
- Las sagas entre orígenes y las transacciones distribuidas quedan fuera de
  alcance porque introducirían estados intermedios, compensaciones y operación
  de recuperación que v1 todavía no puede garantizar ni auditar de extremo a
  extremo.

---

## 9. Plan de ejecución y delegación

El orquestador debe ejecutar las fases en este orden. No iniciar una fase que
dependa de un contrato o decisión todavía abierta.

### Disciplina modular y comprobable

Cada delegación debe cubrir un paso atómico con criterio de éxito verificable.
Antes de iniciar el siguiente paso, el agente responsable reportará qué hizo,
rutas afectadas, cómo se comprobó, resultado de la prueba y efectos secundarios
observados. El orquestador no aprobará un bloque sin esta evidencia ni sin una
prueba de regresión proporcional que demuestre que lo ya funcional continúa
intacto.

### Fase 0: descubrimiento y congelamiento del contrato

**Delegar a Back**

- Corroborar rutas, schema, resolvers, servicios y pruebas del diagnóstico.
- Proponer schema exacto de `aplicarCambiosGrupo` y versiones de tipos.
- Inventariar consumidores de rutas legacy.

**Delegar a Front**

- Inventariar todos los puntos que editan o planean editar grupos.
- Identificar qué campos/cambios necesita cada uno.
- Proponer interfaces TypeScript alineadas al contrato sin usar `any`.

**Salida requerida**

- `CONTRATO ACTUALIZADO` v1.
- Matriz de reglas, permisos y decisiones pendientes.
- Acuerdo de compatibilidad durante migración.

### Fase 1: cerrar riesgos de seguridad y consistencia actuales

**Back**

- Restringir la ruta arbitraria de bitácora.
- Corregir permiso `modificarCupos` y aplicar permisos por operación.
- Detener éxitos parciales silenciosos en Oracle.
- Definir la política de rehidratación posterior a commit y estados recuperables.
- Agregar control de revisión del grupo e idempotencia.

**Front**

- No añadir consumidores nuevos de legacy.
- Quitar dependencia de decisiones sensibles en componentes a medida que el
  nuevo contrato esté disponible.
- Corregir mojibake en cualquier archivo intervenido.

**Pruebas mínimas**

- Usuario sin permiso no puede mutar ni registrar auditoría.
- Hijo Oracle fallido no regresa éxito.
- Conflicto de versión no sobrescribe datos.
- Reintento con misma `idempotencyKey` no duplica cambio/auditoría.

### Fase 2: comando individual de cupos y mensajes

**Back**: handler parcial, validadores, respuesta tipada y pruebas.

**Front**: `GrupoCambiosService`, mapeo de errores por campo, advertencias y
actualización desde `grupo` devuelto por servidor.

**Criterio de aceptación**: la pantalla completa y un cambio rápido consumen la
misma operación sin reproducir autorización ni reglas críticas en UI.

### Fase 3: cambio de espacio/horario

**Back**: identidad estable del horario, políticas de espacio, PB,
capacidad, conflicto y persistencia Oracle/MSSQL coherente.

**Front**: invocación desde plantilla y UI que diferencia error bloqueante,
advertencia confirmable y conflicto.

**Criterio de aceptación**: ninguna ruta de cambio de espacio omite validación,
autorización, auditoría, versión o publicación de actualización.

### Fase 4: migrar edición completa

Migrar secciones de `editar-grupo` por tipo de cambio, no reescribiendo todo en
un solo paso. Una vez migrado un dominio, retirar su mapeo local hacia
`iCambioRealizado` como fuente de verdad; puede mantenerse temporalmente sólo
para presentación de bitácora si el servidor ya calcula los valores reales.

Como parte de esta fase, inventariar los servicios existentes con `Facade` en su
nombre, migrar sus consumidores a nombres `Service` acordados y retirar los
aliases o importaciones anteriores. La renombrada se ejecuta de forma
segmentada, con compilación y prueba de regresión de cada consumidor afectado;
no se permite mantener indefinidamente un nombre `Facade` por compatibilidad.

### Fase 5: lote homogéneo todo-o-nada

Implementar sólo cuando las operaciones unitarias sean estables y probadas.
Validar permisos por cada objetivo, revisiones por grupo y reglas que crucen
elementos del lote antes de persistir.

### Fase 6: retiro de legacy

Retirar rutas legacy, fallback de frontend y código duplicado sólo cuando todos
sus consumidores hayan migrado. Hacerlo en una versión anunciada del contrato y
con telemetría/censo de consumidores que demuestre uso cero.

---

## 10. Checklist de aceptación del orquestador

No aprobar una fase ni dar por terminada la iniciativa sin evidencia de todos los
elementos aplicables:

- [ ] El contrato se anunció en ambos repositorios y especifica nulabilidad,
      fechas, errores y versiones.
- [ ] El actor proviene del contexto autenticado, no del request.
- [ ] Cada tipo de cambio exige el permiso y alcance correctos en backend.
- [ ] Las reglas de cupo, espacio, PB, horarios, materias y planes se prueban
      en backend cuando aplican.
- [ ] Las advertencias requieren confirmación explícita y se revalidan al guardar.
- [ ] Las operaciones parciales no escriben valores por defecto sobre campos no modificados.
- [ ] Hay conflicto determinista por revisión del grupo y no hay sobrescritura silenciosa.
- [ ] La idempotencia evita duplicados por reintento.
- [ ] Persistencia, revisión del grupo y auditoría son atómicas o tienen outbox recuperable.
- [ ] Oracle no transforma fallas requeridas en éxitos silenciosos.
- [ ] El frontend usa el grupo canónico devuelto por servidor.
- [ ] Se probaron caso feliz, regla rechazada, advertencia confirmada, conflicto
      y error técnico para cada operación nueva.
- [ ] La edición masiva v1 rechaza mezclas de origen y no aplica resultados parciales.
- [ ] No quedan consumidores nuevos de rutas legacy ni acceso público de bitácora arbitraria.
- [ ] No hay interpolación GraphQL, `any`, secretos hardcodeados ni mojibake en
      los archivos modificados.
- [ ] No permanecen servicios, tipos, importaciones ni referencias de solución
      activa con `Facade`; los nombres existentes fueron migrados a `Service`
      con sus consumidores y pruebas de regresión actualizados.
- [ ] Toda inserción, actualización y eliminación efectiva deja bitácora
      persistida desde Backend; Front no transporta datos de auditoría.
- [ ] Cada bloque tiene un paso modular comprobable, con rutas, prueba y
      resultado observable reportados antes de continuar.
- [ ] Las pruebas de la fase incluyen regresión proporcional que confirma que
      no se introdujeron efectos secundarios ni se descompuso una función ajena.

---

## 11. Formato de reporte de cada agente

Cada agente ejecutor debe reportar al orquestador:

```txt
Resumen:
Archivos modificados:
Contrato afectado:
Reglas implementadas o verificadas:
Permisos aplicados:
Concurrencia/idempotencia:
Persistencia/auditoria:
Pruebas ejecutadas y resultado:
Cómo se comprueba el éxito del paso:
Efectos secundarios / regresión verificada:
Riesgos, deuda o decisiones pendientes:
Compatibilidad y siguiente paso:
```

El orquestador debe responder con aprobación, correcciones concretas o bloqueo
justificado. No debe aceptar afirmaciones sin rutas, pruebas o comportamiento
observable.

## 12. Estado inicial de la iniciativa

- [x] Diagnóstico de frontend realizado.
- [x] Diagnóstico de backend realizado por el agente del repositorio backend.
- [x] Decisiones de negocio de la sección 6 cerradas, sujetas a verificación
      contra el inventario de la Fase 0.
- [x] Contrato GraphQL v1 aprobado por ambos repositorios para fundaciones, con reservas por dominio.
- [ ] Riesgos actuales de seguridad, atomicidad y concurrencia corregidos.
- [ ] Operación individual de cambios parciales implementada.
- [ ] Cambio de espacio/horario migrado.
- [ ] Edición completa migrada.
- [ ] Edición masiva todo-o-nada implementada.
- [ ] Legacy retirado.

---

## 13. Documento canónico de ejecución por sesiones

Este archivo es la fuente única de verdad para coordinar y reanudar la
iniciativa. El documento `plan-de-trabajo-guardar-grupo-segmentado.md` conserva
la guía de arquitectura y secuencia, pero no mantiene un tablero operativo
independiente.

### 13.1 Estado de autorización y alcance

- **Escritura autorizada:** `siple-front` y `siple-backTS`.
- **Repositorio de coordinación:** `siple-orquestador`.
- **Alcance:** macro-tarea completa, fases 0 a 8.
- **Ramas:** continuar sobre las ramas actuales de cada repositorio.
- **Cambios existentes:** no descartar, reiniciar ni sobrescribir cambios del
  usuario; toda modificación debe partir de una revisión del estado actual.
- **Estrategia:** ejecución segmentada, con un bloque atómico por sesión y una
  puerta de salida verificable antes de avanzar.

### 13.2 Decisiones de negocio aprobadas

Estas decisiones quedan cerradas para la implementación v1 y no deben
reinterpretarse silenciosamente:

| Decisión | Política aprobada |
| --- | --- |
| PB y restricciones de espacio | El enlace queda rechazado ante la restricción; el administrador puede ejecutar con advertencia confirmable y auditoría, incluso ante disponibilidad, inexistencia, conflicto, colisión o integridad funcional. |
| Capacidad | Se compara contra alumnos inscritos. El administrador puede confirmar la insuficiencia como advertencia. |
| Ajuste posterior de cupos | Si el movimiento obliga a ajustar por la menor capacidad resultante, el ajuste forma parte de la operación, se confirma antes de escribir y se audita por grupo. Si hay que aumentar, sólo suben `cupoGeneral` y `reingreso`; `primerIngreso` y `complementario` quedan iguales. |
| Distribución de cupos | Valores no negativos; `complementario <= reingreso`; `cupoGeneral <= primerIngreso + reingreso`; cada distribución no supera el cupo general; no se exige suma exacta. Un administrador puede dejar `cupoGeneral` por debajo de inscritos mediante advertencia confirmable. |
| Permisos | Cupos: `modificarCupos`; espacios y horarios: `editarEspacios`; demás dominios: `editarGrupos`, siempre con alcance real por departamento/grupo en Backend. |
| Colecciones Oracle | Mensajes reemplazables por tipo. Horarios, planes y materias usan altas, actualizaciones y bajas explícitas por elemento identificable; omitir un elemento no significa borrarlo. La baja de planes se reserva en el contrato, pero la API actual aún no puede ejecutarla. |
| Mensajes `POPUP` | El dominio v1 usa texto plano para Front. La BD conserva HTML y el transporte Oracle puede usar Base64; el adaptador hace el encode/decode una sola vez y Front no renderiza HTML crudo. |
| Orígenes | Una operación v1 no puede mezclar Oracle y MSSQL. |
| Edición masiva | Solo lotes homogéneos del mismo origen y periodo, con validación previa y modo `TODO_O_NADA`. |

### 13.3 Estado del contrato

| Campo | Estado actual |
| --- | --- |
| Versión | v1 aprobado para fundaciones; paquete canónico en `docs/contratos/grupos-v1/`, idéntico en Front y Back |
| Operación | `grupoParaCambios` / `aplicarCambiosGrupo`; contrato aprobado, API aún no implementada |
| Responsable de propuesta | Agente Back |
| Revisión | Agente Front |
| Aprobación | Orquestador, 2026-09-08, tras ratificaciones independientes Back/Front y verificación SHA-256 de espejos |
| Request | Objetivo estable, `revisionGrupoEsperada`, origen funcional, cambios tipados, advertencias confirmadas e `idempotencyKey` |
| Respuesta | Resultado tipado: aplicado, rechazado, conflicto de revisión del grupo o fallo técnico no recuperable |
| Auditoría | Calculada y persistida exclusivamente por Backend |
| Concurrencia | `revisionGrupoEsperada` controlada por servidor y conflicto determinista; sin `last writer wins` |
| Compatibilidad | No se agrega fallback legacy; las rutas actuales se conservan solo para consumidores ya inventariados hasta su retiro aprobado |

### 13.4 Tablero persistente de fases

Estados válidos: `PENDIENTE`, `EN CURSO`, `EN REVISIÓN`, `BLOQUEADO`,
`APROBADO`.

| Fase | Estado | Responsable | Prerrequisito | Próximo paso atómico | Evidencia/pruebas | Bloqueador o decisión | Actualización |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0. Inventario y congelamiento | APROBADO | Orquestador + Front + Back | Autorización y diagnóstico inicial | Proponer contrato v1 con el censo consolidado | Reportes Front/Back y líneas base registrados en 13.6 | Fallos de línea base conocidos, sin cambios funcionales de esta fase | 2026-09-04 |
| 1. Decisiones y permisos | APROBADO | Orquestador + negocio | Fase 0 aprobada y decisiones contrastadas | Diseñar contrato v1 contra la matriz aprobada | `docs/cambioGrupos/matriz-reglas-permisos-v1.md` | Ninguno; cambios actuales de UI quedan como migración | 2026-09-04 |
| 2. Contrato v1 | APROBADO | Back revisó; Front revisó; Orquestador aprobó | Fase 1 aprobada | Iniciar bloque 3.1 de fundaciones | `docs/contratos/grupos-v1/revision-aprobacion-v1.md`; validadores OK; tres paquetes idénticos por SHA-256 | Ninguno para diseño; reservas no habilitan horarios, principal/intercambios ni operaciones sin soporte | 2026-09-08 |
| 3. Fundaciones Back | EN CURSO | Front completó 3.1-A; Back implementó 3.1-B, auditoría derivada 3.2-A, rollback Oracle 3.2-B y aislamiento local 3.4-A/3.4-B | Contrato v1 aprobado; contención Front verificada; regresión local y auditoría normalizada verificadas | Obtener evidencia DBA de procedimientos, DDL, writers y bloqueo; después implementar revisión compartida, auditoría Oracle atómica e idempotencia | `docs/cambioGrupos/back/fase-3-1b-implementacion.md`, `fase-3-2a-implementacion.md`, `fase-3-2b-rollback-oracle.md`, `fase-3-3-lectura-bitacora.md`, informes 3.4-A/3.4-B y paquete 3.5; regresión completa, pruebas focalizadas, tsc y dist OK en los bloques previos | La auditoría Oracle aún es post-commit en MSSQL; faltan evidencia de commits internos, DDL/revisión/idempotencia y censo completo de writers; despliegue pendiente de clientes compatibles | 2026-09-14 |
| 4. Cupos y mensajes | PENDIENTE | Back + Front | Fundaciones aprobadas | Implementar primera vertical | Sin evidencia de vertical v1 | Pruebas de reglas de cupo | 2026-09-04 |
| 5. Espacios y horarios | PENDIENTE | Back + Front | Vertical inicial aprobada | Definir identidad estable de horario | Sin evidencia de migración | Política PB/capacidad ya registrada | 2026-09-04 |
| 6. Edición completa | PENDIENTE | Front + Back | Comandos por dominio aprobados | Migrar primer segmento y renombrar `Facade` | Sin evidencia de migración | Censo de consumidores `Facade` | 2026-09-04 |
| 7. Lote todo-o-nada | PENDIENTE | Back + Front | Operaciones unitarias estables | Definir request por grupo/revisión | Sin evidencia de lote | No mezclar orígenes | 2026-09-04 |
| 8. Retiro de legacy | PENDIENTE | Back + Front; Orquestador aprueba | Censo y telemetría en cero | Retirar una ruta verificada | Sin evidencia de cero uso | Consumidores y fallback pendientes | 2026-09-04 |

### 13.5 Criterios de aprobación persistentes

**Actualización 3.4-A (2026-09-14): aislamiento de conexión implementado localmente.**
Con autorización del usuario se modificó `siple-backTS/src/system/oracle.ts`:
cada `withTransaction` adquiere/libera su propia conexión del pool; inicialización
concurrente protegida y conexión legacy separada. Prueba nueva de concurrencia
simulada y errores OK; regresiones previas, TypeScript y dist OK. Informe y
pruebas manuales: `docs/cambioGrupos/back/fase-3-4a-aislamiento-oracle.md`.
Esta actualización sustituye el punto de detención previo a código para este
bloque. Sigue pendiente la prueba con Oracle real y el esquema de revisión,
auditoría e idempotencia; no se habilita v1 ni se aprueba toda la Fase 3.

**Actualización 3.4-B (2026-09-14): auditoría Oracle normalizada.** El caso
`V2026|CPC3326G` reprodujo falsos positivos por campos omitidos, `exportable`
fuera de la escritura Oracle y POPUP HTML/Base64. Backend ahora compara el
estado efectivo de Oracle, excluye campos no persistidos y normaliza el orden y
contenido de mensajes. La prueba específica deja únicamente los dos cambios
de cupo; suite completa, TypeScript y dist OK. Informe:
`docs/cambioGrupos/back/fase-3-4b-auditoria-normalizada.md`. La auditoría aún es
post-commit en MSSQL y no hay revisión/idempotencia v1.

**Implementación Back 3.1-B (2026-09-11): restricción verificada localmente y en
smoke test HTTP de pruebas.**
Resolver autenticado rechaza escritura pública, firma deprecated y código estable
preservado por formateador GraphQL. Pruebas focalizadas, TypeScript y espejos OK.
El smoke test con JWT sintético devolvió `data: null` y
`AUDITORIA_PUBLICA_NO_DISPONIBLE` sin escritura. La regresión general reproduce el
fallo conocido de rollback Oracle; no se declara aprobada. Log interno probado con
SQL simulado; falta cobertura integral de sus operaciones llamadoras. El proceso
temporal se detuvo y no se desplegó a un servicio persistente: falta evidencia de
clientes activos compatibles. Informe: `docs/cambioGrupos/back/fase-3-1b-implementacion.md`.
La Fase 3 continúa; cerrar 3.1 no equivale a cerrar todas sus fundaciones.

**Implementación Back 3.2-A (2026-09-11): auditoría derivada por Backend en MSSQL y Oracle.**
El guardado agregado carga el estado persistido, compara el candidato y pasa al
SQL y a la bitácora Oracle únicamente las diferencias calculadas por servidor;
la prueba ignora un cambio fabricado por el cliente y conserva las diferencias
reales en ambos orígenes. La regresión completa, el validador de auditoría,
TypeScript y `dist` pasan. La bitácora Oracle todavía se escribe después del
commit porque no existe una tabla/procedimiento de auditoría Oracle ni outbox
durable en el contrato actual. No se habilitan aún revisión compartida ni
idempotencia.
Informe: `docs/cambioGrupos/back/fase-3-2a-implementacion.md`.

**Implementación Back 3.2-B (2026-09-11): rollback Oracle verificado.** Los
errores de horario, mensaje y plan ya no se absorben dentro de la transacción;
la prueba de regresión confirma que el fallo produce rollback y evita commit.
La regresión completa de `guardarGrupo`, TypeScript y `dist` pasan. La bitácora
Oracle aún se persiste después del commit y la Fase 3 continúa. Informe:
`docs/cambioGrupos/back/fase-3-2b-rollback-oracle.md`.

**Implementación Back 3.3 (2026-09-11): lectura robusta de bitácora.** La
consulta de `BitacoraSIPLE` fallaba al convertir manualmente a JSON una fila con
comillas, barras invertidas o saltos de línea. `database.arreglaObjeto` ahora
construye directamente el objeto de salida. La regresión completa, TypeScript y
`dist` pasan. Informe: `docs/cambioGrupos/back/fase-3-3-lectura-bitacora.md`.

**Diseño Back 3.4 (2026-09-14): fundaciones transaccionales listo para
implementación.** Se fijó la secuencia de bloqueo y commit para Oracle, el
registro durable de idempotencia, la revisión común a writers legacy y la
auditoría nativa ligada a la transacción. También se documentó el outbox como
única alternativa para reflejos MSSQL sin prometer transacción distribuida.
El diseño no equivale a implementación: Back debe entregar migraciones,
procedimientos, pruebas de concurrencia/replay/rollback y censo de writers antes
de habilitar la API v1. Informe:
`docs/cambioGrupos/back/fase-3-4-fundaciones-transaccionales.md`.

**Cierre de preparación 3.4 (2026-09-14): detenido antes de código.** La
inspección del Backend confirmó que `Oracle.withTransaction` reutiliza una
conexión global, que las rutas Oracle legacy escriben fuera de la transacción
del agregado y que no hay DDL versionado para revisión, auditoría o idempotencia.
Se levantó la matriz mínima de writers y las decisiones que deben confirmar
Backend/DBA. No se modificó `siple-backTS`. Informe:
`docs/cambioGrupos/back/fase-3-4-preimplementacion.md`.

**Preimplementación 3.5 (2026-09-14): revisión e idempotencia detenidas antes
de nuevo código.** Se cerró el inventario de writers Oracle y se preparó el
paquete de consultas para DBA y la prueba controlada de `COMMIT`/`ROLLBACK` de
`SIPF1_ALTAGRUPO2`, `SIPF1_ALTAHORARIO`, `SIPF1_ALTAMENSAJE` y
`SIPF1_ALTAGMAP22`. No se ejecutaron consultas contra la BD ni se modificó
Backend en este bloque. No se inicia la siguiente implementación hasta confirmar
que los procedimientos respetan la transacción externa, que no hay writers sin
censar y que existen soportes aprobados para revisión, auditoría e idempotencia.
Informe: `docs/cambioGrupos/back/fase-3-5-preimplementacion-revision-idempotencia.md`.

**Bloqueo transaccional confirmado (2026-09-14).** DBA informó que
`SIPF1_ALTAGRUPO2`, `SIPF1_ALTAHORARIO` y `SIPF1_ALTAMENSAJE` hacen `COMMIT`
interno. `SIPF1_ALTAGMAP22` acepta `autocommit=N` por defecto. Por ello, la
conexión aislada y el `ROLLBACK` externo no pueden hacer atómico el agregado
actual; `ALTAGMAP22` solo queda condicionado a enviar `N` explícitamente. No se
modifica Backend hasta contar con variantes sin commit, un procedimiento
agregado transaccional o una estrategia compensatoria aprobada.

**Preimplementación 3.6 (2026-09-14): control plane MSSQL compatible con SP
legacy.** Se diseñó una fila de control por grupo y un ledger durable de
idempotencia en MSSQL, bloqueados mediante `UPDLOCK, HOLDLOCK` durante la
operación Oracle. Los estados `APLICADA`, `PARCIAL` e `INCIERTA` permiten
reconciliar sin fingir rollback Oracle. Se prepararon el DDL y la matriz de
transiciones; no se ejecutó DDL ni se modificó Backend en este bloque.
Informes: `docs/cambioGrupos/back/fase-3-6-preimplementacion-control-plane-mssql.md`
y `control-plane-oracle-legacy.sql`.

**Implementación Front 3.1-A (sesión 11): APROBADA localmente.** Una sola
mutación sin fallback automático; editor conserva borrador ante resultado incierto,
bloquea segundo envío y exige consultar/adoptar datos actuales. Pasaron 29 pruebas
focalizadas en ChromeHeadless, build de producción y preflight CSS. La suite
general reproduce dos bloqueos previos; no se la declara aprobada. Informe:
`docs/cambioGrupos/front/fase-3-1a-implementacion.md`. No se desplegó, no se
modificó Back y no se habilitó API v1. Sigue 3.1-B.

**Preparación de Fase 3.1 (sesión 10): lista para código.** El censo confirmó
que cerrar solo la bitácora pública puede dejar escrituras de fallback sin
auditoría. Se fija 3.1-A Front: contener fallback automático y presentar resultado
incierto; después 3.1-B Back: restringir resolver público conservando llamadas
internas. Rutas, pruebas y orden de despliegue están en
`docs/cambioGrupos/fase-3-1-listo-para-codigo.md`. La contención de activación
automática es una restricción de seguridad en Fase 3, no retiro de endpoints
legacy ni declaración de cero consumidores en Fase 8. No se modificó código.

**Cierre de Fase 2 (sesión 9): APROBADO.** Revisiones independientes
`revision_back_v1` y `revision_front_v1` ratificaron la versión corregida para
fundaciones. Los paquetes `docs/contratos/grupos-v1/` de Orquestador, Back y Front
son idénticos: ocho archivos y manifiesto SHA-256. Pasaron generación/verificación
de inputs, SDL integrado, TypeScript estricto, fixtures GraphQL y lectura
versionada/null. No se habilitaron API ni escrituras. Los avances anteriores de
esta sección son históricos y sus pendientes de diseño quedan sustituidos por
el dictamen versionado; las reservas de habilitación siguen vigentes.

**Avance de Fase 2 (2026-09-08):** el borrador está en
`docs/cambioGrupos/contrato-grupos-v1-propuesta.md`, con SDL exacto y ejemplos.
Es una propuesta del orquestador basada en lectura de Back, no un reporte
independiente del agente Back ni un contrato aprobado por Front. La comprobación
`node docs/cambioGrupos/validar-propuesta-v1.cjs` integra el SDL con el schema
vigente y valida la operación, las variables y cuatro fixtures JSON. No ejecuta
resolvers ni verifica reglas o transacciones. Los refinamientos de confirmación,
no-op e identidad deben ratificarse antes de cambiar el contrato objetivo.
No se publicaron espejos aprobados ni se habilitó la Fase 3.

**Correcciones contrastadas (sesión 7):** se agregó el dominio `generales`
con tipo, idioma, liberable y contenido. Se precisó la separación de texto PLA
y modificadores, permitiendo edición simultánea sin pérdida de datos omitidos.
Se confirmó lunes = 1 a domingo = 7. El informe
`docs/cambioGrupos/revision-contrato-v1-2026-09-08.md` registra evidencia y riesgos
restantes. El validador confirma conservación de false, vacío y omisión, y rechazo
de PB dentro de generales. La revisión es del orquestador sobre el código; no
constituye una aprobación independiente de Front/Back ni una prueba funcional.

**Fronteras y consumo (sesión 8):** se incorporaron capacidades técnicas por
operación, horarios identificados nullable cuando no hay soporte y rol explícito
de materias. Oracle deriva adicionales de planes y su consulta actual de horarios
solo cubre semana 3; no se acepta como lectura autoritativa completa para editar.
`docs/cambioGrupos/resolucion-fronteras-v1.md` fija requisitos y reservas.
`node docs/cambioGrupos/validar-consumo-v1.cjs` pasó TypeScript estricto y ejecución
GraphQL local con fixtures de aplicado, rechazo, conflicto y advertencia. No
ejecuta resolvers reales ni demuestra atomicidad. Principal, intercambios y
horarios requieren cerrar sus puertas antes de habilitarse.

- No avanzar de fase sin rutas afectadas, prueba ejecutada, resultado
  observable y regresión proporcional documentados.
- No implementar una decisión funcional abierta por inferencia; el caso se
  rechaza o queda fuera de alcance hasta que exista aprobación.
- No declarar éxito si existe éxito parcial, conflicto no tratado, auditoría
  incompleta o estado posterior al commit ambiguo.
- No aceptar que el frontend sea autoridad para permisos, reglas, versiones,
  valores anteriores/nuevos ni bitácora.
- No aprobar un contrato que reutilice `GrupoInput` completo como patch parcial,
  use interpolación GraphQL o dependa de un fallback legacy.
- En las reglas funcionales aprobadas, el administrador puede continuar con una
  advertencia confirmable; la confirmación se revalida contra comando y versión
  y se audita. Esto no convierte fallas técnicas en advertencias.

La matriz formal aprobada de Fase 1 está en
`docs/cambioGrupos/matriz-reglas-permisos-v1.md` y es el insumo obligatorio para
el contrato v1.

### 13.6 Evidencia consolidada de la Fase 0

#### Reportes por repositorio

- Front: `docs/cambioGrupos/front/fase-0-inventario-front.md`.
- Back: `docs/cambioGrupos/back/fase-0-inventario-guardar-grupos.md`.
- Corte común: 2026-09-04.
- Ramas: Front `chore/graphql-variables-refactor`; Back `master`.
- No se modificó comportamiento funcional durante el inventario.

#### Censo consolidado de escrituras

| Zona | Hallazgo | Estado para migración |
| --- | --- | --- |
| Editor completo | `EditarGrupoComponent` recopila cupos, generales, mensajes, planes y espacios; llama `GruposFacadeService.guardarGrupo`. | Migrar por dominio a `GrupoCambiosService`. |
| Transporte Front | `GruposDataService` envía `GrupoInput` completo y `cambiosBitacora`; mantiene fallback Oracle/MSSQL. | No agregar consumidores; retirar por segmentos después del contrato. |
| Oracle Back | Mutación agregada más `guardarEncabezadoGrupoDBO`, `guardarHorarioGrupoDBO`, `guardarPlanCompartidoGrupoDBO` y `guardarMensajeGrupoDBO`. | Sustituir por comandos tipados; mensajes podrán usar reemplazo por tipo. |
| MSSQL Back | Mutación agregada más `guardarGrupoMSSQL` y `guardarPlanCompartidoMSSQL`. | Sustituir por comandos tipados; proteger reemplazos con revisión del grupo. |
| Bitácora | Front llama `LogService.guardarBitacora`; Back expone `guardarBitacora` y acepta valores del request. | Restringir a mecanismo interno del handler. |
| Revisión de planeación | Front y Back tienen `revisarGrupoPlaneacion`, escritura distinta al guardado de características. | Mantener fuera del primer comando parcial, pero conservar en el censo. |
| Espacios/horarios | `EditarEspaciosComponent` y `PlantillaHorariosComponent` preparan/visualizan datos; no existe todavía una operación real de cambio de espacio desde plantilla. | Implementar en la fase de espacios y horarios. |

#### Línea base ejecutada

| Repositorio | Comando | Resultado |
| --- | --- | --- |
| Front | `cmd /c npm run build` | **OK**. Preflight CSS: 478 archivos, 0 variables indefinidas; build de producción completado. |
| Front | `cmd /c npm test -- --watch=false --browsers=ChromeHeadless` | **FALLA BASE**. Error de exportación `zone.js`, error TS2322 en `websockets.service.ts:171` y `EPERM` al escribir caché Angular; no se ejecutaron specs. |
| Back | `cmd /c npm run validar:guardar-grupo` | **FALLA BASE REPRODUCIBLE**. `pruebas/validate-guardarGrupo.ts:269` esperaba rechazo/rollback, pero Oracle convirtió el fallo intermedio en warnings y confirmó. |

#### Discrepancias y riesgos que pasan a la siguiente fase

1. El contrato vigente no tiene `revisionGrupoEsperada`, idempotencia ni resultados
   tipados de negocio.
2. Oracle captura fallos de hijos requeridos y responde éxito.
3. La bitácora no es atómica y recibe valores construidos por Front.
4. No existe matriz efectiva por dominio ni validación de alcance en las
   escrituras inventariadas.
5. No existe un espejo `docs/contratos/` con contrato v1 aprobado; se creará en
   la Fase 2 después de la propuesta de Back y revisión de Front.
6. El censo de `Facade` y la línea base de Front deben usarse como controles de
   regresión durante la migración.

**Decisión de puerta:** la Fase 0 queda `APROBADA` porque todas las áreas de
escritura conocidas están censadas y sus fallos de línea base están registrados.
Los fallos anteriores son bloqueadores de regresión para las fases de código,
pero no impiden el inventario; no se deben ocultar ni atribuir a cambios futuros.

## 14. Protocolo de trabajo y reanudación

### 14.1 Inicio de cada sesión

1. Leer este documento completo.
2. Revisar ramas, estado de trabajo y cambios existentes en Front y Back.
3. Revisar el contrato vigente, reportes recientes y pruebas disponibles.
4. Confirmar en el tablero la fase activa, el prerrequisito aprobado, el
   responsable, el entregable y el bloqueador.
5. Si alguno de esos datos falta, clasificar la sesión como investigación y no
   como implementación.

### 14.2 Ejecución de la sesión

- Ejecutar un solo bloque atómico con criterio de éxito verificable.
- No ampliar el alcance si aparece una discrepancia sin registrarla primero.
- Mantener el contrato compatible: Back debe estar disponible antes de conectar
  consumidores Front.
- Ejecutar las pruebas en el repositorio dueño de la regla y una regresión
  proporcional de la funcionalidad cercana.
- No retirar legacy ni nombres `Facade` mientras existan consumidores activos.

### 14.3 Cierre de cada sesión

Actualizar el tablero y registrar una entrada con:

- sesión, fecha y fase/bloque;
- archivos inspeccionados o modificados;
- contrato y reglas afectadas;
- pruebas, comando y resultado;
- efectos secundarios y regresión verificada;
- riesgos o decisiones pendientes;
- siguiente paso atómico exacto.

Si la sesión se interrumpe, el siguiente paso debe quedar descrito sin depender
de memoria conversacional.

## 15. Registro de sesiones

| Sesión | Fecha | Fase/bloque | Archivos inspeccionados o modificados | Pruebas y resultado | Efectos secundarios/regresión | Siguiente paso |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 2026-09-04 | Preparación documental y autorización | `orquestador-guardar-por-partes.md`, `plan-de-trabajo-guardar-grupo-segmentado.md`; inventario inicial de Front y Back | Lectura y verificación estática; no se ejecutaron pruebas funcionales | No se modificó Front ni Back | Ejecutar Fase 0: inventario sincronizado y línea base de pruebas |
| 1 | 2026-09-04 | Fase 0: inventario sincronizado y línea base | `docs/cambioGrupos/front/fase-0-inventario-front.md`; `docs/cambioGrupos/back/fase-0-inventario-guardar-grupos.md`; evidencia consolidada en 13.6 | Front build **OK**; Front tests **FALLA BASE**; Back validator **FALLA BASE REPRODUCIBLE** | No se modificó comportamiento funcional; riesgos Oracle, bitácora, versión e idempotencia confirmados | Ejecutar Fase 1: formalizar matriz de reglas, permisos, alcance y casos fuera de alcance |
| 2 | 2026-09-04 | Fase 1: matriz de reglas, permisos y alcance | `docs/cambioGrupos/matriz-reglas-permisos-v1.md`; decisiones 13.2; inventarios 13.6 | Revisión documental contra censo Front/Back; matriz aprobada, sin pruebas funcionales porque no hubo cambios de código | No se modificó código ni comportamiento; discrepancias de UI quedan registradas como migración | Ejecutar Fase 2: propuesta exacta del contrato GraphQL v1 |
| 3 | 2026-09-04 | Fase 1: correcciones aprobadas de reglas y alcance | `docs/cambioGrupos/matriz-reglas-permisos-v1.md`; decisiones 13.2 y política de lotes | Revisión estática de consistencia documental; no se ejecutaron pruebas funcionales porque no hubo cambios de código | No se modificó Front ni Back; se precisaron advertencias administrativas, POPUP, ajuste de cupos y baja futura de planes | Ejecutar Fase 2: propuesta exacta del contrato GraphQL v1 incorporando estas reglas |
| 4 | 2026-09-04 | Fase 1: nomenclatura explícita de concurrencia | `docs/cambioGrupos/matriz-reglas-permisos-v1.md`; request y respuesta GraphQL propuestos en este documento | Revisión estática de nombres y búsqueda de referencias ambiguas; sin pruebas funcionales porque no hubo cambios de código | No se modificó Front ni Back; se sustituyó `version*` por `revisionGrupoEsperada`, `revisionGrupoActual` y `revisionGrupoNueva` | Ejecutar Fase 2: proponer el contrato GraphQL v1 definitivo usando la nomenclatura aprobada |
| 5 | 2026-09-08 | Revisión de estado y limpieza terminológica | `orquestador-guardar-por-partes.md`; estados de ramas Front/Back | Lectura completa del documento; verificación estática de tablero, contrato y nombres de concurrencia | No se modificó Front ni Back; se alinearon menciones narrativas restantes con “revisión del grupo” | Ejecutar Fase 2: proponer el contrato GraphQL v1 definitivo y publicarlo para revisión de Front |
| 6 | 2026-09-08 | Fase 2: borrador concreto para revisión | `docs/cambioGrupos/contrato-grupos-v1-propuesta.md`, SDL compañero y `validar-propuesta-v1.cjs`; schema/modelo/normalización de Back; matriz aprobada | `node docs/cambioGrupos/validar-propuesta-v1.cjs`: OK; SDL integrado con schema actual, operación y variables válidas, cuatro fixtures JSON y UTF-8 verificados | Solo documentación y validador local; no se modificó Front/Back ni se ejecutaron pruebas funcionales; documentos existentes de Front preservados | Back ratifica y completa los pendientes enumerados del borrador; Front revisa modelos/fixtures; luego publicar espejos y evaluar aprobación de Fase 2 |
| 7 | 2026-09-08 | Fase 2: correcciones contrastadas con Back/Front | Borrador, SDL, validador y `docs/cambioGrupos/revision-contrato-v1-2026-09-08.md`; editor de generales/mensajes, persistencia y plantillas inspeccionados | Validador OK: integración SDL, operación/variables y cuatro fixtures; generales conserva false/vacío/omisión y rechaza PB | Sin cambios productivos ni escrituras; no se ejecutaron pruebas de comportamiento legacy | Resolver representación exacta de materia principal y horarios por origen; revisar consumo con modelos TypeScript y fixtures de advertencia/confirmación |
| 8 | 2026-09-08 | Fase 2: fronteras por origen y consumo tipado | `resolucion-fronteras-v1.md`, SDL y borrador; `front/contrato-v1-consumo.ts`, `validar-consumo-v1.cjs`; lectura de `Grupos.build.ts` | Ambos validadores OK; TypeScript estricto; ejecución GraphQL mock de cuatro resultados y rol obligatorio de materia | Sin cambios Front/Back ni BD; reservas técnicas explícitas; documentos previos preservados | Ratificar alcance reservado y completar revisión final de contrato; obtener evidencia de identidad/cobertura de horarios antes de habilitarlos |
| 9 | 2026-09-08 | Fase 2: revisión independiente, ratificación y espejos | Paquete `docs/contratos/grupos-v1/` en los tres repositorios; inputs generados, lectura GraphQL y validadores en coordinación; tablero y guía alineados | Back/Front ratifican; validadores de inputs/SDL/consumo OK; `verificar-espejos-v1.cjs` confirma ocho archivos y manifiesto idénticos en los tres repositorios | Solo contrato/modelos documentales y validadores; sin código productivo ni BD; documentos preexistentes Front preservados | Fase 3, bloque 3.1: restringir auditoría pública con censo, preservación del guardado legítimo y regresión proporcional |
| 10 | 2026-09-08 | Fase 3.1: preparación hasta punto de código | `docs/cambioGrupos/fase-3-1-listo-para-codigo.md`; censo de resolver/schema/Log/Grupos y servicios/editor Front; tablero | Inspección directa y censo; diffs de archivos versionados Front/Back vacíos; espejos v1 intactos por SHA-256; sin nuevas pruebas funcionales | No se modificó código productivo ni contrato aprobado; no se ejecutó BD; ordena contención Front antes de restricción Back para evitar fallo posterior a escritura | Implementar 3.1-A: pruebas y cambio en guardarGrupoDBO/manejo de error del editor; preparación concluida por instrucción del usuario |
| 11 | 2026-09-08 | Fase 3.1-A: implementación Front | Servicio de datos, editor TS/HTML/CSS; dos specs, fixture y entrada/config focalizadas; informe Front | 29 pruebas ChromeHeadless OK; build producción y CSS OK; suite general reproduce zone-testing/TS2322 previos; UTF-8 y contrato intactos | Sin Backend/BD/despliegue; contención de fallback y recuperación explícita; validación DOM, sin captura gráfica autenticada | Implementar 3.1-B: restringir bitácora pública Backend con pruebas de resolver/error y preservación de llamadas internas |
| 12 | 2026-09-14 | Fase 3.4: diseño de fundaciones transaccionales | `docs/cambioGrupos/back/fase-3-2a-implementacion.md`, `fase-3-2b-rollback-oracle.md`, `fase-3-3-lectura-bitacora.md`, contrato v1 y `docs/cambioGrupos/back/fase-3-4-fundaciones-transaccionales.md`; inspección de `siple-backTS` | Revisión estática del flujo actual: Oracle confirma grupo y después intenta bitácora MSSQL; no hay revisión compartida ni idempotencia efectiva en `guardarGrupo` | No se modificó Back/Front ni se conectó BD; se fijó diseño implementable y criterios de salida | Implementar en Back el registro de revisión, auditoría e idempotencia; entregar censo de writers y pruebas de concurrencia/replay/rollback |
| 13 | 2026-09-14 | Fase 3.4: preparación pre-código | `siple-backTS`: wrapper Oracle, `Grupos.ts`, resolvers/schema, auth, documentación existente y estado Git; `docs/cambioGrupos/back/fase-3-4-preimplementacion.md` | Inspección estática: se confirmó conexión Oracle global, writers legacy independientes, bitácora MSSQL post-commit y ausencia de DDL versionado; no se ejecutaron pruebas con BD | No se modificó ningún archivo de Front/Back; se preservaron cambios locales existentes | Confirmar conexión por transacción, DDL/procedimientos con DBA y alcance de writers; después iniciar modificación de código |
| 14 | 2026-09-14 | Fase 3.4-B: auditoría Oracle normalizada | `siple-backTS/src/clases/Grupos.ts`, prueba `pruebas/validate-auditoria-normalizada.ts`, package y `docs/cambioGrupos/back/fase-3-4b-auditoria-normalizada.md` | Caso sintético `CPC3326G`: solo cupoPrimerIngreso y cupoComplementario; `validar:todas`, TypeScript, dist y diff check OK | No se conectó BD ni se habilitó API v1; se conserva comportamiento MSSQL y bitácora Oracle post-commit | Repetir caso real y después implementar revisión compartida/idempotencia con soporte DBA |
| 15 | 2026-09-14 | Fase 3.5: paquete previo a revisión DBA | `docs/cambioGrupos/back/fase-3-5-preimplementacion-revision-idempotencia.md`, `diagnostico-oracle-revision-idempotencia.sql`; inventario de writers y procedimientos Oracle | Inspección estática completada; no se ejecutaron consultas ni pruebas contra BD; no se modificó Backend en este bloque | Se preservan todos los cambios locales existentes; revisión, idempotencia y auditoría nativa siguen sin habilitarse | Obtener evidencia DBA de firmas, dependencias, triggers, commits internos y bloqueo concurrente; después decidir si procede el siguiente cambio de código |
| 16 | 2026-09-14 | Fase 3.5: bloqueo por commits internos Oracle | Evidencia DBA sobre `SIPF1_ALTAGRUPO2`, `SIPF1_ALTAHORARIO`, `SIPF1_ALTAMENSAJE` y `SIPF1_ALTAGMAP22`; actualización del paquete 3.5 | Se confirmó `COMMIT` interno en los tres primeros; `ALTAGMAP22` acepta `autocommit=N`; no se ejecutó código ni BD desde el repositorio | La atomicidad del agregado actual queda bloqueada; no se habilitan revisión/idempotencia v1 hasta una alternativa transaccional aprobada | Obtener variantes sin commit, procedimiento agregado o decisión compensatoria formal; luego reevaluar implementación |
| 17 | 2026-09-14 | Fase 3.5: primer bloque compatible con SP legacy | `siple-backTS/src/clases/Grupos.ts`, `pruebas/validate-guardarGrupo.ts`, paquete 3.5 | TypeScript, `validar:todas` y `dist`: OK; caso simulado posterior al encabezado devuelve `ORACLE_APLICACION_PARCIAL`; `ALTAGMAP22` verifica `autocommit=N` | No se movieron SP ni se prometió atomicidad; se prevalidan plantillas, se explicita el estado parcial y se conserva la auditoría existente | Implementar control plane para serialización/idempotencia durable y reconciliación; probar primero un guardado real con planes |
| 18 | 2026-09-14 | Fase 3.6: preimplementación del control plane MSSQL | `docs/cambioGrupos/back/fase-3-6-preimplementacion-control-plane-mssql.md`, `control-plane-oracle-legacy.sql`; contrato v1 y modelo MSSQL inspeccionados | Diseño y DDL preparados; no se ejecutó DDL, no se consultó BD y no se modificó Backend en este bloque | Se conserva el modo compatible con SP legacy; el control plane distinguirá `APLICADA`, `PARCIAL` e `INCIERTA` sin prometer transacción distribuida | DBA confirma esquema, retención, permisos y timeout; después implementar `Database.withTransaction`, repositorio y pruebas de replay/conflicto/reconciliación |

La primera sesión ejecutable es la Fase 0 y no debe cambiar comportamiento
funcional. Su salida mínima es el inventario consolidado, el mapa de campos,
las rutas legacy, los consumidores `Facade`, las discrepancias y la línea base
de pruebas de cada repositorio.
