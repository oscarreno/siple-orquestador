# Orquestador: guardado parcial y coordinado de grupos

### Hito funcional Oracle v1 - 2026-09-22

Se cerro el primer cambio real de tipo de grupo usando la ruta existente de Oracle, sin modificar procedimientos almacenados. La nueva vertical se activa con `GRUPOS_V1_GENERALES_ESCRITURA=SI`, recibe `cambios.generales.tipo` y llama unicamente a `SIPF1_ALTAGRUPO2`, la rutina usada por el guardado completo. La respuesta GraphQL fue `CambioGrupoAplicado` para `ORACLE | V2022 | CPC1524LN`, cambiando `AC` a `REINGRESO`.

La lectura posterior confirmo `grupo.tipo = REINGRESO` y `GPO = REINGRESO`, con revision nueva `db16b95115ed0f6ba43778a40e628fd448d5e3e8cc752e7bddfdb613911e98bd` y `auditoriaId = 7B32ED5D-DFB6-F111-80CE-00505683AD76`.

### Compensaciones por el contrato legacy de Oracle - 2026-09-23

Estas son las "vueltas" que el orquestador debe dar mientras el unico punto de
escritura disponible sea la funcion `ORACLEDBA.SIPF1_ALTAGRUPO2`. No son reglas
de negocio nuevas ni deben copiarse al SP; son defensas y adaptadores locales
para convivir con su comportamiento actual.

1. **El idioma se envia como texto canonico.** `P_IDIOMA` es `VARCHAR2`. La
   funcion busca los primeros cuatro caracteres en `S_IDIOMA` y, si no los
   encuentra, cae silenciosamente al idioma `1` (Espanol). Por eso el Backend
   no debe convertir `Ingles` a mayusculas: `INGL` no coincide con `Ingl`. La
   entrada se valida contra el catalogo y se conserva con la capitalizacion de
   Oracle (`Ingles`, `Espanol`, etc.).

2. **El SP no es una actualizacion parcial real.** Para un grupo existente,
   `SIPF1_ALTAGRUPO2` actualiza el encabezado, pero despues borra mensajes,
   reservaciones, caracteristicas y planes compartidos antes de hacer commit.
   Por eso `soloGenerales` y `soloCupos` no pueden limitarse a invocar el SP:
   deben rehidratar los detalles vigentes usando las rutinas disponibles
   (`SIPF1_ALTAHORARIO`, `SIPF1_ALTAMENSAJE` y `SIPF1_ALTAGMAP22`).

3. **Las pruebas no pueden omitir detalles por comodidad.** Si una lectura de
   prueba devuelve horarios nulos o vacios porque no se enviaron al guardado,
   el siguiente uso del SP puede eliminarlos. Toda prueba que invoque el
   encabezado debe partir de una lectura completa y conservar mensajes,
   horarios y planes, aunque la mutacion solo cambie idioma, tipo o cupos.

4. **Los mensajes se reconstruyen, no se reemplazan.**
   `SIPF1_ALTAMENSAJE` solo inserta cuando no existe el tipo. La rehidratacion
   funciona porque `SIPF1_ALTAGRUPO2` ya borro los detalles; fuera de ese caso,
   esa rutina no puede reemplazar un mensaje existente. El postcondition del
   Backend sigue siendo obligatorio.

5. **Los commits internos de Oracle obligan a estados parciales.** Si el SP o
   alguna rehidratacion falla despues de que Oracle confirmo internamente,
   el orquestador debe conservar `INCIERTA` o `PARCIAL`, reconciliar el estado
   y nunca devolver `APLICADA` solo porque la llamada no arrojo excepcion.

6. **Las caracteristicas tienen una limitacion adicional.** El SP borra
   `S_ADG_CARACSGRUPO`, pero el Backend no tiene hoy una rutina v1 dedicada
   para reconstruir esas filas. La rehidratacion de mensajes puede reconstruir
   la representacion `PLA`/modificadores que expone el modelo, pero no debe
   considerarse equivalente a restaurar la tabla de caracteristicas. Hasta
   contar con un writer Oracle especifico, una prueba debe verificar
   `discapacidad` y `modificadores` antes y despues, o mantener el grupo fuera
   de esta ruta.

7. **El mensaje `GPO` es la fuente autoritativa del tipo funcional.** No se
   debe inferir `grupo.tipo` desde `S_TIPOGRUPO` ni desde que
   `cupoPrimerIngreso` sea mayor que cero: un grupo `REINGRESO` puede tener
   una distribucion de cupos con primer ingreso y seguir siendo `REINGRESO`.
   `P_TIPOGRUPO_ID` es un parametro tecnico del SP, pero no debe sobrescribir
   el tipo funcional que expone el mensaje `GPO`.

8. **Las capacidades deben reflejar los writers realmente habilitados.** La
   escritura de cupos ya usa `SIPF1_ALTAGRUPO2` y el mismo control durable que
   generales, pero la API no la debe anunciar como disponible si el flag
   `GRUPOS_V1_CUPOS_ESCRITURA` o el control Oracle están apagados. El Backend
   ahora publica `CUPOS/PATCH` como disponible únicamente bajo esas mismas
   condiciones que aplica al ejecutar el comando.

### Evidencia de conservación de horarios - 2026-09-23

En `ORACLE | V2022 | CPC016L` se inicializó el control durable con la revisión
`6198557a0223d40c7ab6b66a85b691a484c7a46d33603dd5bba5644d1aa7b451` y se cambió
únicamente `generales.contenido` mediante `SIPF1_ALTAGRUPO2`. La operación quedó
`APLICADA`, con auditoría `4EDAE442-80B7-F111-80CE-00505683AD76` y revisión nueva
`235a21cac7884925665d2aeae61438f65bb4459d6b5a1eaa188206bebcfab534`.

