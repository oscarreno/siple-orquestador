-- Paquete de diagnóstico de solo lectura para DBA.
-- Sustituir :OWNER por el propietario real de los objetos Oracle.
-- Ejecutar en desarrollo/réplica; no contiene DML y no debe ejecutarse sobre
-- producción sin autorización operativa.

-- 1) Objetos y tipos registrados.
SELECT owner, object_name, object_type, status, created, last_ddl_time
FROM all_objects
WHERE owner = UPPER(:OWNER)
  AND object_name IN (
    'SIPF1_ALTAGRUPO2',
    'SIPF1_ALTAHORARIO',
    'SIPF1_ALTAMENSAJE',
    'SIPF1_ALTAGMAP22'
  )
ORDER BY object_name, object_type;

-- 2) Firmas y parámetros.
SELECT owner, object_name, package_name, overload, position, sequence,
       argument_name, in_out, data_type, data_length, data_precision,
       data_scale, defaulted
FROM all_arguments
WHERE owner = UPPER(:OWNER)
  AND object_name IN (
    'SIPF1_ALTAGRUPO2',
    'SIPF1_ALTAHORARIO',
    'SIPF1_ALTAMENSAJE',
    'SIPF1_ALTAGMAP22'
  )
ORDER BY object_name, overload, sequence, position;

-- 3) Fuente disponible y búsqueda de efectos transaccionales.
SELECT owner, name, type, line, text
FROM all_source
WHERE owner = UPPER(:OWNER)
  AND name IN (
    'SIPF1_ALTAGRUPO2',
    'SIPF1_ALTAHORARIO',
    'SIPF1_ALTAMENSAJE',
    'SIPF1_ALTAGMAP22'
  )
ORDER BY name, type, line;

SELECT owner, name, type, line, text
FROM all_source
WHERE owner = UPPER(:OWNER)
  AND name IN (
    'SIPF1_ALTAGRUPO2',
    'SIPF1_ALTAHORARIO',
    'SIPF1_ALTAMENSAJE',
    'SIPF1_ALTAGMAP22'
  )
  AND (
    UPPER(text) LIKE '%COMMIT%'
    OR UPPER(text) LIKE '%ROLLBACK%'
    OR UPPER(text) LIKE '%AUTONOMOUS_TRANSACTION%'
  )
ORDER BY name, type, line;

-- 4) Dependencias directas. Los objetos TABLE/VIEW son candidatos a revisar
--    para triggers y restricciones; paquetes y funciones deben inspeccionarse
--    por efectos laterales.
SELECT owner, name, type, referenced_owner, referenced_name,
       referenced_type, dependency_type
FROM all_dependencies
WHERE owner = UPPER(:OWNER)
  AND name IN (
    'SIPF1_ALTAGRUPO2',
    'SIPF1_ALTAHORARIO',
    'SIPF1_ALTAMENSAJE',
    'SIPF1_ALTAGMAP22'
  )
ORDER BY name, referenced_owner, referenced_name, referenced_type;

-- 5) Triggers de las tablas/vistas materializadas que aparezcan como
--    dependencias. Revisar también triggers invocados indirectamente por
--    paquetes o procedimientos auxiliares.
WITH objetos AS (
  SELECT DISTINCT referenced_owner AS table_owner,
                  referenced_name AS table_name
  FROM all_dependencies
  WHERE owner = UPPER(:OWNER)
    AND name IN (
      'SIPF1_ALTAGRUPO2',
      'SIPF1_ALTAHORARIO',
      'SIPF1_ALTAMENSAJE',
      'SIPF1_ALTAGMAP22'
    )
    AND referenced_type IN ('TABLE', 'VIEW')
)
SELECT t.owner, t.trigger_name, t.table_owner, t.table_name, t.status,
       t.trigger_type, t.triggering_event
FROM all_triggers t
JOIN objetos o
  ON o.table_owner = t.table_owner
 AND o.table_name = t.table_name
ORDER BY t.owner, t.table_owner, t.table_name, t.trigger_name;

-- 6) Restricciones e índices existentes sobre los objetos candidatos. Usar
--    el resultado para decidir si revisión/idempotencia ya tienen soporte.
SELECT c.owner, c.table_name, c.constraint_name, c.constraint_type,
       c.status, c.deferrable, c.deferred, c.search_condition_vc
FROM all_constraints c
WHERE c.owner = UPPER(:OWNER)
ORDER BY c.table_name, c.constraint_name;

SELECT i.owner, i.table_name, i.index_name, i.uniqueness, i.status,
       ic.column_position, ic.column_name
FROM all_indexes i
JOIN all_ind_columns ic
  ON ic.index_owner = i.owner
 AND ic.index_name = i.index_name
 AND ic.table_name = i.table_name
WHERE i.owner = UPPER(:OWNER)
ORDER BY i.table_name, i.index_name, ic.column_position;

-- 7) Si el código está wrapped o la fuente no es visible, registrar aquí la
--    limitación y sustituirla por la prueba controlada de rollback descrita en
--    fase-3-5-preimplementacion-revision-idempotencia.md.
