# Plan de trabajo: guardado segmentado de grupos

## 1. Propósito y resultado verificable

Este plan dirige la implementación del guardado **parcial, seguro y coordinado**
de características de grupos SIPLE. Está diseñado para conservar el control de
la iniciativa aun si se interrumpe una sesión, cambian los agentes o se ejecuta
en varios bloques de trabajo.

El resultado final será una familia de comandos GraphQL versionados que permita
modificar un grupo por dominios definidos (cupos, mensajes, modificadores,
horarios/espacios, materias y planes), con las siguientes garantías:

- Ninguna pantalla cliente decide por sí misma autorización, validez ni
  auditoría.
- Un cambio parcial no sobrescribe atributos ni colecciones que no se incluyeron
  explícitamente en el comando.
- El servidor verifica permisos, alcance, reglas de negocio, versión esperada e
  idempotencia antes de persistir.
- La bitácora pertenece exclusivamente al backend: cada inserción,
  actualización o eliminación efectiva se registra en base de datos desde el
  estado validado por el servidor. El frontend jamás construye ni envía datos de
  auditoría.
- El resultado siempre es explícito: aplicado con el grupo canónico, rechazado
  con errores de regla, o conflicto de versión.
- La persistencia, versión y auditoría son atómicas dentro de cada origen o
  quedan trazables y recuperables mediante un mecanismo durable aprobado.
- La edición completa, los cambios rápidos, la plantilla de horarios y los
  lotes utilizan el mismo modelo de dominio; no se construyen atajos hacia
  `guardarGrupo` ni rutas legacy.

Este documento complementa y operacionaliza
`orquestador-guardar-por-partes.md`; si existe contradicción, prevalecen los
principios y las restricciones de aquel documento hasta que una decisión se
registre formalmente en ambos.

---

## 2. Repositorios, roles y regla de separación

| Rol | Repositorio principal | Es responsable de | No es responsable de |
| --- | --- | --- | --- |
| Orquestador | `siple-orquestador` | Secuencia, decisiones, contrato, criterios de aceptación, revisión de evidencia, bitácora del plan y aprobación de fases. | Reimplementar la lógica de Front o Back. |
| Subagente Back | `siple-backTS` | Schema/resolvers GraphQL, comandos, políticas, autorización, concurrencia, idempotencia, persistencia, auditoría, compatibilidad y pruebas de integración. | Reglas de presentación o estado visual. |
| Subagente Front | `siple-front` | Inventario de orígenes, contrato TypeScript, servicios/adaptadores, UX de errores/conflictos/advertencias, estado y pruebas cliente. | Autorizar, construir o enviar auditoría, o validar definitivamente reglas de negocio. |
| Dueño de negocio | Fuera de repositorio | Resolver decisiones funcionales abiertas y aceptar cambios de política. | Diseñar soluciones técnicas sin evidencia. |

### Reglas de coordinación

1. Cada subagente trabaja sólo en su repositorio asignado, salvo lectura de
   contrato compartido y evidencia del otro lado.
2. No se conecta una pantalla nueva a la operación legacy `guardarGrupo` ni se
   agregan fallbacks nuevos a rutas legacy.
3. Ningún subagente modifica contrato, reglas o semántica por inferencia. Debe
   proponer la modificación al orquestador y esperar el punto de control.
4. Las decisiones y avances relevantes se registran en las secciones 13 y 14 de
   este archivo antes de declarar una fase terminada.
5. Todo reporte incluye rutas concretas, comportamiento observable y pruebas
   ejecutadas; “implementado” sin evidencia no es aceptable.
6. Cada tarea debe ser modular y tener un siguiente paso atómico comprobable.
   El agente indica qué cambió, cómo se verifica y el resultado de la
   verificación antes de ceder el control.
7. Ningún cambio puede introducir efectos secundarios no deseados ni descomponer
   una función existente. La prueba de regresión proporcional es requisito de
   aprobación, no trabajo opcional posterior.

---

