# Fase 1 — Matriz de reglas, permisos y alcance v1

**Fecha de aprobación:** 2026-09-04  
**Iniciativa:** cambio segmentado de características de grupos  
**Estado:** aprobada para diseñar el contrato v1  
**Fuente:** decisiones funcionales confirmadas y censo consolidado de Fase 0.

### Nomenclatura de concurrencia

En esta iniciativa, el estado mutable de un grupo se identifica mediante una
revisión controlada por Backend. Se usarán estos nombres en el contrato, código
y documentación:

- `revisionGrupoEsperada`: revisión que Front leyó y contra la que propone el
  cambio.
- `revisionGrupoActual`: revisión vigente que Backend encuentra al validar o
  devuelve en un conflicto.
- `revisionGrupoNueva`: revisión emitida por Backend después de aplicar con
  éxito.

Estos nombres describen el estado del grupo y no deben confundirse con la
versión del contrato GraphQL (`v1`) ni con una versión de la base de datos.

## 1. Principios de autorización

- El actor se obtiene exclusivamente de `context.auth`; el request no puede
  elegir usuario, rol, departamento ni alcance.
- El Backend evalúa autorización, alcance e integridad con el estado canónico
  recién cargado.
- Una solicitud que incluya varios dominios debe pasar todas sus autorizaciones
  y validaciones. Si una falla, se rechaza la solicitud completa y no se aplica
  ningún dominio.
- Las restricciones de interfaz son ayuda visual y nunca sustituyen estas
  decisiones servidoras.
- Para las reglas funcionales de esta matriz, un administrador puede ejecutar la
  operación con una advertencia confirmable, incluso cuando la regla implique
  disponibilidad, inexistencia, conflicto, colisión o datos inválidos. La
  confirmación debe quedar ligada al comando, revisión del grupo y auditoría. Esto no
  convierte una falla técnica de transporte, base de datos o infraestructura en
  una advertencia funcional.

## 2. Matriz de permisos y alcance

| Dominio | Permiso requerido para no administrador | Alcance de enlace | Facultad administrativa |
| --- | --- | --- | --- |
| Cupos | `modificarCupos` | Grupo del departamento propio; las reglas de cupo se validan en Backend. | Puede modificar cualquier departamento y confirmar advertencias de cupos o inscritos. |
| Espacios y horarios | `editarEspacios` | Grupo del departamento propio; ventana vigente; espacio físico público o taller particular administrado por el enlace; no virtual. | Sin restricción de ventana, departamento o tipo de espacio; puede confirmar las advertencias funcionales de PB, capacidad, disponibilidad e integridad. |
| Mensajes | `editarGrupos` | Grupo del departamento propio. | Puede operar cualquier departamento. |
| Modificadores/PB | `editarGrupos` | Grupo del departamento propio. | Puede operar cualquier departamento; PB se deriva y valida en servidor. |
| Materias | `editarGrupos` | Grupo del departamento propio; materia vigente y relación válida. | Puede operar cualquier departamento, manteniendo integridad de catálogo. |
| Planes compartidos | `editarGrupos` | Grupo del departamento propio; programa/materia válidos. | Puede operar cualquier departamento, manteniendo integridad de catálogo y cupos. |
| Lote homogéneo | Permiso del dominio modificado para cada objetivo. | Cada objetivo debe estar dentro del alcance del actor. | Puede operar cualquier departamento, sin mezclar origen ni periodo. |

`revisarGrupoPlaneacion` queda censado como escritura independiente y fuera del
comando parcial v1; conservará su contrato actual hasta contar con una decisión
específica de migración.

## 3. Reglas de dominio

### Cupos

- Todos los cupos son enteros y no negativos.
- Cada distribución (`primerIngreso`, `reingreso`, `complementario`) no puede
  superar `cupoGeneral`.
- En v1 no se exige que las distribuciones sumen el cupo general.
- `complementario` no puede ser mayor que `reingreso`.
- `cupoGeneral` no puede ser mayor que `primerIngreso + reingreso`.
- `cupoGeneral` no puede quedar por debajo de los alumnos inscritos para un
  enlace. Un administrador puede dejarlo por debajo mediante advertencia
  confirmable y auditoría.
- Una reducción que genere advertencia debe detenerse hasta confirmación
  explícita del administrador cuando la política aplicable lo permita.

### Espacios, horarios y PB

- El espacio destino debe existir, estar activo/vigente y tener clave
  normalizada.
- Para un enlace, la capacidad del espacio destino no puede ser menor que los
  alumnos inscritos del grupo que se moverá.
- Para un administrador, toda restricción funcional de capacidad,
  disponibilidad, inexistencia, vigencia, PB o integridad produce advertencia
  confirmable; no hay un rechazo funcional adicional por el solo hecho de la
  restricción.
- Un enlace no puede mover un grupo con PB ni ejecutar un intercambio que
  desplace otro grupo con PB.
- En un movimiento aplicado, si la menor capacidad de los espacios resultantes
  obliga a ajustar cupos, el cambio de cupos debe formar parte de la operación,
  confirmarse antes de escribir y auditarse por cada grupo afectado.
- Si el movimiento requiere aumentar cupos, sólo se incrementan `cupoGeneral` y
  `reingreso`; `primerIngreso` y `complementario` permanecen sin cambios.
