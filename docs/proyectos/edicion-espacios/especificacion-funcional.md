# Especificacion funcional: edicion de espacios de grupo

## Estado y proposito

**Estado:** funcional consolidada e implementada en código; pendiente de pruebas integradas en ambiente.

Esta especificacion define el comportamiento de negocio de la pestana `Espacios` dentro de la ventana de edicion de grupo de SIPLE. Su objetivo es permitir cambios de espacio controlados, tanto directos como por intercambio, y asegurar que las personas afectadas reciban la notificacion institucional ya disponible en el backend.

No define consultas GraphQL, mutaciones, tokens, modelos de transporte ni componentes de frontend. Esas decisiones pertenecen a la siguiente fase tecnica.

## Objetivo

Permitir que administradores y enlaces encuentren, seleccionen y guarden una propuesta de cambio para una o varias sesiones de un grupo, respetando las reglas de su perfil, la coincidencia exacta de horario, la disponibilidad y la capacidad. Cuando el cambio afecte a otros grupos, estos tambien forman parte de la operacion y de la notificacion resultante.

## Conceptos funcionales

| Termino               | Definicion                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Grupo                 | Grupo academico que se esta editando. Puede tener una o varias sesiones.                                                                    |
| GrupoHorario          | Una sesion concreta del grupo: plantilla, dia, hora de inicio, hora de fin y espacio actual. Es la unidad seleccionable de trabajo.         |
| Conjunto seleccionado | Los `GrupoHorario` que se enviaran juntos a buscar una propuesta. Todas las sesiones del grupo inician seleccionadas.                       |
| Propuesta             | La combinacion de opciones elegidas para todas las sesiones seleccionadas. Puede ser solo con espacios libres o incluir un intercambio.     |
| Espacio libre         | Espacio disponible para cada dia y franja exactos de las sesiones seleccionadas.                                                            |
| Intercambio           | Cambio total y reciproco entre dos grupos elegibles con el mismo patron completo de sesiones: se intercambian todos sus espacios.          |
| Mismo espacio         | Preferencia de busqueda que exige que todas las sesiones seleccionadas usen una sola clave de espacio destino.                              |
| PB                    | Marca de preferencia de movilidad asociada a un grupo. Se representa con el simbolo de silla de ruedas cuando interviene en un intercambio. |
| Solicitar PB          | Indicador que la persona usuaria activa cuando el cambio de espacio responde a una necesidad de movilidad del grupo origen.                 |
| Ventana de tiempo     | Periodo definido por administracion, asociado a un periodo escolar, durante el cual los enlaces pueden gestionar cambios de espacio.         |

## Perfiles y reglas de autorizacion

### Administrador

Un administrador puede buscar y proponer cambios sin las restricciones operativas de enlaces:

- no esta sujeto a la ventana de tiempo del periodo;
- puede trabajar con grupos de cualquier departamento;
- puede usar espacios publicos o particulares;
- puede cambiar espacios independientemente de su tipo, incluidos los virtuales;
- puede continuar, con confirmacion explicita, ante advertencias de PB o capacidad insuficiente.

Esta facultad no elimina validaciones de integridad. Un espacio que deje de estar disponible, una propuesta que ya no sea consistente u otro error operativo no puede aplicarse y debe regresar una explicacion.

### Enlace

Un enlace puede cambiar espacios solamente si se cumplen todas estas condiciones:

- la ventana de tiempo autorizada por administracion para el periodo del grupo esta vigente;
- el grupo corresponde a su propio departamento;
- el espacio destino es de uso publico o es un taller particular administrado por ese enlace;
- la propuesta conserva dia, hora de inicio y hora de fin exactos de cada `GrupoHorario` seleccionado;
- si hay intercambio, los grupos involucrados son elegibles dentro de su departamento;
- no se desplaza a un grupo marcado PB;
- la capacidad del espacio no es menor que los alumnos inscritos en el grupo que se moveria.

Para enlaces, los espacios que pueden cambiarse son espacios fisicos, no virtuales. Quedan fuera de esta categoria los espacios de tipo virtual, tales como `VIDEOCONFERENCIA`, `EN LINEA`, `ASESORIA`, `BLOQUEO` y `PAP-SIN-ESPACIO`, asi como cualquier otro indicado como virtual por su tipo. Ademas, una sesion cuyo espacio actual sea `VIDEOCONFERENCIA`, `EN LINEA` o `ASESORIA` no es seleccionable para Enlace/CSI: se muestra deshabilitada y no se preselecciona. El Back rechaza tambien un intento enviado manualmente. Esta restriccion de tipo no aplica a administradores.