La respuesta y la lectura posterior conservaron exactamente los dos horarios:
`11A | martes | V-305 | 16-20` y `10B | jueves | V-305 | 16-20`. Esto confirma
que la rehidratación de horarios funciona cuando el SP legacy borra los detalles
durante el cambio de encabezado.

### Evidencia de frontera MSSQL - 2026-09-23

En `MSSQL | V2022 | CPC016L` se consultó el grupo, se verificaron sus
capacidades y se intentó cambiar únicamente `generales.contenido`. La operación
fue rechazada con `OPERACION_NO_DISPONIBLE` y `DISPONIBILIDAD_TECNICA`, como
corresponde a un origen que todavía no tiene escritura v1 habilitada.

La lectura posterior confirmó que el contenido, los horarios y la revisión no
cambiaron. Tampoco se inicializó ni se modificó `GrupoControlOracle`; el control
durable Oracle permanece aislado del flujo MSSQL.

### Bootstrap automático de revisión durable - 2026-09-23

La primera escritura v1 ya no requiere insertar manualmente una fila en
`GrupoControlOracle`. Durante la reserva durable, si la mutación ya verificó la
revisión recién leída y todavía no existe control para el grupo, el Backend crea
la fila inicial con `RevisionControl = 1` y el hash esperado. La operación continúa
desde esa revisión y su finalización incrementa el contador normalmente.

El bootstrap ocurre dentro de la misma transacción MSSQL que reserva la operación,
no durante `grupoParaCambios`; por eso la consulta sigue siendo de lectura y no se
sobrescribe una revisión existente. El validador `validar:control-oracle` pasó.

La prueba real se ejecutó con `ORACLE | V2022 | CPC061E`, sin `INSERT` manual.
Después de regenerar `dist` y reiniciar el Backend, la mutación terminó como
`CambioGrupoAplicado`, con auditoría `527CDFDE-BFB7-F111-80CE-00505683AD76` y
revisión nueva `ae6e15b08a1b7309ff4778caa1ab7ee5c713c6c725d4405b27555600f648d301`.
El contenido cambió y se conservaron los horarios `04A | martes | V-203 | 9-13`
y `04B | jueves | V-203 | 9-13`.

### Integración Front del contrato v1 - 2026-09-23

El Front incorporó una capa tipada y aislada para consumir
`grupoParaCambios` y `aplicarCambiosGrupo`. `GruposDataService` expone la
lectura de capacidades, una función para consultar si una operación está
disponible y la unión discriminada de resultados aplicado/rechazado/conflicto.
`GruposFacadeService` delega esas operaciones sin modificar todavía el flujo
legacy de `guardarGrupo`.

La prueba unitaria cubre el caso `MSSQL`: capacidades de escritura falsas y
conservación del rechazo `OPERACION_NO_DISPONIBLE`. El build de producción del
Front pasó. La ejecución Karma quedó impedida por problemas preexistentes del
entorno (`zone-testing`, caché Angular y el tipo `Timeout` de
`websockets.service.ts`), no por los archivos v1 nuevos.

#### Cuando retirar estas compensaciones

Se pueden retirar de forma controlada cuando exista un SP nuevo o una funcion
equivalente que cumpla todas estas condiciones: actualice solo los campos
solicitados, no borre detalles no relacionados, no haga commits parciales,
acepte un contrato explicito para idioma y reemplace mensajes por tipo. En ese
momento se debe eliminar la rehidratacion de `soloGenerales`/`soloCupos`, quitar
la normalizacion especial de idioma y conservar unicamente la concurrencia,
idempotencia y verificacion posterior del orquestador.

Tambien se comprobo que `SIPF1_ALTAMENSAJE` es una rutina de alta idempotente y no sirve para reemplazar un `GPO` existente. El Backend ahora verifica el estado posterior y devuelve `ORACLE_RESULTADO_NO_COINCIDE`, dejando la operacion en `INCIERTA`, en lugar de reportar un falso exito. La operacion de prueba se reconcilio sin borrar su historial.

El control durable se reforzo para guardar en operaciones nuevas la revision y el hash anteriores durante la reserva, y la revision y el hash nuevos al completar. Las operaciones historicas pueden conservar esos campos en `NULL`. La suite `cmd /c npm run validar:todas` y TypeScript terminaron OK.

Las tablas permanentes incorporadas son `dbo.GrupoControlOracle` y `dbo.GrupoOperacionOracle`; no se crearon tablas nuevas en Oracle.

## Handoff operativo — cierre 2026-09-21

Esta es la sección autoritativa para continuar. La Fase 3 ya llegó a una
primera escritura real y controlada de cupos para `ORACLE | V2022 | CPC3156K`.
La lectura, el preflight, la revisión optimista, el control durable y la
idempotencia tienen evidencia operativa en GraphiQL. No se aprobó despliegue
productivo ni se habilitaron mensajes, horarios, planes, materias o
modificadores.

### Avance de continuación — 2026-09-22

Se corrigió la trazabilidad de la respuesta v1: `auditoriaId` ahora usa el
`OperacionId` generado por `dbo.GrupoOperacionOracle`, tanto en la respuesta
inicial como en el replay. Se conservó el hash determinista únicamente como
fallback para filas antiguas que no expongan ese campo. La consulta durable
`consultar` ahora incluye `OperacionId`.

Pruebas ejecutadas en `siple-backTS`:

- `cmd /c npx tsc --noEmit`: OK.
- `cmd /c npm run validar:control-oracle`: OK; la prueba confirma que el
  `OperacionId` durable se conserva en el ledger y que el replay no vuelve a
  ejecutar la operación.
- `cmd /c npm run validar:todas`: OK; los siete validadores pasan.

Los cambios siguen sin commit. La auditoría continúa siendo post-commit de
Oracle/MSSQL; este avance corrige la identificación durable, no convierte la
auditoría en atómica.

### Avance vertical de mensajes — 2026-09-22