- Los intercambios requieren coincidencia completa de sesiones, día y franja;
  no se admite intercambio parcial.
- Las operaciones de horario son explícitas por asignación identificable. En
  términos prácticos, cada cambio debe decir qué asignación se modifica y qué
  operación se ejecuta; una asignación omitida no se borra ni se reemplaza por
  accidente. No se permite interpretar una colección incompleta como “borrar
  todo y volver a insertar lo recibido”.

### Mensajes

- El tipo debe pertenecer al catálogo permitido.
- El contenido se normaliza y sanitiza en Backend.
- Oracle puede reemplazar el mensaje de un tipo explícito; no puede modificar
  otros tipos no incluidos en el comando.
- Para `POPUP`, la representación de dominio del contrato v1 es texto plano:
  Front muestra al usuario el texto sin etiquetas HTML. La persistencia actual
  conserva un envoltorio HTML en la base de datos y el transporte legacy usa
  Base64; esos detalles pertenecen al adaptador de persistencia, no al dominio.
- El round-trip de `POPUP` debe ser único y sin doble codificación: al leer,
  Front decodifica el HTML almacenado y extrae el texto; al enviar, el adaptador
  normaliza el texto, genera el HTML esperado y aplica Base64 sólo en el punto
  que Oracle lo requiere. Front no debe renderizar HTML crudo no confiable.
- Evidencia del censo actual: `EditarMensajesComponent` usa
  `Utils.decodificarPopupHtml` y `mensajeLimpio` para presentar texto;
  `GruposDataService` usa `Utils.codificarPopupHtmlParaEnvio`; y el adaptador
  Oracle aplica/retira Base64 en la frontera de persistencia. El contrato nuevo
  debe conservar ese comportamiento observable sin exponer HTML como dato de
  edición.

### Modificadores, materias y planes

- PB/accesibilidad se deriva de los modificadores válidos en Backend; Front no
  envía el resultado como autoridad.
- Materias y programas deben existir, estar vigentes cuando aplique y guardar
  relación válida con el grupo.
- Planes compartidos usan alta, actualización o baja explícita por
  `(programa, materia)`.
- La baja queda preparada como una operación `BAJA` explícita e identificable en
  el contrato/handler. La API pública actual no tiene todavía una operación de
  eliminación; mientras la persistencia no la soporte, debe responder un
  rechazo tipado de operación no disponible y no simular una baja mediante
  omisión de la colección.
- Las operaciones de materias usan identificadores explícitos y no sustituyen
  la colección completa por omisión.

## 4. Advertencias y rechazos

| Situación | Enlace | Administrador |
| --- | --- | --- |
| PB incompatible o grupo PB afectado | Rechazo bloqueante | Advertencia confirmable, ligada a `revisionGrupoEsperada` y comando |
| Capacidad menor que alumnos inscritos | Rechazo bloqueante | Advertencia confirmable; el ajuste de cupos requiere confirmación |
| Espacio inexistente, inactivo o inválido | Rechazo | Advertencia confirmable |
| Colisión o inconsistencia de horario | Rechazo | Advertencia confirmable |
| Grupo fuera de departamento/alcance | Rechazo | Advertencia confirmable |
| Permiso insuficiente | Rechazo | Advertencia confirmable cuando el actor tiene rol administrativo válido |
| Advertencia no confirmada o de otra revisión del grupo | Rechazo | Advertencia confirmable |

Toda advertencia se vuelve a validar al escribir y solo se acepta si su código
corresponde al mismo objetivo, `revisionGrupoEsperada` y huella del comando.

## 5. Atomicidad, origen y lotes

- Cada comando unitario opera sobre un solo origen (`ORACLE` o `MSSQL`).
- Una solicitud que mezcle orígenes se rechaza en v1.
- La persistencia, revisión del grupo y auditoría deben confirmar o fallar juntas dentro
  del origen autoritativo; si no es posible, el caso queda fuera de alcance.
- Los lotes v1 deben usar un solo origen y periodo, incluir
  `revisionGrupoEsperada` por objetivo,
  validar todo antes de escribir y operar únicamente en `TODO_O_NADA`.
- `PARCIAL`, sagas entre orígenes y transacciones distribuidas quedan fuera de
  alcance.

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

## 6. Casos fuera de alcance de la Fase 1

- Implementar o consumir el contrato GraphQL.
- Cambiar schema, resolvers, persistencia o componentes.
- Habilitar en la API la baja efectiva de planes antes de que exista soporte de
  eliminación en persistencia; la operación queda reservada en el contrato,
  pero su ejecución debe permanecer rechazada como no disponible.
- Resolver `revisarGrupoPlaneacion` dentro del comando parcial.
- Definir una política de resultados parciales o mezcla Oracle/MSSQL.
- Retirar rutas legacy o `Facade`.

## 7. Criterio de salida

La Fase 1 queda aprobada porque las decisiones tomadas tienen una política
operativa explícita, permisos y alcance por dominio, reglas de advertencia y
rechazo, atomicidad por origen y casos fuera de alcance. El contrato v1 puede
ser diseñado contra esta matriz sin que el implementador tenga que inferir una
regla de negocio.
