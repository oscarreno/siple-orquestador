# Aprobación del contrato de grupos v1

Fecha: 2026-09-08. Dictamen del orquestador: **APROBADO PARA FUNDACIONES**,
con las reservas de `resolucion-fronteras-v1.md`. Aprobación de diseño y
transporte; no implica una API desplegada ni autoriza a eludir las puertas de
habilitación de cada fase.

## Revisiones independientes

Se ejecutaron dos instancias de revisión de solo lectura, conforme a la guía
de colaboración Front/Back. No modificaron repositorios ni consultaron BD.

| Responsable | Evidencia inspeccionada | Dictamen final |
| --- | --- | --- |
| Agente `revision_back_v1` | Schema, `Grupos.ts`, `Grupos.build.ts`, matriz y contrato actualizado | Ratifica inicio de Fase 3. Sin bloqueadores de diseño tras precisiones de concurrencia, confirmación y replay. |
| Agente `revision_front_v1` | Editor de grupos/mensajes, servicios de datos, configuración Apollo, guía de modelos y modelos de transporte v1 | Ratifica inicio de Fase 3. Representable con aislamiento de estado/transporte y reservas explícitas. |
| Orquestador | Correcciones, SDL integrado, generación de inputs, compilación y ejecución local de fixtures | Aprueba contrato; verifica igualdad de espejos como cierre documental de Fase 2. |

## Correcciones exigidas e incorporadas

1. Revisión del grupo cubre escritores legacy/externos. Sin detección y control
   atómico compartidos no se habilita el origen. Un contador solo v1 es insuficiente.
2. Credencial de advertencia incluye efecto candidato y dependencias relevantes;
   un cambio de efecto exige nueva confirmación explícita, sin escritura previa.
3. Una respuesta ya confirmada se recupera antes de validar revisión, disponibilidad
   y vencimientos actuales; autenticación y autorización para revelar el resultado
   siguen aplicándose. Nunca se recicla una clave confirmada tras purgar respuesta.
4. En ALTA/ACTUALIZACION de una asignación, datos completos con plantilla omitida
   equivalen a sin plantilla. CAMBIO_ESPACIO conserva la plantilla existente.
5. Front usa DTO de dominio y estado por objetivo/revisión; transporte no-cache,
   sin constructores/parsers legacy ni mezcla de instantáneas. Selección parcial
   no sustituye al grupo completo. PLA/POPUP planos no se recodifican en Front.

La guía de modelos de Front se localizó en
`docs/infoAlumnos/modelos-estructura.md`; la ruta general citada por AGENTS no
existe. No se creó un modelo de pantalla alternativo ni un servicio productivo.

## Alcance aprobado y reservas

Quedan acordados request parcial, nulabilidad, nombres, resultados, capacidades,
semántica de colecciones, no-op, credenciales, idempotencia y aislamiento de lectura.
La matriz funcional aprobada se conserva como autoridad. Las reservas no eliminan
requisitos de la iniciativa: se revisan antes de habilitar sus dominios.

- Horarios: requieren identidad durable, cobertura completa de sesiones y
  validación de plantilla/ocupaciones; la vista de semana 3 no demuestra eso.
- Principal e intercambios: sin ejecución hasta cerrar sus efectos sobre
  relaciones, otros grupos y ajustes de cupos.
- Bajas de planes, adicionales Oracle independientes y tipos de mensaje no
  soportados: rechazo tipado mientras no exista persistencia autoritativa.
- PLA ambiguo: no se pierde texto ni se altera PB para adaptar una representación.
- Lotes: request reservado, sin mutación ejecutable ni ciclos del comando unitario.

## Validación reproducible

Desde `siple-orquestador`, con las dependencias locales de Back disponibles:

```text
node docs/cambioGrupos/generar-inputs-v1.cjs --check
node docs/cambioGrupos/validar-propuesta-v1.cjs docs/contratos/grupos-v1
node docs/cambioGrupos/validar-consumo-v1.cjs docs/contratos/grupos-v1
```

La evidencia cubre integración del SDL con el schema vigente, coerción de
variables, modelos de entrada sin divergencias, TypeScript estricto y ejecución
GraphQL con fixtures de aplicado/rechazo/conflicto/advertencia, request de
confirmación y lectura versionada/null. No demuestra criptografía, reglas de
negocio, permisos efectivos, concurrencia ni transacciones reales. Esos son
criterios de salida de Fase 3 y de las verticales correspondientes.

Los espejos se publican en `docs/contratos/grupos-v1/` de Orquestador, Back y
Front. `manifest.json` registra SHA-256 por archivo. Su igualdad se comprueba
desde el orquestador con `node docs/cambioGrupos/verificar-espejos-v1.cjs`.

## Siguiente bloque

Fase 3, bloque 3.1: revisar y restringir `guardarBitacora` pública para impedir
auditoría arbitraria, con censo de consumidores, preservación del guardado
legítimo y regresión proporcional. No habilitar comandos v1 hasta completar
las fundaciones de autorización, revisión, idempotencia y atomicidad.
