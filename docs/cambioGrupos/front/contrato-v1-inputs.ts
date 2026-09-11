// Generado desde el SDL v1. No editar manualmente.
// Los campos omitidos se conservan; null se admite solo en datos.plantilla.
// Las combinaciones condicionales de operaciones se validan en Backend.

export type OrigenDatosGrupo = 'ORACLE' | 'MSSQL';

export type OrigenOperacionGrupo = 'EDICION_COMPLETA' | 'CAMBIO_RAPIDO' | 'PLANTILLA_HORARIOS' | 'EDICION_MASIVA';

export interface GrupoRefInput {
  readonly origen: OrigenDatosGrupo;
  readonly periodo: string;
  readonly clave: string;
}

export interface GrupoVersionadoInput {
  readonly objetivo: GrupoRefInput;
  readonly revisionGrupoEsperada: string;
}

export type DominioCambioGrupo = 'GENERALES' | 'CUPOS' | 'MENSAJES' | 'MODIFICADORES' | 'HORARIOS' | 'PLANES_COMPARTIDOS' | 'MATERIAS';

export interface AplicarCambiosGrupoRequest {
  readonly objetivo: GrupoRefInput;
  readonly revisionGrupoEsperada: string;
  readonly origenOperacion: OrigenOperacionGrupo;
  readonly cambios: CambiosGrupoInput;
  readonly advertenciasConfirmadas: ReadonlyArray<string>;
  readonly idempotencyKey: string;
}

export interface CambiosGrupoInput {
  readonly generales?: CambiosGeneralesGrupoInput;
  readonly cupos?: CambiosCuposGrupoInput;
  readonly mensajes?: ReadonlyArray<CambioMensajeGrupoInput>;
  readonly modificadores?: CambiosModificadoresGrupoInput;
  readonly horarios?: ReadonlyArray<CambioHorarioGrupoInput>;
  readonly planesCompartidos?: ReadonlyArray<CambioPlanGrupoInput>;
  readonly materias?: ReadonlyArray<CambioMateriaGrupoInput>;
}

export interface CambiosGeneralesGrupoInput {
  readonly tipo?: string;
  readonly idioma?: string;
  readonly liberable?: boolean;
  readonly contenido?: string;
}

export interface CambiosCuposGrupoInput {
  readonly cupoGeneral?: number;
  readonly primerIngreso?: number;
  readonly reingreso?: number;
  readonly complementario?: number;
}

export type OperacionMensajeGrupo = 'REEMPLAZAR' | 'ELIMINAR';

export interface CambioMensajeGrupoInput {
  readonly operacion: OperacionMensajeGrupo;
  readonly tipo: string;
  readonly texto?: string;
}

export interface CambiosModificadoresGrupoInput {
  readonly agregar: ReadonlyArray<string>;
  readonly quitar: ReadonlyArray<string>;
}

export type OperacionHorarioGrupo = 'ALTA' | 'ACTUALIZACION' | 'BAJA' | 'CAMBIO_ESPACIO';

export interface CambioHorarioGrupoInput {
  readonly operacion: OperacionHorarioGrupo;
  readonly asignacionId?: string;
  readonly datos?: DatosHorarioGrupoInput;
  readonly claveEspacio?: string;
}

export interface DatosHorarioGrupoInput {
  readonly plantilla?: string | null;
  readonly numDiaSemana: number;
  readonly claveEspacio: string;
  readonly horaInicio: string;
  readonly horaFin: string;
}

export type OperacionElementoGrupo = 'ALTA' | 'ACTUALIZACION' | 'BAJA';

export interface CambioPlanGrupoInput {
  readonly operacion: OperacionElementoGrupo;
  readonly programa: string;
  readonly materia: string;
  readonly cupo?: number;
}

export type OperacionMateriaGrupo = 'ALTA' | 'BAJA' | 'REEMPLAZO';

export type RolMateriaGrupo = 'PRINCIPAL' | 'ADICIONAL';

export interface CambioMateriaGrupoInput {
  readonly operacion: OperacionMateriaGrupo;
  readonly rol: RolMateriaGrupo;
  readonly materia: string;
  readonly materiaNueva?: string;
}

export type ModoCambiosGrupos = 'TODO_O_NADA';

export interface AplicarCambiosGruposRequest {
  readonly objetivos: ReadonlyArray<GrupoVersionadoInput>;
  readonly origenOperacion: OrigenOperacionGrupo;
  readonly cambiosComunes: CambiosGrupoInput;
  readonly modo: ModoCambiosGrupos;
  readonly advertenciasConfirmadas: ReadonlyArray<string>;
  readonly idempotencyKey: string;
}
