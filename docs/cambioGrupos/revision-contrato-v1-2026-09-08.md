# Revisión técnica del borrador v1

Fecha: 2026-09-08. Responsable: Orquestador, mediante inspección directa de
Back y Front. Dictamen: **correcciones incorporadas; Fase 2 aún no aprobada**.
Este documento no representa una revisión independiente de agentes Front/Back.

## Evidencia y cambios concretos

| Hallazgo | Evidencia de código | Corrección del borrador |
| --- | --- | --- |
| Faltaban campos generales efectivamente editados | Front `src/app/components/editar-grupo/editar-generales/editar-generales.component.ts:133`; padre `editar-grupo.component.ts:166` | Agregar `CambiosGeneralesGrupoInput` con tipo, idioma, liberable y contenido. |
| Asistencia/exigencia viajan en el agregado pero no se editan en el subcomponente | Back `src/clases/Grupos.ts:905` y `:1115`; emisor de Front anterior | No inventar controles ni incluir esos campos como editables; exigir preservación canónica. |
| PLA combina prefijo de códigos y texto libre | Front `editar-grupo.component.ts:216`; `editar-mensajes/editar-mensajes.component.ts:71` | Separar datos lógicos y permitir edición simultánea; omitir uno conserva su estado. |
| Normalización Back puede perder el texto al guardar modificadores | Back `src/clases/Grupos.ts:1341`, especialmente `:1364` | No reutilizar el helper como adaptador v1; requerir composición reversible y conservación de PB. |
| Numeración semanal verificable | Back `src/clases/Grupos.ts:1512` | Documentar lunes 1 a domingo 7. |
| Identificación de plantilla usa aproximaciones | Back `src/clases/Plantillas.ts:86` | No tratar el helper como prueba de integridad; mantener ratificación pendiente. |
| Horarios no tienen ID expuesto y MSSQL reemplaza toda la colección | Back schema `GrupoHorario`; `src/clases/Grupos.ts:981` | Mantener ID servidor como requisito de habilitación; no inventar un índice de arreglo. |
| Materias principal/adicional tienen roles distintos | Back `src/clases/Grupos.ts:958`–`:975` | Mantener pendiente la semántica de principal; el input genérico aún no prueba cobertura. |

## Riesgos que siguen abiertos

El texto con delimitador `|` no puede darse por resuelto con el corte por último
delimitador del cliente legacy. Hace falta demostrar un adaptador reversible o
mantener ese caso explícitamente no disponible; interpretar contenido libre como
un modificador sería una modificación de PB fuera del dominio solicitado.

La identidad estable de horarios requiere evidencia de tablas/procedimientos o
un mecanismo nuevo controlado por Back. La inspección de llamadas al procedimiento
de alta no demuestra capacidad de baja o actualización selectiva. Tampoco se
demostró soporte de baja de planes; sigue reservado, con rechazo tipado.

No se aprueba la migración del editor completo hasta resolver materia principal,
intercambios y ajustes confirmados de cupos. No se avanza a Fase 3 por el solo hecho
de que el SDL sea sintácticamente válido.

## Verificación y cierre del bloque

Comando: `node docs/cambioGrupos/validar-propuesta-v1.cjs`.
Resultado: **OK**. Se integró el SDL nuevo con el schema actual y se comprobaron las
variables de cambios generales, incluidos `false`, texto vacío, omisión de cupos
y rechazo de `discapacidad` dentro de generales. Los ejemplos de
resultados siguen siendo fixtures; no se ejecutaron escrituras ni resolvers.

Back continúa en `master` limpio. Front continúa en
`chore/graphql-variables-refactor`, con sus documentos previos sin seguimiento
preservados. Solo se modificaron artefactos de coordinación.

Siguiente bloque: resolver la representación exacta de materia principal y
horarios por origen, y realizar revisión de consumo con modelos TypeScript y
fixtures de advertencia/confirmación. Los puntos funcionales no deducibles deben
presentarse con alternativas concretas antes de su aprobación.