Si la ventana de tiempo del periodo no esta vigente, se muestra un mensaje informativo y el enlace no puede realizar busquedas. La autoridad sobre la ventana de tiempo, los departamentos y los talleres administrados reside en el backend.

## Experiencia de usuario en la pestana Espacios

### Prioridad visual

La tabla de trabajo es el elemento principal de la pestana: debe dar espacio suficiente para seleccionar sesiones, comparar alternativas y leer advertencias. La plantilla grafica de horario se conserva unicamente como referencia visual y puede mostrarse en un area secundaria, mas pequena que la tabla.

### Tabla de sesiones y propuestas

La tabla muestra las sesiones del grupo y permite seleccionar una, varias o todas. Debe existir una accion de **seleccionar/deseleccionar todas**.

Para cada sesion se presenta, como minimo:

- selector de la sesion;
- espacio actual;
- plantilla;
- dia, hora de inicio y hora de fin;
- capacidad maxima del espacio actual;
- espacio destino propuesto;
- condicion de la propuesta: `Libre` o identificacion del grupo y materia cuando implique intercambio;
- capacidad maxima del espacio destino.

Cuando el grupo que tendria que moverse tiene marca PB, la propuesta muestra el simbolo de silla de ruedas junto con la identificacion correspondiente. La presencia del indicador no oculta la opcion: la diferencia esta en la validacion de ejecucion segun el perfil.

Si el grupo origen ya tenia la marca PB al abrir la ventana de edicion, el encabezado de la tabla debe indicarlo visualmente. El estado que se usa para buscar y guardar debe reflejar tambien los cambios que la persona usuaria haga a PB en la pestana de generales durante la misma edicion.

El acomodo visual puede adaptarse al diseno final siempre que esos datos sigan siendo comparables sin abandonar la tabla de trabajo.

### Estado inicial y panel de control

- Al abrir la pestana, todas las sesiones del grupo estan seleccionadas.
- El panel inferior incluye un control excluyente entre:
  - `Espacios libres`;
  - `Intercambiar espacio con grupo`.
- `Espacios libres` es el modo inicial; no incluye intercambios.
- El panel incluye la casilla `Mismo espacio`, activada por defecto.
- El panel incluye el indicador `Asignar PB a este grupo`, desactivado por defecto con el icono de silla de ruedas.
- El panel incluye el boton `Buscar`.

`Mismo espacio` controla el resultado esperado de la busqueda:

- **Activada:** el backend debe devolver propuestas que asignen la misma clave de espacio destino a todas las sesiones seleccionadas.
- **Desactivada:** puede devolver propuestas con espacios diferentes por sesion. Si existe un mismo espacio valido para todas, se presenta como alternativa prioritaria.

Al activar `Asignar PB a este grupo`, el backend devuelve unicamente opciones validas para esa necesidad. Si el movimiento se ejecuta, el grupo origen queda marcado PB.

Una vez que existe una respuesta de busqueda en pantalla, cambiar `Espacios libres`, `Mismo espacio` o `Asignar PB a este grupo` invalida las opciones mostradas y provoca una nueva busqueda automática con el nuevo estado de los controles. De igual manera cuando un usuario añade o quita una selección que no estaba considerada en la búsqueda original.
En estos casos de búsquedas automáticas: Si ya existía una selección de espacio libre previa en los renglones y el nuevo resultado de la búsqueda sigue conteniendo el espacio seleccionado previamente este se conservará en los controles en los que aplique, en los demás se tendrá una opción inválida de `Selecciona un espacio` en espera de captura.
Si hay algun renglon de la tabla con opción inválida entonces el botón guardar no deberá estar habilitado y se remarcará en warning el campo inválido.

## Flujo funcional

### 1. Seleccion

La persona usuaria conserva todas las sesiones seleccionadas o ajusta el conjunto con los selectores de la tabla. Solo las sesiones seleccionadas participaran en la busqueda y, eventualmente, en el cambio guardado.
Si el espacio de una sesión es el mismo que el cambio propuesto o bien si el renglón se deselecciona posteriormente a la búsqueda de espacio entonces el guardado no se realizará para este renglon (no se enviará al back para su guardado).