## 3. Contrato de coordinación entre agentes

### 3.1 Formato de anuncio de contrato

Antes de que Front consuma una operación nueva, Back propone y el orquestador
publica el siguiente bloque en el contrato versionado de ambos repositorios:

```txt
CONTRATO ACTUALIZADO
Módulo: grupos
Version: v1
Tipo: GraphQL
Operación:
Request:
Respuesta éxito:
Rechazo de negocio:
Conflicto:
Advertencias y confirmación:
Concurrencia:
Idempotencia:
Auditoría:
Permisos y alcance:
Impacto front:
Compatibilidad/migración:
Fecha / responsable / aprobador:
```

El contrato debe especificar nulabilidad, nombres exactos, semántica de cada
operación de colección, formato de fechas y versión, códigos de error y casos
de compatibilidad. No basta un diagrama o una descripción verbal.

### 3.2 Resultado estándar de cada subagente

Al terminar un bloque, cada subagente entrega este reporte al orquestador:

```txt
Fase / bloque:
Resumen:
Archivos modificados o inspeccionados:
Contrato afectado:
Reglas implementadas o verificadas:
Permisos y alcance aplicados:
Concurrencia / idempotencia:
Persistencia / auditoría:
Pruebas ejecutadas y resultado:
Cómo se comprueba el éxito del paso:
Efectos secundarios / regresión verificada:
Riesgos, deuda o decisiones pendientes:
Compatibilidad y siguiente paso propuesto:
```

El orquestador responde sólo con una de estas salidas:

- **Aprobado:** evidencia suficiente y puerta de fase superada.
- **Correcciones requeridas:** lista concreta de defecto, ruta y criterio.
- **Bloqueado por decisión:** pregunta funcional necesaria, alternativa y
  consecuencias.
- **No integrado:** el trabajo puede conservarse, pero no habilita al siguiente
  bloque.

---

## 4. Invariantes obligatorios

Estos controles aplican a todas las fases y deben comprobarse antes de aprobar
cualquier cambio:

- Actor, permisos y alcance se obtienen del contexto autenticado, nunca del
  request del frontend.
- La operación parcial recibe un objetivo estable, `versionEsperada`, origen
  funcional, cambio tipado e `idempotencyKey`.
- Las reglas se validan con el estado canónico recién cargado en el backend.
- Los valores anterior/nuevo de la auditoría se calculan en servidor.
- El frontend no incluye campos, textos ni solicitudes de bitácora en el
  comando; backend registra en base de datos cada inserción, actualización y
  eliminación efectiva.
- Una advertencia requiere confirmación explícita y se vuelve a validar al
  escribir.
- Los errores de negocio son parte del resultado tipado; GraphQL errors quedan
  para autenticación o fallos técnicos no recuperables.
- Un conflicto no dispara reintento automático destructivo. Se devuelve el
  grupo y versión canónicos.
- El mismo `idempotencyKey` no duplica escritura, versión ni auditoría.
- Oracle no puede transformar el fallo de una operación requerida en éxito con
  warning silencioso.
- No se usan interpolaciones GraphQL, `any`, secretos, rutas legacy nuevas ni
  mojibake en los archivos intervenidos. Todo Markdown nuevo o modificado se
  guarda en UTF-8 con español correctamente acentuado y puntuado.
- El nombre acordado de la capa cliente es `GrupoCambiosService`; no se usa
  `Facade` para nuevos artefactos ni en la documentación objetivo. Los servicios
  existentes con `Facade` también deben migrarse a nombres `Service`, junto con
  sus importaciones y consumidores.

---

## 5. Árbol de dependencias y secuencia global

```text
0. Inventario y congelamiento
   ├─> 1. Decisiones funcionales cerradas
   ├─> 2. Contrato v1 aprobado
   │      └─> 3. Fundaciones Back: seguridad, versión, idempotencia, transacción
   │              └─> 4. Vertical inicial: cupos y mensajes
   │                      └─> 5. Espacio y horarios
   │                              └─> 6. Migración segmentada de edición completa
   │                                      └─> 7. Lote homogéneo todo-o-nada
   │                                              └─> 8. Retiro de legacy
   └─> (si falta una decisión) bloqueo controlado, no implementación supuesta
```

