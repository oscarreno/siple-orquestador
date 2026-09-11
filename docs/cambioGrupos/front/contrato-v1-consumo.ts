// Modelo de la selección de CambiarGrupo del borrador. No conecta servicios.
import type { AplicarCambiosGrupoRequest } from './contrato-v1-inputs';

export const ejemploRequestCupos: AplicarCambiosGrupoRequest = {
  objetivo: { origen: 'ORACLE', periodo: '2026-2', clave: 'GRUPO-EJEMPLO' },
  revisionGrupoEsperada: 'rev-17', origenOperacion: 'CAMBIO_RAPIDO',
  cambios: { cupos: { cupoGeneral: 30 } }, advertenciasConfirmadas: [],
  idempotencyKey: 'ejemplo-cupo-001'
};
export interface GrupoSeleccionado {
  llaveUnica: string;
  cupoGeneral: number | null;
}
export interface AdvertenciaSeleccionada {
  codigo: string;
  mensaje: string;
  confirmacion: string;
  venceEn: string;
}
export interface ErrorSeleccionado {
  codigo: string;
  campo: string | null;
  ruta: string | null;
  mensaje: string;
  detalles: ReadonlyArray<{ clave: string; valor: string }>;
}
export type ResultadoSeleccionado =
  | { __typename: 'CambioGrupoAplicado'; grupo: GrupoSeleccionado;
      revisionGrupoNueva: string; auditoriaId: string;
      advertenciasAplicadas: ReadonlyArray<{ codigo: string; confirmacion: string }> }
  | { __typename: 'CambioGrupoRechazado'; errores: readonly ErrorSeleccionado[];
      advertencias: readonly AdvertenciaSeleccionada[] }
  | { __typename: 'CambioGrupoConflicto'; codigo: string; mensaje: string;
      revisionGrupoActual: string; grupoActual: GrupoSeleccionado };

export type AccionPresentacion =
  | { tipo: 'ACTUALIZAR'; grupo: GrupoSeleccionado; revision: string }
  | { tipo: 'MOSTRAR_RECHAZO'; errores: readonly ErrorSeleccionado[];
      advertencias: readonly AdvertenciaSeleccionada[] }
  | { tipo: 'RESOLVER_CONFLICTO'; grupo: GrupoSeleccionado; revision: string };

export function presentarResultado(resultado: ResultadoSeleccionado): AccionPresentacion {
  switch (resultado.__typename) {
    case 'CambioGrupoAplicado':
      return { tipo: 'ACTUALIZAR', grupo: resultado.grupo, revision: resultado.revisionGrupoNueva };
    case 'CambioGrupoRechazado':
      return { tipo: 'MOSTRAR_RECHAZO', errores: resultado.errores, advertencias: resultado.advertencias };
    case 'CambioGrupoConflicto':
      return { tipo: 'RESOLVER_CONFLICTO', grupo: resultado.grupoActual, revision: resultado.revisionGrupoActual };
    default: {
      const casoImposible: never = resultado;
      return casoImposible;
    }
  }
}

export const ejemploAdvertencia: ResultadoSeleccionado = {
  __typename: 'CambioGrupoRechazado', errores: [],
  advertencias: [{ codigo: 'CUPO_MENOR_INSCRITOS', mensaje: 'El cupo solicitado es menor que los inscritos.',
    confirmacion: 'credencial-ilustrativa-no-valida', venceEn: '2026-09-08T18:30:00Z' }]
};