Se implementó el primer writer v1 de mensajes, aislado detrás de
`GRUPOS_V1_MENSAJES_ESCRITURA=SI`. Solo acepta reemplazos de tipos `INS` y
`GPO`; `POPUP`, `PLA`, `TIPO 3`, bajas y combinaciones con otra vertical siguen
rechazados. El guardado parcial invoca únicamente `SIPF1_ALTAMENSAJE` y no
ejecuta encabezado, horarios ni planes. El control durable, revisión esperada,
rehidratación y `OperacionId` se conservan.

Pruebas adicionales:

- `cmd /c npx tsc --noEmit`: OK.
- `cmd /c npm run validar:grupo-cambios-v1`: OK; valida `INS/GPO` y rechazos
  tipados de `POPUP` y `ELIMINAR`.
- `cmd /c npm run validar:guardar-grupo`: OK; confirma que la vertical solo
  invoca `SIPF1_ALTAMENSAJE` para `INS/GPO`.
- `cmd /c npm run validar:todas`: OK; los siete validadores pasan.

El flag de mensajes no debe habilitarse en pruebas operativas hasta confirmar
en Oracle real que `SIPF1_ALTAMENSAJE` reemplaza por tipo sin duplicar mensajes.

### Corrección de revisión desincronizada — 2026-09-22

La primera prueba del writer de mensajes devolvió
`ORACLE_REVISION_NO_DISPONIBLE` con el mensaje de revisión durable no
sincronizada. La causa era una diferencia de proyección: `grupoParaCambios`
calculaba la revisión sin `planesCompartidos`, mientras que al completar una
operación el grupo rehidratado sí incluía esa colección. La lectura v1 y la
mutación ahora usan la misma proyección rehidratada, incluyendo una colección
vacía cuando no existen planes.

La suite completa volvió a pasar después de la corrección. Como el rechazo
ocurre antes de insertar la operación durable, el intento fallido no ejecutó
Oracle ni dejó una reserva activa. Procedimiento de reintento: reiniciar el
Backend, ejecutar nuevamente `grupoParaCambios`, copiar la nueva
`revisionGrupoActual` y repetir la mutación. Se puede conservar la misma clave
si no existe una fila previa con ella.

### Evidencia real del writer de mensajes — 2026-09-22

La mutación GraphQL se ejecutó correctamente para `V2022 | CPC3156K`:

- `__typename = CambioGrupoAplicado`.
- El mensaje `INS` quedó como `Prueba mensaje v1` y `GPO` permaneció como `AC`.
- La nueva revisión fue
  `6041cdb1daa918eebb3264c316fceda02a18f063b438bdd984ffef1195d1f78f`.
- `auditoriaId = 7103CD54-B6B6-F111-80CE-00505683AD76`, con formato de
  `OperacionId` durable.

Falta repetir exactamente la misma mutación y clave para cerrar replay,
confirmar la misma respuesta/auditoría y verificar que Oracle no duplique el
mensaje.

El usuario confirmó el replay exacto: la operación quedó cerrada correctamente,
con la misma respuesta/auditoría y sin duplicar el mensaje. La vertical
`INS/GPO` queda validada funcionalmente en pruebas; el flag debe permanecer
restringido al entorno controlado hasta aprobar su uso operativo.

Como ajuste de consumo, `grupoParaCambios.capacidades` ahora anuncia
`MENSAJES/REEMPLAZAR` cuando `ORACLE_CONTROL_GUARDADO=SI` y
`GRUPOS_V1_MENSAJES_ESCRITURA=SI`; `MENSAJES/ELIMINAR` continúa no disponible.
La prueba focalizada y `cmd /c npm run validar:todas` pasaron nuevamente.

También se agregó el catálogo de valores válidos para `GPO`, alineado con el
Front: `PRIMER INGRESO`, `REINGRESO`, `AC`, `PAP`, `CU`, `INGLES`, `POSGRADO`,
`IDIOMAS`, `ASESORIA`, `PREPA` y `OTRO`. Un valor libre como `AC-GPO-v1` ahora
devuelve `CATALOGO_INVALIDO` antes de revisar concurrencia o reservar la
operación.

La revisión v1 dejó de incluir `alumnosInscritos`: es una situación externa y
no una propiedad editable del grupo. La prueba confirma que variar inscritos
no cambia el hash, mientras que sí lo hacen los datos persistentes del grupo.
Al cambiar el algoritmo, las filas existentes de `GrupoControlOracle` deben
reconciliarse con el hash nuevo antes de continuar escribiendo cada grupo.

### Evidencia funcional confirmada

- `cupoComplementario` cambió de `20` a `19`; el resultado fue
  `CambioGrupoAplicado`.
- La respuesta devolvió la revisión
  `8eaa98917a744f7b7f3df5c23b6d839bd196e5b7a226783a6863bf334ab83469` y
  `auditoriaId = 83ae90363712e076cc70e0a8bf7511e8d87750c2e613964298e2c8f81480e990`.
- El replay exacto con la misma idempotency key devolvió el mismo resultado sin
  duplicar la escritura.
- Reutilizar la misma clave con otro payload fue rechazado con
  `IDEMPOTENCIA_CLAVE_REUTILIZADA`; el grupo permaneció en `19`.
- La lectura posterior confirmó `cupoComplementario = 19`.
- También se confirmaron rechazos tipados para cupo inválido, distribución mayor
  al cupo general, cupo menor que inscritos y revisión obsoleta.

### Revisión durable y estado técnico

La revisión ahora usa un hash estable del grupo, excluyendo campos volátiles y
normalizando claves y colecciones. El hash anterior de control
`9ea6bc9a823e42c3225a8143c1dd109f1a57ebc1a30b2f2a7e975c9aad3218ce` fue
conciliado manualmente por el usuario con la revisión estable
`253c7120450aab7d50b9813e7fe8e682e483263fb0db6214f6b1e52a85a1a838`. La fila
observada fue `ORACLE | V2022 | CPC3156K`, `RevisionControl = 1`, y la operación
durable quedó `APLICADA` con `CodigoError = NULL`.