No se inicia una fase cuyo prerrequisito no esté marcado como aprobado en la
sección 14. Los trabajos de investigación de Front y Back sí pueden ejecutarse
en paralelo durante la fase 0.

---

## 6. Fase 0 — Inventario, diagnóstico vigente y congelamiento

**Objetivo:** convertir el diagnóstico inicial en un inventario verificable del
código actual y evitar que el contrato se diseñe sobre supuestos obsoletos.

### Secuencia

1. El orquestador abre esta fase, asigna el mismo corte temporal a Back y
   Front, y crea o identifica el contrato espejo en `docs/contratos/` de ambos
   repositorios.
2. Back inspecciona schema, resolvers, servicios, persistencia MSSQL/Oracle,
   auditoría, permisos y pruebas actuales. También encuentra cada consumidor de
   `guardarGrupo`, rutas legacy y `guardarBitacora`.
3. Front inventaría todos los puntos que editan o preparan edición de grupos,
   sus campos, mutaciones actuales, estado local y permisos que hoy se intentan
   verificar en interfaz.
4. Cada subagente entrega su reporte estándar sin cambiar comportamiento,
   salvo que se detecte una vulnerabilidad crítica que requiera contención
   inmediata y sea aprobada como excepción.
5. El orquestador compara hallazgos, actualiza `orquestador-guardar-por-partes.md`
   si el diagnóstico cambió y publica el inventario consolidado.

### Entregables

- Lista de rutas, operaciones, consumidores y pruebas existentes.
- Mapa de campos: origen de UI → dominio de cambio → entidad/persistencia.
- Lista de rutas legacy y condición de retiro por cada una.
- Riesgos confirmados y discrepancias frente al diagnóstico inicial.
- Línea base de pruebas funcionales por cada zona que se vaya a intervenir, para
  detectar regresiones y efectos secundarios en fases posteriores.

### Puerta de salida

El orquestador aprueba sólo si no quedan áreas de escritura desconocidas. Si
aparece un consumidor no inventariado después, se regresa a fase 0 para
actualizar el mapa antes de migrarlo.

---

## 7. Fase 1 — Decisiones de negocio y matriz de permisos

**Objetivo:** cerrar las políticas que no pueden deducirse técnicamente.

### Responsable y procedimiento

El orquestador redacta una propuesta con evidencia de Front/Back y la somete al
dueño de negocio. Back no implementa los casos abiertos y Front no los oculta
con validaciones de interfaz.

| Decisión pendiente | Debe definir | Bloquea |
| --- | --- | --- |
| PB/accesibilidad frente a espacio incompatible | Bloqueo absoluto o excepción autorizada y auditable; roles que pueden confirmarla. | Espacio/horario. |
| Capacidad y cupos | Fórmula exacta entre cupo general, distribuciones, inscritos, espacio y planes. | Cupos y espacio. |
| Distribución de cupos | Relaciones válidas entre primer ingreso, reingreso, complementario y AC. | Cupos. |
| Permisos y alcance | Permiso por dominio, rol administrador, departamento/grupo y operación masiva. | Todas las escrituras. |
| Colecciones Oracle | Alta, baja, actualización y reemplazo de horarios, mensajes y planes; atomicidad requerida. | Cada dominio correspondiente. |
| Más de un origen | Casos admitidos y estrategia de consistencia; lo no decidido se rechaza. | Lotes y cambios híbridos. |

### Entregables

- Matriz de reglas y permisos por tipo de cambio.
- Decisiones aprobadas con identificador, fecha, dueño y consecuencia técnica.
- Lista explícita de casos fuera de alcance mientras falte una decisión.

### Puerta de salida

