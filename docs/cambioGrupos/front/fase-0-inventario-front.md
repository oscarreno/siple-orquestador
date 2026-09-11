# Fase 0 — Inventario vigente del Frontend

**Fecha del corte:** 2026-09-04  
**Rama:** `chore/graphql-variables-refactor`  
**Repositorio:** `siple-front`  
**Estado:** inventario inicial completado y consolidado en el orquestador.

## Resumen

El guardado de grupos está concentrado en `EditarGrupoComponent`,
`GruposFacadeService` y `GruposDataService`. La ruta preferente usa la mutación
`guardarGrupo`, pero todavía existe fallback legacy para MSSQL y Oracle. El
frontend también registra bitácora directamente y mantiene decisiones de
permisos/validación dentro de componentes.

## Orígenes y consumidores

| Origen | Entrada observable | Escritura real |
| --- | --- | --- |
| Editor desde clave de grupo | `src/app/components/table/clave-grupo/clave-grupo.component.ts:61-64` | Abre `EditarGrupoDialogComponent`; el guardado termina en `EditarGrupoComponent`. |
| Editor desde chat | `src/app/components/chat/chat.component.ts:947-951` | Abre el mismo diálogo y usa `guardarGrupo`. |
| Barra de acciones | `src/app/components/barra-acciones/barra-acciones.component.ts:304-315` | Abre el mismo diálogo con sección inicial; el guardado termina en `guardarGrupo`. |
| Editor completo | `src/app/components/editar-grupo/editar-grupo.component.ts:73-132` | Recompone una copia de `Grupo`, envía cambios de bitácora y llama al facade. |
| Revisión de planeación | `src/app/components/barra-acciones/barra-acciones.component.ts:345-390`, `src/app/components/table/revisado/revisado.component.ts:90-113` | Llama `revisarGrupoPlaneacion`; es escritura separada del guardado de características. |
| Plantilla de horarios | `src/app/components/plantilla-horarios/plantilla-horarios.component.ts` | Solo visualiza y sincroniza grupos; no se encontró escritura de espacio/horario. |

## Flujo actual de guardado

1. Los subcomponentes de cupos, generales, mensajes, planes y espacios emiten
   arreglos `iCambioRealizado` al recibir `solicitarCambios`.
2. `EditarGrupoComponent` muta `grupoCopia` y recompone mensajes, modificadores,
   PB y planes.
3. `GruposFacadeService.guardarGrupo` delega a
   `GruposDataService.guardarGrupoDBO` (`grupos-facade.service.ts:221-227`).
4. `GruposDataService` intenta `guardarGrupo` con `GrupoInput` completo
   (`grupos-data.service.ts:614-734`).
5. Si detecta que el contrato no existe, usa `guardarGrupoLegacy` y sus llamadas
   separadas Oracle/MSSQL (`grupos-data.service.ts:637-704`).
6. La ruta legacy registra bitácora mediante `LogService` y vuelve a consultar el
   grupo (`grupos-data.service.ts:1018`, `log.service.ts:40-73`).
7. Tras éxito, el editor conserva principalmente su copia local y solo injerta
   fechas; no reemplaza completamente su estado con el grupo canónico recibido
   (`editar-grupo.component.ts:116-132`).

## Permisos y reglas actualmente intentados en UI

- `editarGrupos`, `editarEspacios` y `modificarCupos` se consultan en
  `barra-acciones.component.ts:445-452`.
- Cupos implementa reglas locales de permisos, capacidad, inscritos y
  distribución en `editar-cupos.component.ts:90-540`.
- Espacios actualmente solo transforma datos para presentación en
  `editar-espacios.component.ts`; no crea una operación de cambio.
- Los componentes emiten valores anteriores/nuevos para formar bitácora; la UI
  no tiene resultado tipado para rechazo, advertencia o conflicto.

## Rutas y tipos legacy detectados

- `guardarGrupo` con `GrupoInput` completo.
- `guardarGrupoMSSQL` y `guardarPlanCompartidoMSSQL`.
- `guardarEncabezadoGrupoDBO`, `guardarHorarioGrupoDBO`,
  `guardarPlanCompartidoGrupoDBO` y `guardarMensajeGrupoDBO`.
- `guardarBitacora` público consumido desde `LogService`.
- `GruposFacadeService` sigue siendo consumidor central y debe migrar
  segmentadamente a `GrupoCambiosService` sin romper lecturas no relacionadas.

## Pruebas y línea base

| Comando | Resultado |
| --- | --- |
| `cmd /c npm run build` | **OK**. Preflight CSS: 478 archivos, 0 variables indefinidas. Build Angular producción completado. |
| `cmd /c npm test -- --watch=false --browsers=ChromeHeadless` | **FALLA BASE**. `zone.js` no exporta `./dist/zone-testing`, error TS2322 en `websockets.service.ts:171` y `EPERM` al escribir `.angular/cache`. No se ejecutaron specs. |

## Riesgos y siguiente paso

- El frontend aún puede sobrescribir campos no incluidos en un cambio parcial.
- El frontend aún transporta `cambiosBitacora` y tiene fallback legacy.
- El cambio de espacios/horarios no es todavía un caso de uso persistente.
- La línea base de tests debe repararse o aislarse antes de usarla como prueba de
  regresión de fases posteriores.

**Siguiente paso:** comparar este inventario con el reporte de Back, cerrar el
censo consolidado y congelar el contrato v1 antes de implementar.