En `siple-backTS` pasaron:

- `cmd /c npx tsc --noEmit`.
- `cmd /c npm run validar:grupo-cambios-v1`.
- `cmd /c npm run validar:control-oracle`.

La suite `cmd /c npm run validar:todas` había pasado antes del último ajuste del
hash estable; debe repetirse en la siguiente sesión.

### Archivos y pendientes para el siguiente agente

Los cambios principales están en `src/graphql/schema/grupos-v1.schema.graphql`,
`src/graphql/resolvers/grupoCambiosV1.ts`, `src/graphql/resolvers/queryGrupos.ts`,
`src/clases/ControlGuardadoOracle.ts`, `src/clases/Grupos.ts`,
`src/clases/RevisionGrupoV1.ts`, `pruebas/validate-grupo-cambios-v1.ts` y
`package.json` del backend. La escritura sigue protegida por
`GRUPOS_V1_CUPOS_ESCRITURA=SI` y por el control durable; ese flag se usó para la
prueba local y no debe asumirse habilitado en otros ambientes.

Antes de ampliar la escritura, revisar la atomicidad entre persistencia y
auditoría. El `auditoriaId` ya se basa en `OperacionId`; el fallback solo cubre
filas antiguas sin ese campo.

Próximo orden recomendado: verificar en Oracle real el reemplazo por tipo de
`INS/GPO` con el flag aislado, repetir replay y revisar lectura posterior.
Mantener cerrados `POPUP`, horarios, planes, materias, modificadores y bajas de
mensajes. El ciclo GraphiQL recomendado es: lectura → revisión devuelta →
mutación con clave nueva → replay exacto → lectura posterior.

## Registro histórico previo — 2026-09-21

> Este bloque conserva el contexto anterior a la primera escritura real. Para
> continuar, usar exclusivamente el `Handoff operativo` de arriba.

Control durable Oracle implementado en Backend y habilitado en el entorno de
pruebas por el equipo, según la evidencia registrada en la guía de Fase 3.6.
La migración MSSQL y las pruebas contra BD ya fueron ejecutadas fuera de este
agente. La reserva se confirma antes de Oracle y conserva la exclusión tras una
caída; incluye clave de idempotencia opcional, replay, consulta autenticada de
estado e invalidación de caché al fallar. La guía registra un guardado real
mixto previo a la corrección de reenvío de horarios; el usuario confirmó que ya
realizó las pruebas operativas. Las validaciones documentales y la suite local
del Backend pasan. Se habilitó únicamente la lectura v1 `grupoParaCambios`; la
mutación de escritura v1 sigue deshabilitada. No se ha aprobado despliegue
productivo.

Siguiente paso: implementar el primer handler de escritura v1 cuando quede
registrado el resultado detallado de las pruebas operativas y exista evidencia
de revisión/auditoría por origen. La revisión universal de writers externos y la
auditoría distribuida siguen fuera de alcance.
Guía vigente:
`docs/cambioGrupos/back/fase-3-6-implementacion-control-oracle.md`.

### Validacion documental local — 2026-09-21

Se ejecutaron sin modificar codigo ni base de datos:

- `node docs/cambioGrupos/validar-propuesta-v1.cjs`: OK.
- `node docs/cambioGrupos/validar-consumo-v1.cjs`: OK.
- `node docs/cambioGrupos/verificar-espejos-v1.cjs`: OK.
- `cmd /c npm run validar:todas` en `siple-backTS`: OK; siete validadores,
  incluyendo lectura v1, control durable, replay, concurrencia simulada y
  estados parcial/incierto. Las pruebas usan dobles y no se conectan a BD.

Prueba GraphiQL reportada por el usuario: `grupoParaCambios` respondió
correctamente para `ORACLE | V2022 | CPC3156K`, con revisión SHA-256, grupo
rehidratado y mensaje `GPO`. Las 19 capacidades devolvieron
`OPERACION_NO_DISPONIBLE` como estaba previsto; `horariosIdentificados` fue
`null` por falta de identidad estable de asignaciones.

El schema v1 ahora también expone la forma de `aplicarCambiosGrupo`; el resolver
lee el grupo canónico y ejecuta el preflight de cupos/mensajes. Un comando válido
sigue devolviendo `OPERACION_NO_DISPONIBLE` y no ejecuta ninguna escritura; los
comandos inválidos devuelven su rechazo tipado. Esto permite validar el consumo
GraphQL sin habilitar persistencia antes de cerrar revisión, auditoría e
idempotencia por origen.

El preflight de cupos/mensajes ya valida enteros no negativos, distribución de
cupos, catálogo de mensajes, operaciones duplicadas, texto requerido y cambios
efectivos. Su candidato todavía no se persiste; las capacidades siguen cerradas.

El acceso operativo ya fue usado por el usuario para las pruebas reales. El
Backend queda listo para el siguiente bloque de escritura, pero no se habilita
ninguna capacidad de mutación v1 por inferencia: primero debe conservarse la
evidencia de resultados y definir el origen/vertical que pasará a escritura.

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
| Operación | `grupoParaCambios` implementada como lectura versionada; `aplicarCambiosGrupo` sigue sin implementar |
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
| 3. Fundaciones Back | EN CURSO | Front completó 3.1-A; Back implementó 3.1-B, auditoría derivada 3.2-A, rollback Oracle 3.2-B, aislamiento local 3.4-A/3.4-B, control durable 3.6 y writer v1 aislado para mensajes INS/GPO | Contrato v1 aprobado; contención Front verificada; migración y prueba inicial de BD reportadas por el equipo; validadores locales OK | Verificar contra Oracle real reemplazo por tipo, replay, concurrencia, estados parcial/incierto y reconciliación | `docs/cambioGrupos/back/fase-3-6-implementacion-control-oracle.md`; validadores completos OK el 2026-09-22; writer protegido por `GRUPOS_V1_MENSAJES_ESCRITURA` | La auditoría Oracle sigue siendo post-commit; writers externos y endpoints legacy quedan fuera del control; no se habilitan bajas ni otras verticales | 2026-09-22 |
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
### Sesion 19 - Selector de ruta en el editor Front