Toda regla necesaria para la vertical siguiente tiene política cerrada. Los
casos pendientes quedan rechazados o fuera de alcance explícitamente; nunca se
habilitan de forma implícita.

---

## 8. Fase 2 — Contrato GraphQL v1 y modelos de frontera

**Objetivo:** acordar una interfaz estable antes de implementar consumidores.

### Back: propuesta obligatoria

Back entrega tipos GraphQL exactos y ejemplos de request/response para:

- `GrupoRefInput`: origen, período y clave.
- `AplicarCambiosGrupoRequest`: objetivo, versión, origen funcional, cambios,
  advertencias confirmadas e idempotencia.
- `CambiosGrupoInput` desglosado por dominio; no una bolsa ambigua de campos.
- Unión de resultado: aplicado, rechazado y conflicto de versión.
- Estructura de error con código, regla, campo/ruta, mensaje y detalles.
- Tipos de advertencia y su confirmación.
- Base de la operación masiva, marcada como no disponible hasta fase 7.

### Front: revisión obligatoria

Front valida que el contrato permite representar todos los casos inventariados,
crear comandos con variables tipadas y presentar errores por campo, advertencia
y conflicto sin inspeccionar textos libres. Define interfaces TypeScript sin
`any`, pero no implementa aún los flujos productivos.

### Orquestador: aceptación

1. Comprueba nulabilidad, identificadores estables y operaciones explícitas de
   colección.
2. Verifica que `GrupoInput` completo no se reutiliza como patch parcial.
3. Publica el bloque **CONTRATO ACTUALIZADO** en ambos repositorios con misma
   versión y fecha.
4. Define compatibilidad: legacy continúa sólo para sus consumidores ya
   inventariados; el contrato v1 no utiliza fallback.

### Puerta de salida

El mismo contrato está versionado y aprobado en ambos repositorios. Ningún
subagente puede cambiar sus tipos sin reiniciar este punto de control.

---

## 9. Fase 3 — Fundaciones de seguridad y consistencia en Back

**Objetivo:** evitar que la primera operación v1 herede riesgos del guardado
actual.

### Orden interno obligatorio para Back

1. Restringir `guardarBitacora` o convertirlo en mecanismo interno; ningún
   usuario autenticado debe poder registrar texto arbitrario.
2. Definir y probar el resolvedor de permisos efectivos, incluyendo
   `modificarCupos`, `editarEspacios`, `editarGrupos`, rol administrativo y
   alcance departamento/grupo.
3. Implementar lectura canónica de grupo y cálculo de versión controlada por
   servidor para cada origen autorizado.
4. Implementar almacenamiento y resolución de idempotencia, ligado a actor,
   objetivo, comando o huella de request y resultado previo.
5. Diseñar persistencia condicional atómica: cambio + incremento de versión +
   auditoría en la misma transacción del origen. Para reflejos entre fuentes,
   documentar outbox durable, correlación, reintento y estado recuperable antes
   de afirmarlos soportados.
6. Eliminar la semántica Oracle que captura fallas requeridas y devuelve éxito.
7. Definir el comportamiento tras commit si la rehidratación falla: devolver un
   estado recuperable e inequívoco, sin inducir doble escritura al cliente.
8. Implementar el esqueleto del handler: cargar, autorizar, aplicar patch
   tipado, validar, persistir, auditar y responder unión tipada.

La mejora profunda de MSSQL (por ejemplo, refactorización amplia de sus patrones
de escritura) queda deliberadamente en segunda prioridad: sólo se realizarán
los cambios necesarios para las garantías v1 y la compatibilidad. Oracle es el
destino estratégico de concentración y recibe la prioridad de diseño para la
evolución futura.

### Pruebas mínimas de salida

- Actor sin permiso no modifica ni escribe auditoría.
- Alcance inválido es rechazado aunque la interfaz haya enviado el comando.
- Dos cambios con misma versión causan un conflicto determinista; no hay
  sobrescritura.