### 2. Busqueda de propuestas

Al presionar `Buscar`, el frontend comunica al backend:

- el grupo que se esta editando;
- las sesiones seleccionadas;
- el modo elegido: solo libres o incluir grupos en el mismo horario;
- el estado de `Mismo espacio`.
- el estado de `Asignar PB a este grupo`.

El backend aplica las reglas de autorizacion y coincidencia exacta, resuelve las alternativas posibles y regresa una lista de opciones por cada sesion seleccionada. El frontend muestra esas opciones para que la persona usuaria construya una propuesta; no decide por si mismo disponibilidad, permisos ni elegibilidad.

La respuesta contiene un arreglo de `n` arreglos, donde `n` es el numero de `GrupoHorario` seleccionados. Cada arreglo corresponde a una sesion y cada una de sus opciones contiene:

- dia;
- hora de inicio;
- hora de fin;
- espacio;
- capacidad;
- grupo y materia, cuando sea una alternativa de intercambio;
- `info`, para PB u otras indicaciones que se incorporen despues.

Los arreglos pueden tener distinta cantidad de opciones. Con `Mismo espacio` activado, una clave de espacio que aparezca para una sesion debe estar disponible tambien para todas las demas sesiones seleccionadas; por eso las listas contienen las mismas alternativas compatibles. Con la casilla desactivada, cada lista puede contener alternativas diferentes.

Cada renglon de la tabla recibe sus opciones en un dropdown. Cuando la lista de ese renglon contiene opciones, se muestra la primera como seleccionada inicialmente. Con `Mismo espacio` activado, los dropdowns estan vinculados: cambiar una seleccion cambia las demas al mismo espacio. Con la casilla desactivada, cada dropdown se elige de manera independiente.

Ejemplo de busqueda con espacio comun:

1. El grupo `A01` tiene sesiones lunes y miercoles de 09:00 a 11:00, ambas en `C-201`.
2. La persona usuaria deja seleccionadas ambas sesiones, usa el modo inicial y conserva `Mismo espacio` activado.
3. El backend busca salones libres para los dos horarios que sean la misma clave de espacio.
4. Si `C-301` esta libre en ambas franjas, aparece como opcion en los dropdowns de lunes y miercoles.
5. Como los dropdowns estan vinculados, al elegir `C-301` en uno queda seleccionado tambien en el otro.
6. La persona usuaria deja la propuesta pendiente de guardar con el grupo.

### 3. Busqueda con intercambio

En `Intercambiar espacio con grupo`, el backend incluye, en las listas de opciones de cada sesion:

- propuestas con espacios libres;
- propuestas de espacios ocupados por grupos elegibles del departamento correspondiente;
- informacion suficiente para identificar el grupo y materia de una propuesta de intercambio;
- la marca PB, si existe, incluso cuando haga que la propuesta no pueda ejecutarse para un enlace.

Un intercambio siempre es total entre dos grupos. Para que un grupo destino sea elegible, la totalidad de sus sesiones debe coincidir con la totalidad de las sesiones del grupo origen:

- ambos grupos tienen el mismo numero de sesiones;
- para cada sesion del grupo origen existe una sesion del grupo destino con el mismo dia, hora de inicio y hora de fin;
- el intercambio mueve todos los espacios de ambos grupos; no existe un intercambio parcial de solo algunos renglones.

Por esta regla, el modo de intercambio requiere que todas las sesiones del grupo origen formen parte del conjunto seleccionado. El backend solo devuelve opciones de intercambio que representen al mismo grupo destino en todos los renglones emparejados.

La persona usuaria puede revisar y seleccionar una propuesta mostrada. La validacion definitiva no se adelanta solo por haberla seleccionado.

### 4. Guardado y validacion final

La propuesta elegida queda como cambio pendiente dentro del editor de grupo. Se ejecuta con el boton **Guardar** general del grupo, junto con los demas cambios pendientes que tenga el grupo.

Al guardar, el backend vuelve a validar la propuesta con el estado mas reciente. Puede ocurrir uno de estos resultados:

