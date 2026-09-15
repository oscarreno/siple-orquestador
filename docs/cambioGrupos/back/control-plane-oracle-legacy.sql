-- Migración del control durable, 2026-09-15. Ejecutar antes de activar ORACLE_CONTROL_GUARDADO=SI.
-- No ejecutar desde Backend ni sobre producción sin aprobación.
-- Los nombres, longitudes y esquema dbo son provisionales.

IF OBJECT_ID(N'dbo.GrupoControlOracle', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.GrupoControlOracle (
    Origen varchar(20) NOT NULL,
    Periodo varchar(20) NOT NULL,
    Grupo varchar(80) NOT NULL,
    RevisionControl bigint NOT NULL CONSTRAINT DF_GrupoControlOracle_Revision DEFAULT (0),
    EstadoHash char(64) NULL,
    FechaEstado datetime2(3) NULL,
    ActualizadoPor varchar(120) NULL,
    CreadoEn datetime2(3) NOT NULL CONSTRAINT DF_GrupoControlOracle_Creado DEFAULT (SYSUTCDATETIME()),
    ActualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_GrupoControlOracle_Actualizado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_GrupoControlOracle PRIMARY KEY (Origen, Periodo, Grupo)
  );
END;
GO

IF OBJECT_ID(N'dbo.GrupoOperacionOracle', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.GrupoOperacionOracle (
    OperacionId uniqueidentifier NOT NULL CONSTRAINT DF_GrupoOperacionOracle_Id DEFAULT (NEWSEQUENTIALID()),
    Actor varchar(120) NOT NULL,
    Origen varchar(20) NOT NULL,
    Periodo varchar(20) NOT NULL,
    Grupo varchar(80) NOT NULL,
    IdempotencyKey varchar(200) NOT NULL,
    RequestHash char(64) NOT NULL,
    Estado varchar(20) NOT NULL,
    Etapa varchar(40) NULL,
    RevisionAnterior bigint NULL,
    RevisionNueva bigint NULL,
    EstadoHashAnterior char(64) NULL,
    EstadoHashNuevo char(64) NULL,
    ResultadoJson nvarchar(max) NULL,
    CodigoError varchar(80) NULL,
    DetalleError nvarchar(1000) NULL,
    CreadoEn datetime2(3) NOT NULL CONSTRAINT DF_GrupoOperacionOracle_Creado DEFAULT (SYSUTCDATETIME()),
    ActualizadoEn datetime2(3) NOT NULL CONSTRAINT DF_GrupoOperacionOracle_Actualizado DEFAULT (SYSUTCDATETIME()),
    ExpiraEn datetime2(3) NULL,
    CONSTRAINT PK_GrupoOperacionOracle PRIMARY KEY (OperacionId),
    CONSTRAINT CK_GrupoOperacionOracle_Estado CHECK (Estado IN (
      'EJECUTANDO', 'RECHAZADA', 'CONFLICTO', 'APLICADA', 'PARCIAL', 'INCIERTA'
    ))
  );
END;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'UX_GrupoOperacionOracle_ActorOrigenClave'
    AND object_id = OBJECT_ID(N'dbo.GrupoOperacionOracle')
)
BEGIN
  CREATE UNIQUE INDEX UX_GrupoOperacionOracle_ActorOrigenClave
    ON dbo.GrupoOperacionOracle (Actor, Origen, IdempotencyKey);
END;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE name = N'IX_GrupoOperacionOracle_GrupoEstado'
    AND object_id = OBJECT_ID(N'dbo.GrupoOperacionOracle')
)
BEGIN
  CREATE INDEX IX_GrupoOperacionOracle_GrupoEstado
    ON dbo.GrupoOperacionOracle (Origen, Periodo, Grupo, Estado, ActualizadoEn);
END;
GO

-- Revisión DBA pendiente:
-- Una reserva debe confirmarse ANTES del primer SP; no mantener una transacción
-- MSSQL abierta alrededor de Oracle. Activa permanece 1 tras caídas y parciales.
IF COL_LENGTH(N'dbo.GrupoOperacionOracle', N'RequestJson') IS NULL
  ALTER TABLE dbo.GrupoOperacionOracle ADD RequestJson nvarchar(max) NULL;
GO
IF COL_LENGTH(N'dbo.GrupoOperacionOracle', N'Activa') IS NULL
BEGIN
  ALTER TABLE dbo.GrupoOperacionOracle ADD Activa bit NOT NULL
    CONSTRAINT DF_GrupoOperacionOracle_Activa DEFAULT (1) WITH VALUES;
  -- Compilar el UPDATE solo despues de que ALTER TABLE haya creado Activa.
  EXEC sys.sp_executesql N'UPDATE dbo.GrupoOperacionOracle SET Activa=0
    WHERE Estado IN (''APLICADA'',''RECHAZADA'',''CONFLICTO'');';
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes
  WHERE object_id=OBJECT_ID(N'dbo.GrupoOperacionOracle')
  AND name=N'UX_GrupoOperacionOracle_Activa')
BEGIN
  IF COL_LENGTH(N'dbo.GrupoOperacionOracle', N'Activa') IS NULL
    THROW 51002, 'Falta Activa: ejecutar la migracion completa y revisar errores anteriores.', 1;
  EXEC sys.sp_executesql N'CREATE UNIQUE INDEX UX_GrupoOperacionOracle_Activa
    ON dbo.GrupoOperacionOracle (Origen,Periodo,Grupo) WHERE Activa=1;';
END;
GO

-- * validar longitudes y esquema propietario;
-- * decidir cifrado/retención de ResultadoJson;
-- * confirmar permisos de INSERT/UPDATE/SELECT y creación de índices;
-- * agregar auditoría/trigger de cambios solo si negocio lo solicita;
-- * no agregar cascade delete ni tareas de purga hasta definir la política.
