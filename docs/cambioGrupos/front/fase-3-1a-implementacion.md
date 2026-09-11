# Fase 3.1-A — Contención de fallback y recuperación del editor

Fecha: 2026-09-08. Repositorio: `siple-front`.
Rama: `chore/graphql-variables-refactor`.
Dictamen del orquestador: **APROBADO como bloque local verificado**.
No se desplegó ni se modificó Backend. Fase 3 completa permanece en curso.

## Cambio observable

`guardarGrupoDBO` realiza solo la mutación agregada. Un error de transporte,
schema, autorización o respuesta nula se propaga sin iniciar fallback ni auditoría
pública. Los métodos legacy permanecen para el retiro controlado; ya no se
activan automáticamente desde ese flujo.

Si el editor envió el comando y no pudo confirmar su resultado, conserva los
cambios pendientes y bloquea Guardar tanto en el botón como en el método. Muestra
un estado de recuperación sin afirmar rollback. Consultar fuerza lectura del
grupo y no borra la edición. Adoptar los datos requiere pulsar explícitamente
«Descartar mi edición y usar datos actuales»; después se revisan los campos y
se preparan cambios nuevos. La consulta fallida conserva borrador y bloqueo.

Una actualización de entrada del mismo grupo durante el envío o la recuperación
no reemplaza el borrador. Las respuestas que llegan tras cambiar de grupo no
se aplican al grupo nuevo. El éxito usa los valores canónicos de la respuesta,
en lugar de una copia local bajo una condición siempre verdadera. El log de uso
no convierte su propio fallo en un fallo de la mutación ya confirmada.

## Archivos modificados/agregados en Front

- `src/app/services/grupos-data.service.ts`: una sola ruta de escritura;
  rechazo de raíz nula sin fallback.
- `src/app/components/editar-grupo/editar-grupo.component.ts`: recuperación con
  señales, guardas de envío, consulta/adopción y publicación canónica; query de
  hijo migrada a `viewChild` en el área intervenida; retirada depuración del guardado.
- `src/app/components/editar-grupo/editar-grupo.component.html`: estado accesible,
  consulta/adopción explícita y controles deshabilitados durante envío/recuperación.
- `src/app/components/editar-grupo/editar-grupo.component.css`: presentación adaptable
  de recuperación, texto/botones con ajuste de línea.
- `src/app/services/grupos-data.service.spec.ts` y
  `src/app/components/editar-grupo/editar-grupo.component.spec.ts`: regresión.
- `src/app/testing/grupo-guardado.fixture.ts`: datos sintéticos, sin BD.
- `src/test-guardado.ts` y `tsconfig.guardado.spec.json`: entrada focalizada con
  export público `zone.js/testing` y tipos de navegador.

## Pruebas y evidencia

| Comando / comprobación | Resultado |
| --- | --- |
| `npm test -- --watch=false --browsers=ChromeHeadless --include=src/app/services/grupos-data.service.spec.ts --include=src/app/components/editar-grupo/editar-grupo.component.spec.ts` | No ejecutó casos: import antiguo `zone.js/dist/zone-testing` y TS2322 del temporizador WebSockets, ambos previamente registrados. |
| `npm test -- --watch=false --browsers=ChromeHeadless --main=src/test-guardado.ts --ts-config=tsconfig.guardado.spec.json --include=src/app/services/grupos-data.service.spec.ts --include=src/app/components/editar-grupo/editar-grupo.component.spec.ts` | **29 SUCCESS**, ChromeHeadless 151. |
| `npm run build` | **OK**, build de producción; hash `caf55b404adf8b92`. |
| Preflight CSS incluido en build | **OK**: 478 archivos, 0 variables indefinidas. |
| `git diff --check` y lectura UTF-8 de archivos intervenidos | **OK**, sin corrupción; avisos de normalización LF/CRLF de Git. |
| `node docs/cambioGrupos/verificar-espejos-v1.cjs` desde Orquestador | **OK**, contrato v1 idéntico e intacto en los tres repositorios. |

Las pruebas ejecutan métodos reales y plantilla del editor con dependencias
simuladas. Cubren éxito canónico, errores de red/schema/autorización en ambos
orígenes, cero consultas legacy posteriores, raíz nula, borrador conservado,
segundo envío bloqueado, consulta fallida, adopción explícita, actualización de
entrada y fallo previo a enviar. El DOM verifica botón deshabilitado y estado
accesible. No se conectó BD ni se hicieron escrituras reales.

La configuración focalizada evita mezclar tipos Node con temporizadores de
navegador y no modifica WebSockets ni la entrada de la suite general. No se
declara reparada o aprobada esa suite. No se realizó una inspección gráfica
autenticada de la aplicación; la evidencia UI es DOM de prueba y compilación de
la plantilla, no una captura visual ni una prueba integral de producción.

## Compatibilidad y límites

- No se conectó Front a la API v1, todavía no implementada.
- El agregado legacy sigue recibiendo cambios de bitácora del cliente; su
  corrección y atomicidad quedan pendientes en las fundaciones de Backend.
- El cliente actualizado exige el guardado agregado. Un servidor antiguo que
  no lo ofrezca produce error explícito, sin alternativa automática de escritura.
- No hay control servidor de revisión/idempotencia en este flujo todavía;
  consultar/adoptar no garantiza ausencia de otro cambio concurrente posterior.
- Los nombres de servicios legacy existentes se conservan según el bloque
  aprobado; no se inició la migración general de nombres ni de editor completo.

## Siguiente paso atómico

Implementar 3.1-B en Back: autenticar y rechazar `Query.guardarBitacora` con
`AUDITORIA_PUBLICA_NO_DISPONIBLE` antes de invocar Log/SQL; conservar firma
deprecated, lectura de bitácora y llamadas internas. Añadir pruebas simuladas
del resolver y el formateador de errores. Desplegar la restricción solo después
de comprobar que los clientes activos no pueden escribir por el fallback antiguo.
