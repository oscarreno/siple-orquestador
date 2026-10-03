# Edición de espacios — contrato técnico propuesto

**Estado:** implementado en Back y Front el 2026-09-28; pendiente de pruebas integradas en ambiente.
**Alcance:** búsqueda de espacios y propuesta de cambios para una o varias sesiones; incluye intercambios entre grupos, validación final, persistencia, cupos y notificación.
**Fuente funcional:** [especificación funcional](./especificacion-funcional.md), trasladada aquí desde `siple-front/docs/guardarGrupos/editarEspacio/` para centralizar la documentación en el orquestador.

## 1. Resultado que debe ofrecer el sistema

La persona usuaria prepara un cambio en la pestaña Espacios y lo guarda con el botón general del grupo. El Front no decide disponibilidad, permisos ni integridad: muestra opciones y mantiene una propuesta pendiente. El Back vuelve a validar el estado y ejecuta el guardado legacy. Para un intercambio, los grupos se guardan en secuencia; no se promete “todo o nada”.

Una propuesta puede afectar al grupo editado y, si es un intercambio, a otro grupo. Los cambios generales/cupos pendientes del grupo editado deben viajar en la misma solicitud lógica; no se debe guardar primero la pestaña de espacios y después el resto del grupo en otra operación.

## 2. Actores y autoridad

- **Front:** presenta sesiones y opciones, conserva selecciones, solicita búsquedas, pide confirmación de advertencias y comunica el resultado. Los identificadores o datos de destino enviados por el Front no son prueba de autorización ni de disponibilidad.
- **Back:** determina actor/rol/alcance, ventana de tiempo, PB, departamentos, permisos sobre espacios, disponibilidad, correspondencia de sesiones, capacidades y estado vigente. Revalida todo al guardar.
- **Oracle/MSSQL:** fuentes de verdad de grupos, sesiones, reservas, inscripciones y capacidades según `origen`. El contrato no presupone que ambos orígenes tengan iguales SP o garantías transaccionales.

El Back debe rechazar capacidades no habilitadas antes de ejecutar cualquier escritura. No se permite intentar una ruta, detectar un fallo después de efectos persistentes y entonces “caer” a otra ruta.

## 3. Flujo técnico propuesto

### 3.1 Preparar búsqueda

El Front parte de una lectura versionada del grupo. Envía al Back:

- referencia del grupo y origen;
- revisión leída;
- `asignacionId` de cada sesión seleccionada;
- modo `ESPACIOS_LIBRES` o `INCLUIR_INTERCAMBIOS`;
- `mismoEspacio`;
- `solicitarPB` para el grupo origen.

El Back resuelve las sesiones desde su propia lectura; no acepta como autoritativos el día, las horas, el espacio actual, la capacidad o el grupo contraparte enviados por el Front. La búsqueda devuelve alternativas agrupadas por `asignacionId`, metadatos suficientes para presentarlas y una identidad opaca de propuesta/búsqueda con vencimiento. En intercambios, la identidad representa la propuesta completa, no opciones independientes que el Front pueda combinar entre grupos distintos.

Cambiar modo, `mismoEspacio`, `solicitarPB` o el conjunto seleccionado invalida la búsqueda previa. El Front conserva una selección anterior solo si la nueva respuesta contiene exactamente la misma alternativa para esa sesión; de lo contrario deja el renglón sin opción válida y bloquea Guardar.

### 3.2 Mantener propuesta pendiente

La propuesta elegida permanece pendiente en el editor. No se escribe en base de datos al buscar ni al elegir un dropdown. El Front retiene el identificador opaco de propuesta; no construye una lista de cambios de contraparte a partir de los datos visibles.

La identidad de propuesta queda ligada, como mínimo, a actor, origen, grupo origen, revisiones de todos los grupos involucrados, asignaciones seleccionadas, destinos exactos, modo, preferencias PB y vencimiento. Una propuesta vencida, alterada o ligada a otra revisión se rechaza y requiere nueva búsqueda.

### 3.3 Guardar con el botón general

El contrato de guardado debe aceptar en una sola solicitud lógica:

1. el grupo editado y su revisión esperada;
2. los cambios generales/cupos/mensajes/etc. pendientes de ese grupo que admita la operación;
3. el identificador opaco de propuesta de espacios;
4. advertencias confirmadas y clave de idempotencia.

El Back reconstruye desde la propuesta todos los movimientos de todos los grupos involucrados, vuelve a validar y responde con el estado canónico de cada grupo afectado, revisiones nuevas, bitácoras y estado de notificación. El request no permite que el Front especifique libremente un grupo tercero ni una asignación destino no devuelta por el Back.

