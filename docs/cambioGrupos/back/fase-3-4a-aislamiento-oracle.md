# 3.4-A — Conexión exclusiva por transacción Oracle

Fecha: 2026-09-14. Implementado localmente en siple-backTS con autorización del
usuario. Pendiente de integración con Oracle real; Fase 3 permanece en curso.

## Cambio y alcance

`src/system/oracle.ts`: withTransaction adquiere una conexión exclusiva del
pool y la libera en finally. Commit y rollback solo actúan sobre esa conexión.
La inicialización del pool comparte una promesa para evitar creaciones
simultáneas; si falla, permite un intento posterior. La adquisición legacy
también se serializa y conserva su conexión separada. No se migró el resto de
operaciones legacy ni se cambió la semántica de sus commits.

Un fallo de liberación se registra sin reemplazar el resultado confirmado ni
el error original. Si commit falla, el resultado puede ser incierto: el intento
de rollback no demuestra que no hubo commit. Se conserva el manejo de resultado
incierto del editor; todavía no existe replay durable en el guardado legacy.

Se añadió `pruebas/validate-oracle-transacciones.ts` y el comando
`validar:oracle-transacciones`, incluido en `validar:todas`. Se preservaron los
cambios locales previos de Backend. No se modificó Front ni el contrato v1.

El patrón de adquisición/liberación sigue la documentación del driver:
https://node-oracledb.readthedocs.io/en/stable/user_guide/connection_handling.html

## Verificación ejecutada

- Nueva prueba sobre el wrapper real con driver simulado: OK. Dos callbacks
  solapados, conexiones distintas, un solo pool, commit/rollback independientes,
  conexión legacy separada, fallo de commit, rollback y close, adquisición
  fallida sin ejecutar callback y recuperación tras fallo al crear pool.
- Tres validadores previos de guardarGrupo, bitácora pública y auditoría: OK.
- TypeScript --noEmit y npm run dist: OK.
- git diff --check: OK.

No se levantó servidor ni se hicieron operaciones contra bases reales.
Las pruebas no validan commits internos de los procedimientos SIPF1_*.

## Qué probar manualmente

Usar el entorno de pruebas y grupos destinados a pruebas. Reiniciar el Backend
con la compilación nueva usando el procedimiento habitual.

1. Abrir un grupo Oracle, registrar los valores iniciales y cambiar un cupo
   válido o mensaje INS. Guardar, recargar desde servidor y comprobar valor y
   bitácora. No usar una edición de PLA/modificadores como primera prueba,
   porque conserva limitaciones legacy ajenas a este bloque.
2. En dos sesiones, abrir DOS grupos Oracle distintos y guardar casi a la vez.
   Ambos deben conservar sus respectivos cambios después de recargar.
3. Realizar al menos diez guardados secuenciales en grupos de prueba y consultar
   entre ellos. Deben seguir respondiendo sin agotar el pool ni atascarse tras
   los primeros guardados. Esto es un smoke test, no prueba exhaustiva de carga.
4. Guardar y recargar un grupo MSSQL como regresión del flujo existente.
5. En integración técnica con DBA: provocar un error requerido de hijo dentro
   de una transacción de prueba mientras otra, sobre un grupo diferente,
   confirma. Consultar desde una tercera sesión y comprobar que la primera no
   dejó cambios parciales y la segunda sí confirmó. No inducir este fallo en
   producción ni tratar un error de validación previo al guardado como prueba
   de rollback Oracle.

Reportar para cada caso: origen, periodo, grupo, hora, valor inicial/final,
resultado tras recargar y error observado si existe. No compartir tokens.

## Límites y próximo bloque

Esto aísla sesiones transaccionales; no impide sobrescrituras de dos ediciones
del MISMO grupo. Persisten auditoría MSSQL post-commit, rehidratación posterior,
writers externos sin revisión y falta de idempotencia durable. La API v1 sigue
sin habilitarse. Un procedimiento con commit interno impediría rollback total
aun con este wrapper y requiere evidencia del DBA.

Próximo bloque: confirmar límites transaccionales de SIPF1_* y concretar
persistencia de revisión/auditoría/idempotencia con esquema disponible. No
instalar DDL supuesto ni declarar cerrada la Fase 3 con estos mocks.