- **Fecha:** 2026-09-23.
- **Fase/bloque:** consumo progresivo del contrato v1; selector v1/legacy.
- **Archivos modificados:** `siple-front/src/app/components/editar-grupo/editar-grupo.component.ts`.
- **Regla implementada:** al abrir un grupo Oracle con el control habilitado se consulta una vez `grupoParaCambios`; un cambio de un solo dominio (`GENERALES`, `CUPOS` o `MENSAJES`) usa `aplicarCambiosGrupo` v1 solo si la capacidad esta disponible. MSSQL, cambios mixtos, horarios, planes, modificadores, mensajes no soportados o capacidades deshabilitadas conservan `guardarGrupo` legacy.
- **Concurrencia:** la ruta v1 reutiliza la `revisionGrupoActual` capturada al abrir el editor y la misma `idempotencyKey` durante el intento; conflicto y rechazo se muestran como resultado de negocio, mientras un fallo de transporte conserva el bloqueo de reintento.
- **Prueba:** `cmd /c npm run build` en `siple-front`: **OK**. El build de produccion completo; preflight CSS reporto 0 variables indefinidas.
- **Siguiente paso:** probar en UI un cambio aislado de contenido en Oracle y observar `aplicarCambiosGrupo`; despues probar en el mismo editor un cambio mixto y observar que cae a `guardarGrupo`.
### Sesion 20 - Sincronizacion del hash canonico entre rutas

- **Fecha:** 2026-09-23.
- **Problema reproducido:** despues de un guardado mixto por `guardarGrupo`, el siguiente cambio aislado por `aplicarCambiosGrupo` devolvia `ORACLE_REVISION_NO_DISPONIBLE` aunque la revision leida del grupo era valida.
- **Causa:** la ruta legacy registraba `hashControl(resultado)` y v1 comparaba `hashRevisionGrupoV1(grupo)`, que excluye campos volatiles como fechas y alumnos inscritos.
- **Correccion:** `guardarGrupo` Oracle ahora confirma con `hashRevisionGrupoV1`; la mutacion v1 reconcilia el hash de filas antiguas cuando no existe una operacion activa, sin alterar `RevisionControl`.
- **Validacion:** `npx tsc --noEmit`, `npm run validar:todas` y `npm run dist`: **OK**.
- **Prueba pendiente:** reiniciar Backend, repetir `grupoParaCambios` y el cambio solo de contenido en `ORACLE / V2022 / CPC061E`; debe responder `CambioGrupoAplicado` y conservar horarios.
### Sesion 21 - Actualizacion visual con respuesta confirmada

- **Fecha:** 2026-09-23.
- **Problema reproducido:** el guardado v1 respondia correctamente, pero el cierre del editor disparaba una segunda consulta `sql:grupo`; si esa lectura fallaba, el usuario veia `No se pudo refrescar` aunque la escritura ya estaba aplicada.
- **Correccion:** Oferta y Grupos por materia ahora reemplazan directamente la fila con el `Grupo` devuelto por el guardado confirmado; se elimina la lectura redundante posterior.
- **Validacion:** `cmd /c npm run build` en `siple-front`: **OK**; preflight CSS: 0 variables indefinidas.
- **Prueba pendiente:** repetir la edicion aislada de contenido en `CPC061E`; debe mostrarse el exito del guardado sin el toast de refresh fallido.
### Sesion 22 - Consulta de estado para operaciones inciertas

- **Fecha:** 2026-09-24.
- **Problema reproducido:** `SIPF1_ALTAMENSAJE` no confirmo el reemplazo de `INS`; el Backend marco la operacion como `INCIERTA` y el Front bloqueo nuevos cambios.
- **Correccion Front:** el boton `Consultar estado actual` ya no se detiene al ver `INCIERTA` o `PARCIAL`; consulta el grupo real y lo deja disponible para comparacion/carga. Solo `EJECUTANDO` mantiene el bloqueo sin lectura posterior.
- **Validacion:** `cmd /c npm run build` en `siple-front`: **OK**.
- **Decision pendiente:** mantener mensajes v1 deshabilitados para reemplazo mientras el SP Oracle solo permita alta y no actualizacion; no reintentar la misma operacion hasta consultar su estado.
### Sesion 23 - Limite documentado para mensajes Oracle existentes

- **Fecha:** 2026-09-24.
- **Evidencia:** `SIPF1_ALTAMENSAJE` ejecuta un `INSERT ... WHERE NOT EXISTS`; no actualiza mensajes `INS` o `GPO` ya existentes.
- **Correccion:** el preflight v1 rechaza antes de reservar/invocar Oracle un `REEMPLAZAR` sobre un mensaje existente con `OPERACION_NO_DISPONIBLE / MENSAJE_EXISTENTE_NO_ACTUALIZABLE`.
- **Resultado:** se evita crear otra operacion `INCIERTA` por una capacidad que el SP no puede cumplir; los mensajes nuevos siguen siendo candidatos a alta.
- **Validacion:** `npx tsc --noEmit`, `npm run validar:grupo-cambios-v1` y `npm run dist`: **OK**.

### Correccion de la sesion 23 - Reemplazo de mensajes existentes mediante el flujo completo

