# Optimización de búsqueda de espacios en Oracle

Fecha: 2026-10-02.

## Cambio implementado

La lectura de ocupaciones Oracle agrupa todos los horarios solicitados en una consulta por bloque de hasta 800 espacios únicos. Antes ejecutaba una consulta por cada horario y bloque de espacios. Los espacios que tienen conjuntos distintos de sesiones conservan su correspondencia: no se consulta una combinación de espacio y horario que no se haya solicitado.

El SQL construye las fechas de las sesiones dentro del periodo y compara `ESPACIORESERVADO.FECHAHORAINICIAL` directamente con rangos de fecha. El cálculo del día ISO se hace sobre ese calendario. `SELECT DISTINCT` elimina en Oracle las ocupaciones equivalentes que antes se transferían una vez por cada ocurrencia semanal y se deduplicaban en Back.

Back agrupa las reservas por espacio y día para que cada comprobación de disponibilidad recorra solo las reservas pertinentes. La lectura conserva grupo, horario y espacio: esos datos se necesitan para excluir las sesiones del origen que se moverán y para ofrecer intercambios completos.

Se conservan los límites del periodo, la búsqueda desde hoy para el periodo corriente, los traslapes estrictos con precisión de minuto, las actividades y reservas sin grupo, y las exclusiones existentes. La comparación de la hora final sigue usando `TO_CHAR`, para preservar también el comportamiento previo cuando la reserva termina en otra fecha. La normalización del nombre de espacio se mantiene al resolver los IDs de destino.

El cambio está en `siple-backTS/src/clases/EdicionEspacios.ts` y el nuevo generador `siple-backTS/src/clases/ConsultaOcupacionesEspaciosOracle.ts`. El validador es `siple-backTS/pruebas/validate-busqueda-espacios-oracle.ts`. No requiere DDL ni modificaciones a funciones o SP de Oracle.

## Evidencia de validación

Comandos ejecutados desde `C:\SIPLE\siple-backTS`:

| Comando | Resultado |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | Correcto; compilación TypeScript sin emitir archivos. |
| `node -r ts-node/register/transpile-only pruebas/validate-busqueda-espacios-oracle.ts --oracle` | Correcto; comprobación de bloques/binds, búsqueda en memoria, cupos y comparación de ambos SQL ejecutados en Oracle con datos sintéticos definidos en CTEs. |
| `node -r ts-node/register/transpile-only pruebas/validate-grupo-cambios-v1.ts` | Correcto; validador v1, con casos para cada una de las cuatro reglas de relación entre CG, RE, PI y AC. |
| `git diff --check` | Correcto; sin errores de espacios en los cambios rastreados. |

El nuevo validador cubre destinos duplicados, bloques de 1/800/801/1601 espacios, sesiones con espacios distintos, límites de horario, segundos, fechas finales distintas, periodo completo/corriente/vencido, último día inclusive, reservas/actividades, exclusiones y SQL con 800 destinos. También comprueba reservas propias seleccionadas y no seleccionadas, espacios comunes, compatibilidad de tipo por perfil, intercambios completos, ajuste de CG y RE en ambos sentidos, tipo mixto, RE no negativo e invariantes PI/RE/AC con grupos sintéticos.

`npx tsc --noEmit` fue bloqueado por la política de ejecución de PowerShell; se completó la misma compilación ejecutando directamente el compilador con Node.

## Medición de lectura

Se compararon los métodos anterior y nuevo desde la misma conexión Oracle con 120 espacios que tenían ocupaciones en una ventana de 29 días, cuatro horarios y tres rondas consecutivas. Los periodos se suministraron al método mediante stubs para medir la lectura de ocupaciones, sin incluir la carga de actor/grupo/catálogos. Solo se ejecutaron consultas `SELECT`; no se guardaron grupos ni se modificaron reservas.

Comando de trabajo ejecutado desde el orquestador: `node .work/optimizar-busqueda-espacios-oracle/comparar-consultas.cjs`. Ese material temporal usó una copia del método previo al cambio. La documentación registra únicamente métricas agregadas.

| Métrica | Antes | Después |
| --- | ---: | ---: |
| Consultas de ocupaciones por búsqueda | 4 | 1 |
| Filas transferidas por búsqueda | 2180 | 525 |
| Ocupaciones únicas resultantes | 525 | 525 |
| Tiempo, ronda 1 | 1466 ms | 997 ms |
| Tiempo, ronda 2 | 1438 ms | 910 ms |
| Tiempo, ronda 3 | 1430 ms | 894 ms |
| Tiempo promedio | 1445 ms | 934 ms |

Las ocupaciones resultantes fueron exactamente iguales en las tres rondas. En esta muestra, el tiempo promedio bajó aproximadamente 35 % y las filas transferidas 76 %.

## Alcance y pendientes

La medición corresponde a la lectura de ocupaciones de esa muestra. El rendimiento depende del volumen, horarios, índices existentes y plan elegido por Oracle; no se obtuvo un plan real ni se midió la búsqueda completa desde Front. La consulta puede aprovechar los índices existentes, pero no se fuerza un plan con hints.

Sigue pendiente la prueba integrada desde el editor, incluyendo el guardado legacy y los intercambios en ambiente. Las pruebas de SQL y búsqueda documentadas aquí no acreditan esas escrituras ni el funcionamiento completo de Front.
