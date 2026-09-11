# Fronteras por origen y revisión de consumo v1

Fecha: 2026-09-08. Revisión del orquestador sobre código local. Estado:
reservas ratificadas por revisión independiente Back/Front; no habilita escrituras.

## Horarios: identidad y disponibilidad

Back `src/clases/Grupos.build.ts:290` selecciona plantilla, día, horas y espacio,
sin identificador de asignación. En Oracle filtra `NUMSEMANAPERIODO = 3`.
Esto es una vista representativa, no evidencia de todas las sesiones del periodo.
Tampoco la ausencia de ID en esta consulta demuestra que las tablas no lo tengan.

El contrato exige que `asignacionId` identifique una asignación autoritativa
del objetivo y permanezca estable al cambiar espacio, horas o plantilla.
No admite un hash de campos mutables ni un índice de la colección. Back debe
exponer una PK existente o crear una identidad durable en el mismo origen,
con relación verificable a todas las sesiones afectadas. El ID no se recicla
tras una baja. La lectura devuelve ID y revisión en la misma instantánea.

Mientras no exista ese mecanismo, `horariosIdentificados` devuelve `null` y
las capacidades de horarios indican no disponible. `[]` significa lectura
completa y autoritativa sin asignaciones, nunca que falló la consulta. Esto
permite leer cupos y mensajes sin fabricar IDs de horario. Un fallo técnico
de una lectura habilitada produce error, no se disfraza como indisponibilidad.

Las operaciones de horario conservan los tipos reservados. No se habilita alta,
baja, actualización ni cambio de espacio con el procedimiento de alta como
supuesto sustituto de todas ellas. Una capacidad de cambio requiere demostrar
que el conjunto afectado se carga y modifica completo, sin limitarlo a semana 3.

## Materias: rol explícito y dependencias

Back `Grupos.build.ts:220` lee adicionales MSSQL con `Principal = 0`; Oracle
las deriva de `V_SIPF1_GRUPOPLANCOMPARTIDO`, excluyendo la principal.
`Grupos.ts:958` escribe principal y adicionales como relaciones distintas en MSSQL.
El input ahora requiere `rol: PRINCIPAL | ADICIONAL` para evitar que una baja
genérica cambie la principal por inferencia.

- `ADICIONAL + ALTA/BAJA`: identifica la materia adicional exacta.
- `ADICIONAL + REEMPLAZO`: identifica materia anterior y nueva; no promueve
  ninguna a principal y no elimina otras relaciones por omisión.
- `PRINCIPAL + REEMPLAZO`: identifica principal anterior y nueva. Queda
  reservado y no disponible hasta definir las consecuencias para clave del
  grupo, planes y relación curricular. No se supone si la anterior se conserva
  como adicional ni qué ocurre si la nueva ya es adicional.
- `PRINCIPAL + ALTA/BAJA`: no disponible en el comando de edición de un grupo
  existente; no se simula creación de grupo ni eliminación de principal.
- En Oracle, editar una adicional independientemente de los planes queda no
  disponible mientras no exista una operación autoritativa específica. No se
  borran planes implícitamente para conseguir una baja de materia.

Todo caso no disponible devuelve `OPERACION_NO_DISPONIBLE` y revierte el comando
entero si se mezcló con un cambio habilitado. Esta es una limitación técnica
explícita, no una regla funcional nueva ni una excepción administrativa.

## PLA y consumidores legacy

`Grupos.build.ts:120` busca `|PB|` en todo el mensaje; Front extrae el texto
después del último `|`. Escapar el delimitador solo en el adaptador v1 rompería
esos lectores. No hay evidencia de un formato de escape compartido.

El contrato de dominio conserva texto plano y códigos por separado. Se requiere
un adaptador que preserve el texto canónico al cambiar modificadores y preserve
los códigos al cambiar texto. No debe buscar modificadores dentro de texto libre.
Hasta migrar los lectores o definir almacenamiento separado compatible, un
cambio cuyo PLA resultante sea ambiguo devuelve `OPERACION_NO_DISPONIBLE` antes
de escribir. No se reemplaza `|` por otro carácter ni se recorta el texto.
Los mensajes INS/POPUP no heredan esta limitación de representación de PLA.

## Capacidades de lectura

`grupoParaCambios.capacidades` declara soporte técnico por objetivo y operación;
no sustituye autorización, alcance, revisión ni validación al escribir.
Debe incluir todas las operaciones de los siete dominios, sin duplicados:

| Dominio | Valores de operacion |
| --- | --- |
| GENERALES, CUPOS | PATCH |
| MENSAJES | REEMPLAZAR, ELIMINAR |
| MODIFICADORES | AGREGAR, QUITAR |
| HORARIOS | ALTA, ACTUALIZACION, BAJA, CAMBIO_ESPACIO |
| PLANES_COMPARTIDOS | ALTA, ACTUALIZACION, BAJA |
| MATERIAS | ALTA_ADICIONAL, BAJA_ADICIONAL, REEMPLAZO_ADICIONAL, ALTA_PRINCIPAL, BAJA_PRINCIPAL, REEMPLAZO_PRINCIPAL |

Una capacidad disponible significa que hay implementación técnica para la
operación; no promete que todo payload sea válido. Las restricciones de tipo de
mensaje, formato ambiguo o reglas de negocio se devuelven tipadas al validar.
`motivo` es `null` si disponible, y código estable no vacío si no disponible.
La API revalida soporte en cada comando aunque Front conserve capacidades viejas.

## Consumo de Front

Se entrega `front/contrato-v1-consumo.ts` como modelo de transporte del ejemplo
de mutación, no como copia completa de `Grupo` ni servicio productivo. Usa unión
discriminada, preserva null en campos seleccionados del schema actual y obliga
a manejar aplicado, rechazado y conflicto. No interpreta texto de errores.

El resultado rechazado con advertencias mantiene el comando pendiente. Solo
tras una acción explícita se devuelven las credenciales opacas con una clave
nueva. Una pérdida de respuesta reenvía exactamente request y clave originales.
Conflicto no genera reintento automático; aplicado actualiza desde el canónico.
Al editar horarios tras un aplicado/conflicto, Front vuelve a consultar
`grupoParaCambios`; el `Grupo` legacy de la mutación no ofrece IDs de asignación.

## Puerta y evidencia pendiente

Estas correcciones hacen explícitas las reservas. No cierran por inferencia las
políticas de principal, intercambio y ajuste de cupos. Para concluir la Fase 2
se requiere publicar los espejos ratificados y verificar su igualdad según
`revision-aprobacion-v1.md`. Para habilitar horarios se necesita evidencia del esquema/procedimientos
autoritativos; los SELECT del repositorio no la aportan.

Verificación ejecutada: `node docs/cambioGrupos/validar-propuesta-v1.cjs` y
`node docs/cambioGrupos/validar-consumo-v1.cjs`, ambos **OK**. El segundo compila
el modelo con TypeScript estricto, ejecuta la selección GraphQL contra fixtures
locales y comprueba las cuatro rutas de presentación y el rol obligatorio de
materia. No ejecuta persistencia ni afirma probar confirmación criptográfica.