- **Fecha:** 2026-09-24.
- **Aclaracion con evidencia Oracle:** la conclusion anterior era incompleta. `SIPF1_ALTAMENSAJE` por si solo solo da de alta y no modifica un tipo existente, pero `SIPF1_ALTAGRUPO2` borra primero las filas de `S_MENSAJEGRUPO` del grupo y despues el guardado completo vuelve a insertar los mensajes vigentes. Esa es la razon por la que Produccion podia reemplazar un `INS` aun sin una ruta alterna.
- **Correccion Backend:** la vertical v1 de mensajes Oracle usa ahora una modalidad interna de reemplazo completo (`reemplazarMensajesOracle`). Invoca `SIPF1_ALTAGRUPO2`, conserva y rehidrata horarios, mensajes y planes compartidos, y despues verifica el estado post-escritura. No se modifican los SP Oracle.
- **Alcance:** siguen soportados solo `REEMPLAZAR` de `INS` y `GPO`; bajas, `POPUP`, horarios, planes, materias y modificadores permanecen cerrados. La sustitucion depende de que la lectura previa incluya todos los detalles que el SP puede borrar.
- **Nota operativa:** la operacion anterior `3f458272-b0ae-4856-b4b6-4733d794f4dd` queda como evidencia del flujo antiguo incierto; no debe reintentarse con la misma clave. Para validar esta correccion se requiere consultar/reconciliar ese estado y usar una clave nueva.
- **Validacion local:** `cmd /c npx tsc --noEmit`, `cmd /c npm run validar:todas` y `cmd /c npm run dist`: **OK**.

### UX de incertidumbre en el editor - 2026-09-24

- El estado incierto es del grupo completo y no debe depender de que el usuario abra el panel de mensajes.
- El Front ya presenta la recuperación en la cabecera del editor, bloquea Guardar y conserva la edición hasta consultar el estado. Se ajustaron los textos para no exponer `INCIERTA`, Oracle ni detalles de control durable al usuario final.
- La alerta ahora indica que no se pudo confirmar el guardado, ofrece `Actualizar estado del grupo` y permite continuar con los datos consultados solo después de una lectura explícita. Los estados y códigos técnicos permanecen en Backend/logs.
- Validación: `cmd /c npm run build` en `siple-front`: **OK**; preflight CSS con 0 variables indefinidas.

### Reconciliacion automatica de intentos inciertos - 2026-09-24

- Se agrego `reconciliarEstadoGuardadoOracle` al Backend. La operacion solo se
  cierra como `RECHAZADA / ORACLE_RESULTADO_NO_APLICADO` cuando la lectura
  canonica actual coincide exactamente con `EstadoHashAnterior`; no incrementa
  la revision ni altera Oracle.
- Si la lectura difiere, el Backend conserva `INCIERTA` o `PARCIAL` y devuelve
  `ORACLE_RECONCILIACION_NO_SEGURA` para evitar ocultar un cambio aplicado o
  externo.
- El Front invoca la reconciliacion al actualizar el estado del grupo. Cuando
  se demuestra que no hubo cambios, informa que el guardado no se realizo y
  permite continuar con una nueva edicion, sin SQL manual.
- Validacion: TypeScript, `npm run validar:todas`, `npm run dist` del Backend y
  `npm run build` del Front: **OK**.

### Vertical de modificadores Oracle v1 - 2026-09-24

- Se habilitó el dominio independiente `MODIFICADORES` para el contrato v1.
  El Front transforma la diferencia entre la selección anterior y la nueva en
  listas `agregar` y `quitar`; no mezcla ese cambio con generales, cupos o
  mensajes.
- La persistencia no inventa un SP nuevo: reutiliza `SIPF1_ALTAGRUPO2`, que es
  el flujo Oracle completo disponible. El adaptador reconstruye el mensaje
  `PLA` con la representación `|CLAVE1|CLAVE2|`, conserva y rehidrata horarios,
  mensajes y planes compartidos, y verifica que el conjunto de modificadores
  leído después coincida con lo solicitado.
- La capacidad se publica únicamente cuando `ORACLE_CONTROL_GUARDADO=SI` y
  `GRUPOS_V1_MODIFICADORES_ESCRITURA=SI`. Se validan claves, duplicados,
  intersecciones entre alta/baja y pertenencia al catálogo; MSSQL permanece en
  su ruta legacy.
- Pruebas locales: `cmd /c npx tsc --noEmit`,
  `cmd /c npm run validar:grupo-cambios-v1`,
  `cmd /c npm run validar:todas` y `cmd /c npm run build` del Front: **OK**.
  El build Front reportó 0 variables CSS indefinidas. `npm run dist` no pudo
  sobrescribir `dist` porque el proceso Node activo mantiene esos archivos
  bloqueados; no reportó errores de TypeScript y queda pendiente repetirlo al
  reiniciar el Backend.
- Prueba manual pendiente: seleccionar un grupo Oracle con horario y al menos
  un modificador visible, agregar o quitar un solo modificador y confirmar que
  la respuesta sea `CambioGrupoAplicado`, que cambie la revisión y que el
  horario y los mensajes anteriores permanezcan iguales.

### Correccion de segunda transicion de modificadores - 2026-09-24

- La primera prueba de modificadores fue exitosa, pero la siguiente transición
  no reflejó correctamente la baja del modificador anterior y el alta del nuevo.
- El problema estaba en el rebasing del estado local de
  `EditarGeneralesComponent`: si la carga del catálogo coincidía con el evento
  `grupoGuardado`, la actualización del grupo nuevo podía descartarse por el
  guard de carga. La selección visual quedaba desfasada respecto a
  `modificadoresOrig`, y el Front calculaba listas incompletas.
- Corrección Front: la inicialización ahora encola el grupo recibido mientras
  hay una carga activa y lo procesa al terminar; el estado base se actualiza
  antes de permitir otra edición.
- Evidencia adicional: la prueba siguiente cayó en `guardarGrupo` legacy porque
  el editor de mensajes reportó también el cambio derivado de `PLA`. El selector
  v1 ahora descarta ese `PLA` derivado cuando existe una transición explícita de
  modificadores; un `INS`, `POPUP` u otro cambio real todavía obliga a conservar
  la ruta legacy.