- **Valida:** se aplican todos los movimientos de la propuesta.
- **No valida para enlace:** no se aplica ningun movimiento y se explica la regla incumplida, por ejemplo capacidad insuficiente, PB o ventana de tiempo no vigente para el periodo.
- **Advertencia confirmable para administrador:** ante PB o capacidad insuficiente, se informa claramente el efecto y se permite confirmar la excepcion.
- **Error de integridad u operacion:** no se aplica ningun movimiento, incluso para administrador; se informa el motivo.

La propuesta es una sola acción desde la experiencia de usuario, pero el guardado legacy no puede garantizar atomicidad entre grupos. Si falla parte de un intercambio, el sistema informa qué grupos se confirmaron, vuelve a consultar los datos disponibles y no reintenta automáticamente el resto. La persona usuaria no necesita conocer estados internos de control Oracle.

## Capacidad y cupo del grupo

La capacidad no impide que una propuesta aparezca ni que se seleccione. La restriccion se aplica en la validacion de guardado.

- Para enlaces, un espacio con capacidad menor que los alumnos inscritos impide ejecutar la propuesta y debe explicar el motivo.
- Para administradores, se presenta una advertencia confirmable antes de ejecutar la excepcion.
- En el snapshot final se consideran **todos** los espacios asignados al grupo, incluidas las sesiones que la persona no seleccionó para buscar. `CG` adopta la capacidad mínima de todos esos espacios físicos, al aumentar o reducir, sin importar el tipo de espacio. `RE` cambia en la misma diferencia entre el `CG` que traía la propuesta y el nuevo `CG` calculado. `PI` se reduce si supera `CG`; `AC`, si supera `RE`; `cupoMaximo` conserva el límite físico.
- Todo resultado conserva estas reglas: `PI <= CG`, `RE <= CG`, `AC <= CG`, `RE + PI >= CG` y `AC <= RE`. Si el nuevo `RE` quedara negativo, o no se pudieran conservar las reglas, no se guarda el movimiento.
- En un intercambio, el cálculo se hace de forma independiente con todos los espacios resultantes de cada grupo. Los ajustes requieren la advertencia y confirmación administrativa definidas para los cambios de cupo.
- En un intercambio, esta regla se aplica a cada grupo que haya cambiado de espacio. Si hay que modificar los cupos del grupo destino hay que agregar el correspondiente registro de su bitácora.
- Antes de confirmar, se debe informar el cupo anterior y el cupo resultante de cada grupo afectado.

## Preferencias de movilidad PB

Una propuesta de intercambio puede incluir un grupo con marca PB; por ello debe mostrarse, identificarse y poder revisarse desde la lista. El grupo origen tambien puede tener PB desde que se abre la ventana o adquirirla en la pestana de generales.

- Un enlace no puede ejecutar una propuesta que obligue a mover un grupo marcado PB. El mensaje debe identificar al grupo afectado y explicar que cuenta con preferencias de movilidad.
- Si el grupo origen tiene PB al momento de guardar, el backend niega la accion a una persona no administradora.
- Un administrador recibe una advertencia, puede revisar el efecto y, si lo confirma, continuar con el movimiento.
- La confirmacion administrativa para esta excepcion es distinta de un error operativo: no autoriza a ignorar conflictos reales de disponibilidad ni inconsistencias de datos.

## Notificaciones

El backend ya posee el proceso institucional para notificar por correo. Cuando una operacion se aplica correctamente, se deben notificar los cambios a:

- profesores de los grupos afectados;
- alumnos inscritos en los grupos afectados.

La notificacion debe corresponder exclusivamente a movimientos confirmados y debe comunicar, al menos, el espacio anterior, el espacio nuevo y las sesiones afectadas. El detalle de como el frontend solicita, recibe y presenta el resultado de este proceso se define en la fase tecnica.

## Criterios de aceptacion funcionales