- Reintento con misma clave no duplica dato, versión ni auditoría.
- Falla requerida de hijo Oracle no responde éxito.
- Error posterior a commit expone un estado recuperable documentado.
- Toda inserción, actualización o eliminación efectiva deja un registro de
  auditoría persistido por Backend sin que Front envíe datos de bitácora.
- La prueba regresiva aplicable confirma que no se alteró un flujo existente
  ajeno al cambio.

### Puerta de salida

Pruebas de integración verdes en los orígenes que soportará la primera
vertical. Si uno de los orígenes no puede garantizar la semántica, se restringe
el comando v1 al origen soportado y se registra el bloqueo.

---

## 10. Fase 4 — Primera vertical completa: cupos y mensajes

**Objetivo:** demostrar el patrón end-to-end con un alcance pequeño antes de
migrar dominios complejos.

### Back

1. Implementar patches explícitos para cupos y mensajes según contrato.
2. Aplicar matriz de permisos, alcance y validadores de relación de cupos.
3. Validar tipo, contenido, normalización y sanitización de mensajes.
4. Calcular cambios efectivos y auditoría desde el estado persistido.
5. Devolver grupo canónico, versión y advertencias aplicadas al éxito; errores
   por regla/campo al rechazo; grupo/versión actuales en conflicto.
6. Añadir pruebas de caso feliz, límite, permiso, alcance, mensaje inválido,
   conflicto, idempotencia y advertencia confirmada si aplica.

### Front

1. Crear `GrupoCambiosService` para construir comando
   tipado y llamar `aplicarCambiosGrupo` exclusivamente con variables GraphQL.
2. Adaptar cada variante de resultado a modelos de UI: éxito, errores por
   campo, advertencias pendientes y conflicto con grupo canónico.
3. Migrar un flujo de edición completa y un flujo de cambio rápido de cupos o
   mensajes hacia el mismo servicio.
4. Sustituir el estado local con el `grupo` retornado por servidor después de
   éxito; no recomponer silenciosamente un grupo completo en el cliente.
5. Mantener validaciones UX sólo como ayuda temprana y no como autoridad.
6. Probar interacción y ausencia de fallback a legacy en ambos flujos.

### Integración dirigida por orquestador

El orquestador compara request, respuesta y tratamiento UX con ejemplos del
contrato. Revisa que un cambio rápido y edición completa hacen el mismo comando
parcial y que no se acepta éxito parcial.

### Puerta de salida

Dos orígenes de UI consumen una operación única sin repetir reglas sensibles y
con evidencia de los cinco resultados: éxito, rechazo, advertencia confirmada,
conflicto y fallo técnico.

---

## 11. Fase 5 — Espacios, accesibilidad y horarios

**Objetivo:** migrar el dominio con más dependencias sólo después de que el
patrón esté probado.

### Back

- Definir identidad estable de una asignación de horario.
- Implementar operaciones de alta, baja, actualización y reemplazo sólo donde
  su semántica esté aprobada; no inferir reemplazos de colecciones completas.
- Verificar existencia, vigencia, tipo, departamento y capacidad del espacio.
- Derivar PB/modificador en servidor y ejecutar la política aprobada de
  accesibilidad.
- Validar formato, intervalos, colisiones y restricciones de plantilla.
- Mantener atomicidad de las entidades requeridas; si hay múltiples orígenes,
  aplicar sólo la estrategia durable aprobada.

### Front

- Conectar plantilla de horarios mediante `GrupoCambiosService`.
- Mostrar de forma diferenciada rechazo bloqueante, advertencia confirmable y
  conflicto; una advertencia no se reintenta sin confirmación explícita.
- Actualizar la pantalla desde el grupo canónico devuelto.

### Puerta de salida

No queda una ruta de cambio de espacio u horario que omita autorización,
validación, versión, auditoría o publicación de actualización.

---

## 12. Fases 6 a 8 — Migración, lote y retiro de legacy

### Fase 6: migración segmentada de edición completa