- Validación: `cmd /c npm run build` en `siple-front`: **OK**; preflight CSS:
  0 variables indefinidas.
- Prueba pendiente: después de reiniciar/recargar Front, quitar el modificador
  agregado en la primera prueba y seleccionar otro en la misma edición. La
  operación debe enviar una baja y un alta, devolver `CambioGrupoAplicado` y
  dejar únicamente el nuevo modificador.

### Contencion de fallback legacy para modificadores - 2026-09-24

- La segunda evidencia real mostró que el Front todavía entró a
  `guardarGrupo` con `sp.encabezado=false`. Oracle ejecutó la ruta de mensajes
  sobre el `PLA` existente, por lo que no podía reemplazar de forma confiable
  `PB` por `COIL`.
- El Front ya no permite ese fallback cuando el único dominio solicitado es
  `MODIFICADORES`. Si la revisión v1 o la capacidad no están disponibles,
  muestra un rechazo explícito y evita una escritura legacy que pueda aparentar
  éxito sin cambiar Oracle.
- El build Front posterior a la contención pasó correctamente. Antes de la
  siguiente prueba hay que reiniciar el Backend para cargar
  `GRUPOS_V1_MODIFICADORES_ESCRITURA=SI` y verificar que la capacidad
  `MODIFICADORES/AGREGAR` y `MODIFICADORES/QUITAR` aparezca disponible.

### Correccion de seleccion de operacion para modificadores - 2026-09-24

- La capacidad v1 de modificadores ya incluia altas y bajas, pero el Front
  construia siempre la operacion `MODIFICADORES/PATCH`. Como esa capacidad no
  estaba publicada en la lectura del Backend, `usarV1` era falso para cualquier
  grupo y el Front mostraba que la escritura independiente no estaba disponible.
- Correccion: el Front selecciona `AGREGAR` si solo hay altas, `QUITAR` si solo
  hay bajas y `PATCH` cuando la misma edicion combina alta y baja. El Backend
  publica y valida las tres capacidades cuando la bandera v1 esta habilitada.
- Validacion: `npm run validar:grupo-cambios-v1`, `npm run validar:todas`,
  `npx tsc --noEmit` en Backend y `npm run build` en Front: **OK**.
- Prueba manual pendiente: reiniciar Backend y recargar Front; en un grupo
  Oracle con un modificador existente, sustituirlo por otro en una sola
  edicion. Debe invocar `aplicarCambiosGrupo`, devolver `CambioGrupoAplicado`,
  cambiar la revision y conservar horarios, mensajes y planes.

### Limite seguro de modificadores con SP Oracle actuales - 2026-09-24

- La prueba de sustitucion envio correctamente `agregar` y `quitar`, pero
  Oracle no confirmo el resultado. La causa es que `SIPF1_ALTAMENSAJE` solo
  inserta cuando no existe el tipo de mensaje; no actualiza ni elimina el
  `PLA` existente.
- El flujo legacy tampoco es una alternativa segura para bajas o reemplazos:
  puede devolver una respuesta exitosa dejando el modificador anterior.
- Se ajustaron capacidades y preflight: solo se ofrece `MODIFICADORES/AGREGAR`
  cuando el grupo no tiene modificadores ni mensaje `PLA`; `QUITAR` y `PATCH`
  se rechazan antes de reservar una operacion Oracle. El Front informa la
  limitacion y no cae silenciosamente a `guardarGrupo`.
- Validacion: `npm run validar:grupo-cambios-v1`, `npm run validar:todas`,
  `npx tsc --noEmit` en Backend y `npm run build` en Front: **OK**.
- Para habilitar bajas o reemplazos en el futuro se requiere un SP Oracle de
  actualizacion/eliminacion de `PLA`, o una autorizacion explicita para DML
  controlado sobre `s_mensajegrupo`.

### Fallback transparente a legacy para modificadores - 2026-09-24

- El Front ya no deja al usuario frente a la decision v1/legacy. Cuando la
  escritura independiente no esta disponible sin haber ejecutado Oracle,
  informa brevemente que usara compatibilidad y reintenta con `guardarGrupo`.
- Despues del fallback compara el conjunto de modificadores devuelto por la
  lectura canonica contra el conjunto solicitado. Si Oracle no pudo quitar o
  reemplazar el `PLA`, no muestra exito falso: carga el estado real y avisa
  que no se aplicaron todos los cambios.
- Los errores posteriores a una ejecucion incierta no se reintentan en legacy;
  se conserva la proteccion de idempotencia para evitar duplicar escrituras.
- Validacion: `npx tsc --noEmit` en Backend, `npm run validar:grupo-cambios-v1`
  y `npm run build` en Front: **OK**.

### Alineacion de fallback para preservar guardado legacy - 2026-09-25

- El rechazo de modificadores en Front y la barrera equivalente en
  `Grupos.guardarGrupo` impedían el guardado tradicional existente. Se retiran
  ambas restricciones: si la vertical atomizada no puede procesar la edición,
  el Front envía el grupo completo por la ruta legacy.
- Las ediciones mixtas ya seleccionan legacy porque no pertenecen a una sola
  vertical. Los modificadores solos también usan legacy cuando la capacidad v1
  no está disponible para el estado actual del grupo.
- Si `aplicarCambiosGrupo` devuelve un rechazo tipado `OPERACION_NO_DISPONIBLE`,
  que sucede en preflight antes de ejecutar los SP, se intenta una vez el
  guardado legacy completo. Los conflictos, errores de validación y resultados
  inciertos no activan fallback automático.
- Los SP revisados delimitan lo que puede garantizarse: `ALTAHORARIO` agrega
  reservaciones exactas y confirma por defecto; `ALTAMENSAJE` inserta el tipo
  solo si no existe; `ALTAGMAP22` actualiza cupo o elimina una asignación sin
  alumnos cuando recibe cupo negativo. No hay una operación de baja/modificación
  de horarios en las llamadas Oracle que existen en Backend.