1. Al abrir la pestana, todas las sesiones del grupo estan seleccionadas y existe una accion para seleccionar o deseleccionar todas.
2. La tabla permite comparar el espacio actual, horario, capacidad y destino propuesto de cada sesion.
3. La busqueda predeterminada busca solo espacios libres y exige un mismo espacio para todas las sesiones seleccionadas.
4. La respuesta de una busqueda contiene una lista de opciones por cada sesion seleccionada, con dia, horas, espacio, capacidad, datos de intercambio e informacion adicional.
5. Cada lista se muestra en el dropdown de su renglon y selecciona inicialmente su primera opcion disponible.
6. Con `Mismo espacio` activado, los dropdowns quedan vinculados al mismo espacio; al desactivarlo pueden elegirse por separado y una alternativa comun valida tiene prioridad.
7. Al cambiar `Mismo espacio` o `Asignar PB a este grupo` despues de recibir resultados, se realiza una nueva busqueda.
8. `Asignar PB a este grupo` filtra la busqueda a opciones validas y, si se ejecuta el movimiento, deja marcada la preferencia PB en el grupo origen.
9. Para enlaces, las opciones de cambio corresponden a espacios fisicos, activos o vigentes; los tipos virtuales quedan excluidos. Las sesiones cuyo espacio actual sea `VIDEOCONFERENCIA`, `EN LINEA` o `ASESORIA` tampoco pueden seleccionarse. Un administrador no tiene esa restriccion de tipo.
10. Si el grupo origen ya esta marcado PB, el encabezado lo indica y el Front impide buscar/guardar para una persona no administradora; Back conserva la validación obligatoria.
11. La busqueda de un enlace fuera de la ventana de tiempo vigente para el periodo esta bloqueada con un mensaje claro.
12. El enlace solo recibe propuestas compatibles con sus permisos, departamento y espacios autorizados.
13. Todo candidato respeta dia, hora de inicio y hora de fin exactos de cada sesion seleccionada.
14. El modo de intercambio muestra espacios libres y ocupados elegibles, con la identificacion de grupo/materia y el indicador PB cuando corresponda.
15. Un intercambio solo se ofrece si los grupos origen y destino tienen el mismo numero total de sesiones y una coincidencia exacta de dia, hora de inicio y hora de fin en todas ellas; el cambio intercambia todos sus espacios.
16. Una propuesta con capacidad insuficiente se puede mostrar y seleccionar, pero un enlace no puede ejecutarla; un administrador puede confirmarla tras recibir advertencia.
17. Una propuesta que implique mover un grupo PB se bloquea para enlace y se advierte; Back vuelve a validar la regla antes de escribir.
18. El guardado definitivo se realiza con el boton Guardar general del grupo y el backend valida de nuevo antes de aplicar.
19. Una validación de permisos, revisión, horario o capacidad se resuelve antes de escribir. Si falla una escritura legacy después de iniciada, el sistema informa el resultado parcial con los grupos afectados y no presenta éxito total.
20. Antes de confirmar un cambio que modifique cupo, se muestran el cupo anterior y el resultante de todos los grupos afectados.
21. Los movimientos exitosos activan el proceso existente de notificacion a profesores y alumnos involucrados.

## Seguimiento técnico pendiente

Los siguientes puntos son validaciones de implementación y operación; no reabren las reglas funcionales anteriores:

1. Contrato de busqueda: identificadores de grupo y `GrupoHorario` que envia el frontend, tipos exactos de los campos ya acordados por opcion y como se representa la relacion entre las listas vinculadas por `Mismo espacio`.
2. Contrato de validacion y guardado: como se integra la propuesta con el guardado general de grupo y como el backend devuelve validacion, advertencia confirmable, rechazo u error operativo.
3. Autorizacion administrativa: mecanismo seguro por el cual, despues de una confirmacion explicita, el backend autoriza excepciones de PB o capacidad insuficiente sin confiar en una afirmacion del cliente.
4. Transaccionalidad: garantia de que los grupos involucrados, horarios, espacios y cupos se actualizan como una sola operacion.
5. Notificaciones: forma en que el frontend indica que el cambio requiere notificacion, que respuesta recibe y como comunica al usuario un resultado exitoso o una incidencia del proceso existente.
6. Bitacora y actualizacion de estado: detalle que se registra para cada movimiento y datos finales que el frontend debe refrescar despues de guardar.
7. Catalogos y autorizacion: fuente de verdad para rol, ventana de tiempo vigente por periodo, departamento del grupo, espacios publicos, talleres administrados, tipo y vigencia del espacio, y marca PB.
8. Mensajes de negocio: catalogo de codigos y textos para que el frontend explique de manera consistente cada rechazo, advertencia o conflicto de concurrencia.

## Limites de esta especificacion

Esta especificación describe el comportamiento funcional y no sustituye los contratos GraphQL ni la autorización de Back. La implementación reutiliza el proceso institucional de notificaciones; las pruebas integradas y la validación del resultado parcial entre grupos siguen pendientes.