Migrar `editar-grupo` por dominio, en este orden recomendado: cupos/mensajes,
modificadores, planes/materias y horarios/espacios. Por cada segmento:

1. Confirmar que su comando y validadores unitarios existen.
2. Reemplazar el mapeo local a `iCambioRealizado` como fuente de persistencia.
3. Preservar temporalmente eventos sólo para presentación, nunca como auditoría
   de autoridad.
4. Probar que la sección no envía `GrupoInput` completo ni usa fallback legacy.
5. Actualizar el censo de consumidores legacy.
6. Cuando el segmento consuma un servicio con `Facade` en el nombre, renombrarlo
   a su `Service` acordado, actualizar todos sus imports/consumidores y ejecutar
   compilación y prueba regresiva antes de eliminar el nombre anterior.

### Fase 7: lote homogéneo todo-o-nada

No iniciar hasta que las operaciones individuales sean estables y observables.
Back implementa lote v1 sólo con estos límites:

- Mismo origen y período para todos los objetivos.
- Versión por cada grupo, permiso y alcance por objetivo.
- Validación total antes de escribir.
- Modo `TODO_O_NADA`; cualquier rechazo evita cambios en todos los objetivos.
- Auditoría individual vinculada por correlación común e idempotencia del lote.
- Rechazo de mezcla Oracle/MSSQL hasta que exista saga aprobada y probada.

Front implementa una pantalla que muestre errores por objetivo/campo y no
presente el lote como parcialmente exitoso. `PARCIAL` es una iniciativa distinta
y no debe introducirse como “optimización”.

### Fase 8: retiro de legacy

El retiro se realiza ruta por ruta, no por suposición. Para cada ruta se exige:

1. Censo con consumidores igual a cero.
2. Telemetría o evidencia equivalente de cero uso durante el período acordado.
3. Migración de pruebas y documentación al contrato v1.
4. Eliminación de fallback de Front y ruta/escritura duplicada de Back en la
   misma versión anunciada.
5. Prueba regresiva que confirme que ningún flujo de edición la requiere.
6. Censo de referencias a `Facade` igual a cero en servicios, tipos,
   importaciones y documentación de solución activa; las menciones históricas
   del diagnóstico pueden conservarse sólo para describir el estado anterior.

---

## 13. Protocolo de trabajo por bloque y reanudación

### Inicio de cada bloque

El orquestador debe leer, en este orden:

1. `orquestador-guardar-por-partes.md`.
2. Este plan, en especial secciones 13 y 14.
3. El contrato vigente en ambos repositorios.
4. Los últimos reportes de subagentes, cambios sin integrar y resultados de
   pruebas disponibles.

Después confirma: fase activa, puerta de entrada superada, responsable,
entregable concreto y decisión abierta que pudiera bloquearlo. Si el bloque no
tiene estos cinco datos, se clasifica como investigación y no como implementación.

### Durante cada bloque

- Un subagente recibe una tarea limitada a una fase y una salida comprobable.
- Todo descubrimiento que contradiga el diagnóstico se informa antes de ampliar
  el alcance.
- Cada commit o conjunto de cambios conserva compatibilidad según el contrato
  aprobado; no se deja Front dependiendo de schema no disponible.
- Las pruebas se ejecutan en el repositorio dueño de la regla y se registran
  con comando/caso y resultado.
- Antes de aprobar, se ejecuta la línea base o la prueba regresiva aplicable a
  las funciones cercanas, y se documenta que no aparecieron efectos secundarios
  ni regresiones conocidas.

### Cierre o interrupción

Antes de finalizar voluntariamente o al detectar una interrupción probable, el
orquestador actualiza la tabla de la sección 14 con:

- fase y bloque exactos;
- responsable y estado;
- evidencia creada (rutas, PR/commit si existe, pruebas);
- próximo paso atómico;
- bloqueador, decisión y persona que debe resolverla.

El siguiente orquestador no repite todo el diagnóstico: valida sólo la evidencia
de la fase activa y retoma desde el próximo paso atómico. Si el árbol de
dependencias cambió, actualiza primero el plan y registra el motivo.