- El objetivo de horarios requiere una vertical nueva que preserve las
  reservaciones vigentes y aplique altas cuando `ALTAHORARIO` las soporte. La
  baja o cambio de una reservación requiere una operación Oracle que hoy no
  aparece en Backend; mientras tanto, una edición que la incluya debe seguir
  por el guardado tradicional completo.

### Mapa de capacidades de guardado Front/Oracle - 2026-09-25

#### Limites finales de fallback y horarios

- Esta matriz reemplaza notas anteriores que bloqueaban al usuario si faltaba una vertical atomica. Los cambios no cubiertos por una ruta atomica van por `guardarGrupo` legacy. El Front solo hace fallback ante rechazo tipado de preflight; no reenvia una operacion de resultado incierto.
- Una limitacion del SP no garantiza que legacy aplique cada cambio. Prevalece la lectura canonica rehidratada. `SIPF1_ALTAMENSAJE` es insercion condicional, no reemplazo ni baja; se conserva legacy como ruta compatible, sin afirmar que el SP haga lo que no implementa.
- No habilitar altas atomicas de horarios todavia. `SIPF1_ALTAHORARIO` agrega reservas sin detectar empalmes. `ocupacionNoCurricularEspacio` excluye grupos del mismo periodo, asi que no demuestra disponibilidad. Antes de habilitar la edicion, Backend debe validar espacio y traslape contra todas las reservas pertinentes; actualizaciones y bajas siguen legacy mientras no exista un SP que las soporte.
- Enrutamiento: un dominio y capacidad v1 habilitada -> v1; varios dominios, MSSQL, cambio no soportado o capacidad ausente -> legacy; rechazo tecnico de preflight -> un intento legacy; conflicto, validacion o resultado incierto -> sin segundo intento automatico.

#### Verificacion de fallback - 2026-09-25

- Front informa cuando un cambio que iba por v1 recibe un rechazo tecnico
  tipado previo a ejecucion; despues hace un solo intento por `guardarGrupo`.
  Si la capacidad ya indica que v1 no aplica, usa legacy directamente. No hay
  reintento automatico tras conflicto ni resultado incierto.
- Verificacion local: `npm.cmd run build` en Front; `npm.cmd run validar:todas`
  en Backend. Ambos terminaron correctamente. Las validaciones del Backend son
  simuladas y no se conectan a Oracle/MSSQL; el build reporto solo advertencias
  de navegadores listados fuera del soporte de Angular.
- Prueba pendiente en ambiente: en un grupo Oracle con horario existente,
  cambiar contenido y un cupo en la misma edicion. Esperado: Front envia la
  edicion mixta por `guardarGrupo` legacy; ambos valores quedan actualizados y
  los horarios se conservan en la lectura posterior. El aviso de reintento se
  reserva para un rechazo tecnico atomico tipado ocurrido antes de ejecutar
  Oracle.

- Generales, cupos y reemplazo de `INS`: ruta v1 cuando la capacidad está
  habilitada y el cambio pertenece a un solo dominio. Cualquier cambio mixto
  cae al guardado agregado legacy.
- Modificadores: v1 solo puede intentar altas si no existe `PLA`. Para bajas,
  reemplazos, altas sobre un `PLA` existente o cambios mixtos se llama al
  guardado legacy como respaldo de compatibilidad. El resultado comunicado
  debe venir de la lectura rehidratada de Oracle.
- Horarios: `SIPF1_ALTAHORARIO` solo agrega la reservación exacta si no existe;
  no actualiza ni elimina. `EditarEspaciosComponent` solo muestra la plantilla
  y la lista actual, y no emite ediciones. La futura ruta debe empezar por
  altas nuevas; cambios de hora/espacio y bajas necesitan otra operación Oracle.
- Planes compartidos: `SIPF1_ALTAGMAP22` agrega o actualiza cupo; con cupo
  negativo intenta eliminar solo si no hay alumnos inscritos. El guardado
  legacy reenvía la colección completa y el SP resuelve cada asignación.
- Materias adicionales/principal, profesor, exigencia, tipo de asistencia,
  bloqueos y campos sin vertical v1 continúan por legacy.
- Un rechazo tipado `OPERACION_NO_DISPONIBLE` de preflight puede pasar una vez
  a legacy; validaciones de negocio, conflictos y resultados inciertos no
  provocan otro intento automático.

### Reemplazo de modificador no confirmado en CPC016L - 2026-09-25

- Evidencia real: el segundo cambio (COIL -> PB) se envió por
  `guardarGrupo` legacy. El Back ejecutó `SIPF1_ALTAMENSAJE` con tipo `PLA`,
  rehidrató y respondió éxito, pero conservó el PLA anterior. `ALTAMENSAJE` solo
  inserta tipos ausentes; el reemplazo tradicional funciona porque
  `ALTAGRUPO2` limpia los mensajes antes de volver a insertarlos.
- Causa: el guardado selectivo detectaba el cambio en `mensajes` y ejecutaba
  `ALTAMENSAJE`, pero dejaba `sp.encabezado=false`; por eso omitía la limpieza
  previa que hacía posible reemplazar PLA.
- Corrección Backend: los cambios selectivos de mensajes también invocan
  `ALTAGRUPO2` y reenvían la colección completa con `ALTAMENSAJE`. Los horarios
  se reenvían para conservarlos y los planes no se reescriben si no cambiaron.
  Se conserva la comprobación Front del estado rehidratado como resguardo.
- Verificación local: nueva prueba de guardado selectivo COIL -> PB confirmó
  que se invocan encabezado, horarios y colección completa de mensajes, sin
  reescribir planes; `npm.cmd run validar:guardar-grupo`, `npx.cmd tsc --noEmit`
  y el build Front terminaron correctamente. Aún falta la prueba contra Oracle.