La actual mutación v1 `aplicarCambiosGrupo` modela un solo `objetivo`; el contrato actual no basta por sí solo para aplicar un intercambio multi-grupo y devolver todos sus resultados. La operación/SDL final debe cubrir el conjunto afectado sin convertir cada grupo en un guardado independiente.

## 4. Decisiones funcionales confirmadas

### Decisión 1 — PB y autoridad para bloquear

**Escenario:** un enlace abre un grupo origen marcado PB, o selecciona un intercambio que movería un grupo contraparte marcado PB. ¿Basta con que el Front oculte/bloquee Guardar y no envíe la mutación, o el Back debe recibir el intento y rechazarlo?

**Regla aprobada:** ambos lados participan con papeles distintos. El Front advierte y deshabilita inmediatamente la acción cuando ya conoce que no procede. El Back siempre vuelve a comprobar rol y PB en la búsqueda y en el guardado; nunca confía en el estado del control visual. Para enlace, el Back rechaza el movimiento de cualquier grupo PB. Para administrador, devuelve advertencia confirmable y exige una confirmación opaca emitida por el Back y ligada a la propuesta/revisiones. Una confirmación no permite saltarse disponibilidad ni integridad.

**Por qué importa:** si se cumple literalmente “no notificar al Back”, una llamada manipulada puede eludir la regla y el servidor no puede distinguir si el enlace vio el PB. La validación solo en Front no es una frontera de autorización.

**Consecuencia para la especificación:** las frases que dicen que no hace falta validar en Back se interpretan únicamente como una optimización de UX del Front. No eliminan la validación obligatoria del Back.

### Decisión 2 — Qué significa `Mismo espacio` cuando hay intercambio

**Escenario concreto:** A tiene lunes y miércoles a la misma hora, actualmente en `A-101` y `A-102`. B coincide exactamente en ambos horarios, pero está en `B-201` el lunes y `B-202` el miércoles. El intercambio completo daría a A los espacios `B-201` y `B-202`, y a B `A-101` y `A-102`.

Hay dos interpretaciones posibles:

- **Preferencia del editor:** `Mismo espacio` exige que las sesiones seleccionadas del grupo que se edita reciban todas la misma clave de espacio. En el ejemplo, el intercambio no se ofrece con la casilla activa; con la casilla inactiva sí puede ofrecerse como propuesta completa. La contraparte recibe los espacios que tenía el grupo origen, sesión por sesión.
- **Restricción bilateral:** ambos grupos deben quedar cada uno en un solo espacio común. El ejemplo tampoco califica; además, se descartarían intercambios aunque la preferencia del usuario solo se refiriera al grupo que está editando.

**Regla aprobada:** se aplica la primera interpretación. La casilla pertenece a la búsqueda del grupo editor; no impone una preferencia al otro grupo. Con `mismoEspacio = true`, toda propuesta —libre o de intercambio— debe asignar **la misma clave de espacio destino a todas las sesiones seleccionadas del grupo editor**. Si un intercambio daría a ese grupo espacios distintos, no aparece como opción. Con `mismoEspacio = false`, pueden aparecer propuestas con destinos diferentes por sesión.

**Consecuencia para la interfaz:** una propuesta que incumple `mismoEspacio` se excluye de la respuesta; no se presenta deshabilitada ni como advertencia seleccionable.

### Decisión 3 — Identidad y emparejamiento inequívoco de sesiones

**Escenario:** el Front debe decir “mueve esta sesión”, no “mueve el renglón 2”. Los índices de arreglos cambian al ordenar/filtrar y no sirven para guardar. Tampoco basta una comparación ambigua si el grupo tiene dos asignaciones que comparten día y horas.

**Regla implementada:** Back emite un `asignacionId` determinista por sesión y revisión; no es una clave primaria persistida. La búsqueda y la propuesta se ligan a ese ID y a la revisión del grupo. Para emparejar un intercambio, Back exige igual cantidad de sesiones y una correspondencia uno-a-uno por día, inicio y fin exactos; no usa el orden de los arreglos. Si la identidad es ambigua, no ofrece el intercambio.

**Caso especial:** los horarios cuya clave normalizada se repite se consideran ambiguos y no reciben `asignacionId`. La plantilla no se usa para desempatar.

**Validación pendiente:** probar en ambos orígenes la identidad determinista y el rechazo de horarios ambiguos.

### Decisión 4 — Estrategia de persistencia legacy (sustituye la decisión atómica)

**Decisión aprobada posteriormente:** la escritura atómica por componentes quedó imposibilitada con los SP disponibles. Los cambios de espacios usarán el guardado legacy completo; no se intentará una ruta atomizada ni se caerá a legacy después de iniciarla.