---

## 14. Tablero persistente de control

**Tabla histórica de preparación, no operativa.** El estado vigente se mantiene
únicamente en la sección 13.4 de `orquestador-guardar-por-partes.md`. La Fase 2
quedó aprobada el 2026-09-08 para fundaciones con reservas y contrato publicado
en `docs/contratos/grupos-v1/` de los tres repositorios. No actualizar esta tabla
como un tablero paralelo ni interpretar sus estados iniciales como pendientes actuales.

| Fase | Estado | Responsable actual | Prerrequisito / evidencia aprobada | Próximo paso atómico | Bloqueador o decisión | Última actualización |
| --- | --- | --- | --- | --- | --- | --- |
| 0. Inventario y congelamiento | PENDIENTE | Orquestador + Front + Back | Diagnóstico inicial documentado | Confirmar rutas y consumidores vigentes | Ninguno aún | 2026-09-03 |
| 1. Decisiones y permisos | PENDIENTE | Orquestador + negocio | Inventario consolidado | Publicar matriz propuesta | Decisiones sección 7 | 2026-09-03 |
| 2. Contrato v1 | PENDIENTE | Back propone; Front revisa; Orquestador aprueba | Decisiones necesarias cerradas | Proponer schema exacto | Sin contrato aprobado | 2026-09-03 |
| 3. Fundaciones Back | PENDIENTE | Back | Contrato v1 aprobado | Restringir auditoría pública | Diseño de versión/idempotencia por origen | 2026-09-03 |
| 4. Cupos y mensajes | PENDIENTE | Back + Front | Fundaciones aprobadas | Implementar comandos y servicio | Regla de cupos cerrada | 2026-09-04 |
| 5. Espacios y horarios | PENDIENTE | Back + Front | Vertical inicial aprobada | Definir identidad de horario | Política PB/capacidad | 2026-09-03 |
| 6. Edición completa | PENDIENTE | Front + Back | Comando por dominio aprobado | Migrar primer segmento y renombrar su servicio `Facade` | Inventario de consumidores `Facade` pendiente | 2026-09-04 |
| 7. Lote todo-o-nada | PENDIENTE | Back + Front | Operaciones unitarias estables | Confirmar límites de lote | Mezclas de origen no admitidas | 2026-09-03 |
| 8. Retiro legacy | PENDIENTE | Back + Front; Orquestador aprueba | Censo de consumidores en cero | Retirar una ruta verificada | Telemetría/censo pendiente | 2026-09-03 |

---

## 15. Criterio final de aceptación

La macro-tarea sólo se considera terminada cuando el orquestador dispone de
evidencia actualizada de que:

- contrato v1 y documentación espejo están aprobados;
- cada origen de edición usa cambios tipados y el grupo canónico del servidor;
- permisos, alcance, reglas y auditoría se aplican en backend para todos los
  dominios habilitados;
- versión e idempotencia previenen sobrescritura y duplicación;
- cada operación tiene pruebas de éxito, rechazo, advertencia, conflicto y
  error técnico cuando corresponda;
- Oracle no produce éxito silencioso en operaciones requeridas;
- el lote v1 es homogéneo, todo-o-nada y no mezcla orígenes;
- no hay consumidores ni fallbacks de rutas legacy, y la bitácora pública
  arbitraria ya no es accesible.
- toda inserción, actualización y eliminación habilitada cuenta con auditoría
  persistida por Backend, y ninguna operación de Front transporta datos de
  bitácora;
- el tablero conserva pasos modulares comprobables, sus evidencias y una prueba
  de no regresión para cada segmento aprobado.
- los servicios existentes con `Facade` fueron migrados a nombres `Service`,
  con todos sus consumidores actualizados y sin referencias activas restantes.

Hasta entonces, el tablero debe describir el avance real y los riesgos abiertos;
no debe transformarse una fase pendiente en aprobada por contar sólo con cambios
de código.