**Regla vigente:** Back valida toda la propuesta antes de escribir y construye el snapshot final completo de cada grupo afectado. Al usar legacy, reenvía todos los detalles que el mecanismo puede borrar: horarios, mensajes, planes y demás colecciones requeridas. La ruta se elige antes de cualquier escritura y es legacy desde el inicio.

**Límite conocido:** `SIPF1_ALTAHORARIO` inserta horarios y su parámetro `pautocommit` tiene valor predeterminado `'S'`; `SIPF1_ALTAGRUPO2` borra las reservaciones del grupo y ejecuta `COMMIT`. La secuencia no constituye una transacción indivisible de intercambio multi-grupo. La orquestación legacy deberá validar previamente, rehidratar el snapshot completo y comprobar los estados finales; no se debe afirmar atomicidad que los SP no proporcionan.

**Alcance aprobado para intercambios:** se acepta el riesgo de resultado parcial si falla la escritura del segundo grupo. Back relee los grupos afectados y responde con `CambioEspaciosParcial`; Front refresca lo que pudo confirmarse y comunica qué grupos requieren revisión. Si Oracle deja un control durable activo, Back solo lo cierra automáticamente cuando puede demostrar el estado observado con la misma identidad de operación y revisión anterior.

**Notificación:** después de confirmar los grupos, Back inserta registros en la tabla institucional `Notificaciones`; se usa el procesador ya existente. La respuesta distingue `ENCOLADA`, `PENDIENTE` o `SIN_NOTIFICACION`. No se incorporó un outbox nuevo; el procesamiento y la deduplicación deben comprobarse en ambiente.

## 5. Reglas de validación que quedan en el Back

- Identidad y rol del actor, ventana de tiempo, departamento, espacio público/taller autorizado, tipo físico/virtual y vigencia/estatus del espacio.
- Para Enlace/CSI, una sesión con espacio actual `VIDEOCONFERENCIA`, `EN LINEA` o `ASESORIA` no puede formar parte de la búsqueda ni del guardado; Back rechaza el intento aunque el cliente manipule la selección. Administrador conserva la excepción.
- Disponibilidad exacta por sesión en el momento de buscar y al guardar; se verifica también que no exista una reserva conflictiva nueva.
- Modo libre no produce intercambios. Modo intercambio solo produce intercambios completos y recíprocos con una correspondencia única de todas las sesiones.
- El enlace no desplaza grupos PB y no asigna un espacio cuya capacidad sea menor que los inscritos del grupo movido. Administrador puede confirmar excepciones de PB/capacidad si la integridad del movimiento sigue siendo válida.
- El estado de PB del grupo origen incluye cambios generales pendientes de la misma edición; el Back evalúa el estado resultante, no únicamente el estado anterior.
- Se comparan revisiones de todos los grupos involucrados antes de escribir. Toda diferencia invalida la propuesta.
- Se registra auditoría por cada grupo y sesión efectivamente cambiados; una sesión no modificada o deseleccionada no se escribe.

## 6. Cupos: regla implementada; falta validarla con casos reales

Para cada grupo que efectivamente cambie de espacio, Back calcula `capacidadLimite` con todos sus horarios resultantes, aunque la búsqueda haya incluido solo algunas sesiones. `cupoGeneral` adopta siempre esa capacidad mínima de los espacios físicos, sin importar el tipo. Todo delta aplicado a `cupoGeneral` se traslada en la misma cantidad, positiva o negativa, a `cupoReingreso`, respecto de los cupos que traía el snapshot propuesto antes del cálculo.

Después del cálculo, `cupoPrimerIngreso` no supera `cupoGeneral`; `cupoReingreso` tampoco supera `cupoGeneral`; `cupoComplementario` no supera `cupoGeneral` ni `cupoReingreso`; y `cupoPrimerIngreso + cupoReingreso` no es menor que `cupoGeneral`. `cupoMaximo` conserva el límite de capacidad. Si el delta deja `cupoReingreso` negativo o los cupos no pueden cumplir todas las reglas, Back rechaza antes de escribir. Un cambio válido que ajuste cupos devuelve advertencia previa con los valores antes/después; solo Administrador/DSE puede confirmarla. Si falta la capacidad de algún espacio, Back rechaza antes de escribir.

## 7. Resultado y errores

La respuesta de guardado debe discriminar al menos:

- **Aplicado:** lista canónica de grupos/sesiones cambiados, revisiones nuevas, auditoría y estado de notificación.
- **Conflicto:** cambió una revisión o disponibilidad; no hubo escritura; se devuelven datos actuales autorizados y se requiere nueva búsqueda.
- **Rechazo de negocio:** permiso, ventana, PB, capacidad o regla de correspondencia; no hubo escritura y se devuelve código estable, regla y detalle.
- **Confirmación requerida:** advertencia específica con confirmación opaca ligada al actor, propuesta y revisiones; aún no hubo escritura.
- **Operación no disponible:** el origen/SP no ofrece la garantía o capacidad necesaria; se rechaza antes de tocar datos.
- **Aplicado, notificación pendiente:** escritura confirmada; el correo queda en reintento durable. Nunca pedir que la persona repita el guardado.

Un fallo después de iniciar escrituras cuya aplicación no puede determinarse no se presenta como rechazo ni como éxito. El Back debe reconciliar por estado durable/idempotencia y el Front debe mostrar instrucciones accionables, no términos internos como “hash” o “recuperación”.

## 8. Estado implementado y límites que siguen vigentes

### 8.1 Persistencia actual por origen (Back inspeccionado el 2026-09-28)

| Origen | Mecanismo que existe hoy | Lo que sí demuestra | Lo que no demuestra |
|---|---|---|---|
| ORACLE | El guardado legacy de encabezado llama `SIPF1_ALTAGRUPO2`; después el Back recorre el snapshot de horarios y llama `SIPF1_ALTAHORARIO`. | Puede borrar las reservas del grupo y volver a insertar los horarios que el Back reenvíe. `ALTAHORARIO` evita insertar de nuevo una reserva exactamente existente. | `ALTAHORARIO` no actualiza ni elimina una reserva individual. `ALTAGRUPO2` borra todas las reservas del grupo y hace `COMMIT`; `ALTAHORARIO` tiene `pautocommit='S'` por defecto y confirma cada alta. No hay garantía “todo o nada” para intercambio de dos grupos con esta secuencia. |
| MSSQL | `guardarGrupoMSSQLAgregado` construye una transacción SQL con `DELETE GrupoHorario` y reinserta el snapshot; usa `BEGIN TRANSACTION`, `COMMIT` y `ROLLBACK` ante error. | El reemplazo del conjunto de horarios de **un grupo por llamada** está dentro de una transacción. | El método actual procesa un grupo por llamada. Dos guardados separados para A y B son dos transacciones; el código actual no demuestra que un intercambio A↔B quede en una única transacción. Tampoco se ha validado aún que las dependencias/triggers de SQL Server preserven la garantía. |

**Conclusión operativa:** Back ejecuta `Grupos.guardarGrupo` una vez por cada snapshot, en secuencia, y vuelve a leer cada grupo. Oracle puede tener commits internos por grupo; MSSQL usa la transacción existente de un grupo por llamada. Un intercambio no es una transacción global.

La búsqueda temporal se conserva en memoria de Back por diez minutos; no reserva espacios. El permiso se revisa en ambos resolvers. Para Enlace/CSI, las ventanas se configuran mediante `EDICION_ESPACIOS_PERIODOS_ENLACE` (periodos separados por coma); Administrador/DSE no depende de esa lista.

**Pendiente operativo:** no depender de reiniciar el servicio para abrir o cerrar la edición de espacios para Enlace/CSI. La variable `.env` actual se carga al iniciar Back; se requiere definir una configuración administrable o un mecanismo de recarga controlada, con auditoría y efecto claro para las solicitudes nuevas.

1. Probar `asignacionId`, sesiones ambiguas y horarios disponibles en datos reales de ambos orígenes.
2. Probar que el guardado legacy conserva encabezado, horarios no seleccionados, mensajes y planes.
3. Probar un movimiento libre de varias sesiones en Oracle y MSSQL.
4. Probar un intercambio completo y simular una falla entre los dos guardados; confirmar que la respuesta parcial y los datos refrescados son correctos.
5. Validar en el ambiente integrado la confirmación administrativa y el tope de `cupoMaximo` frente a la capacidad de los espacios.
6. Verificar la inserción y procesamiento posterior de `Notificaciones`; no se construyó un outbox nuevo.

## 9. Pruebas de habilitación pendientes

Antes de habilitar la pestaña en un ambiente de usuarios, demostrar en pruebas de Back y base de datos:

1. rechazo sin escritura ante permisos/revisión/destino no válido;
2. aplicación completa de una propuesta libre de varias sesiones;
3. aplicación completa de intercambio recíproco de dos grupos;
4. manejo comprobable de una falla en cualquier etapa legacy: resultado parcial claro, relectura y posibilidad de continuar sin repetir automáticamente escrituras;
5. preservación de datos ajenos a las sesiones/cupos incluidos;
6. idempotencia al repetir la misma solicitud;
7. notificación posterior sin repetir ni revertir un cambio ya aplicado.

La funcionalidad ya está conectada en el código para ambos orígenes, pero todavía no se ejecutaron pruebas/builds de esta entrega. La prueba integrada debe preceder a su despliegue. El guardado legacy es la estrategia explícita, no un fallback silencioso.
