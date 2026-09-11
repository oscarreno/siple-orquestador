import { Injectable, inject } from '@angular/core';
import { DbService } from './db.service';
import { UsuariosService } from './usuarios.service';
import { AlmacenService } from './almacen.service';
import { MateriasService } from './materias.service';
import { LogService } from './log.service';
import { ORIGEN } from '../models/Origen';
import { Grupo, GrupoHorario, GrupoPlanCompartido, TIPO_MENSAJE } from '../models/Grupo.';
import { Materia } from '../models/Materia';
import { Profesor } from '../models/Profesor';
import { ICatalogoSimple, ITipoProfesor } from '../models/Catalogos';
import { Programa } from '../models/Programa';
import { environment } from 'src/environments/environment';
import Utils from '../utils/utils';

/**
 * GruposDataService
 *
 * Capa especializada de DATOS para grupos.
 * Responsabilidades:
 * - Ejecutar queries GraphQL (Apollo Client)
 * - Gestionar caché de programas y catálogos
 * - Transformar respuestas en modelos de dominio
 *
 * NO contiene:
 * - Lógica de WebSocket (ver GruposSocketService)
 * - Orquestación de operaciones (ver GruposFacadeService)
 */

@Injectable({
    providedIn: 'root'
})
export class GruposDataService {

    // Cache de programas
    private programasAlmacen: Map<string, Programa> = new Map();
    private modificadoresGrupo: IModificadoresGrupo[];

    // Fragment de campos CommonJS usado en todas las queries
    private camposGrupo = `
        origen
        cache
        llaveUnica
        periodo
        cupoGeneral
        idioma
        tipo
        clave
        cupoGeneral
        cupoPrimerIngreso
        cupoReingreso
        cupoComplementario
        liberable
        fijo
        discapacidad
        reportado
        revisado
        letra
        contenido
        alumnosInscritos
        fechaCreacion
        fechaModificacion
        modificadores
        tipoAsistencia {
          clave
          nombre
        }
        exigencia{
          clave
          nombre
        }
        mensajes {
          tipo
          mensaje
        }
        materia {
          origen
          clave
          nombre
          departamento
          creditos
          horasTeoricas
          nivelAcademico
          fechaVigencia
          extraordinario
        }
        materiasAdicionales{
          clave
          nombre
          departamento      
          creditos
          cupoSugerido
          claveMateria
          baseGrupo
          horasTeoricas
          nivelAcademico
          fechaVigencia
          extraordinario
        }
        profesores {
          expediente
          nombre
          userName
          genero
          cache
          foto
          fotoThumb
          fechaNacimiento
          tipo {
            clave
            nombre
            acronimo
          }

        }
        horarios {
          plantilla
          diaSemana
          claveEspacio
          horaInicio
          horaFin
          numDiaSemana
        }`;

    constructor(
        private db: DbService,
        private usuarios: UsuariosService,
        private almacenService: AlmacenService,
        private materiasService: MateriasService,
        private log: LogService
    ) { }

    // ==================  QUERIES GraphQL ==================

    /**
     * GET - Obtener conteo de grupos (REST endpoint legacy)
     */
    async getReporteOfertaCount(
        origen: ORIGEN,
        periodo: string,
        departamento: string
    ): Promise<number> {
        const resp = await fetch(`${environment.backendServer}/gruposCount?origen=${origen}&periodo=${periodo}&departamento=${departamento}`);
        return Number(await resp.json());
    }

    async revisarGrupoPlaneacion(
        periodo: string,
        grupo: string,
        valor: boolean
    ): Promise<boolean> {
        const query = `query ($periodo: String!, $grupo: String!, $valor: Boolean) {
          revisarGrupoPlaneacion(periodo: $periodo, grupo: $grupo, valor: $valor)
        }`;

        try {
            return await this.db.query<boolean>(query, {
                periodo,
                grupo,
                valor
            });
        } catch (error) {
            console.error('Error en revisarGrupoPlaneacion', { periodo, grupo, valor, error });
            throw error;
        }
    }

    /**
     * GET - Obtener conteo de grupos (GraphQL optimizado)
     */
    async getReporteOfertaCountGraphQL(
        origen: ORIGEN,
        periodo: string,
        departamento: string
    ) {
        const query = `query ($origen: String!, $periodo: String!, $departamento: String!) {
        gruposCount(origen: $origen, periodo: $periodo, departamento: $departamento)
      }`;
        const params = {
            origen,
            periodo,
            departamento,
        };

        try {
            const resp = await this.db.query(query, params);
            return resp;
        } catch (error) {
            console.error('Error en getReporteOfertaCountGraphQL', error);
            throw error;
        }
    }

    /**
     * GET - Obtener reporte de oferta de grupos
     */
    async getReporteOferta(
        origen: ORIGEN,
        periodo: string,
        departamento: string,
        forzarLectura = false
    ) {
        const query = `query Grupos ($origen: String!, $periodo: String!, $departamento: String!, $forzarLectura: Boolean) {
      sql:grupos(origen: $origen, periodo: $periodo, departamento: $departamento, forzarLectura: $forzarLectura) {
        ${this.camposGrupo}
      }
    }`;
        const params = {
            origen,
            periodo,
            departamento,
            forzarLectura,
        };

        try {
            const resp = await this.db.query(query, params);
            return resp;
        } catch (error) {
            console.error('Error en getReporteOferta', error);
            throw error;
        }
    }

    /**
     * GET - Obtener grupo específico
     */
    async getGrupo(
        origen: ORIGEN,
        periodo: string,
        clave: string,
        forzarLectura = false,
        integrarMSSQL = false,
    ): Promise<Grupo> {
        const query = `query (
      $origen: String!,
      $periodo: String!,
      $clave: String!,
      $forzarLectura: Boolean,
      $integrarMSSQL: Boolean
    ) {
      sql:grupo(
        origen: $origen,
        periodo: $periodo,
        clave: $clave,
        forzarLectura: $forzarLectura,
        integrarMSSQL: $integrarMSSQL
      ) {
        ${this.camposGrupo}
      }
    }`;

        try {
            return await this.db.query(query, {
                origen,
                periodo,
                clave,
                forzarLectura,
                integrarMSSQL
            });
        } catch (error) {
            console.error('Error en getGrupo', error);
            throw error;
        }
    }

    /**
     * GET - Obtener grupos de una materia específica
     */
    async getGruposMateria(
        origen: ORIGEN,
        periodo: string,
        materia: string,
        soloEncabezado = false,
        forzarLectura = true
    ): Promise<Array<Grupo>> {
        const query = `query GruposMateria ($origen:String!, $periodo: String!, $materia: String!, $soloEncabezado:Boolean, $forzarLectura:Boolean)
    {
      sql:gruposMateria(origen:$origen, periodo:$periodo, materia:$materia, soloEncabezado:$soloEncabezado, forzarLectura:$forzarLectura) {
       ...campos
      }
    }

    fragment campos on Grupo {
      ${this.camposGrupo}
    }`;

        await this.usuarios.getUsuarioConectado();

        const params = {
            origen,
            periodo,
            materia,
            soloEncabezado,
            forzarLectura
        };

        try {
            // this.log.guardarLog({ aplicacion: 'GruposMateria', periodo, materia, origen });
            const resp: Grupo[] = await this.db.query(query, params);
            return resp;
        } catch (error) {
            console.error('Error en getGruposMateria', error);
            throw error;
        }
    }

    /**
     * GET - Obtener conteo de grupos de una materia
     */
    async getGruposMateriaCount(
        origen: ORIGEN,
        periodo: string,
        materia: string
    ) {
        const query = `query ($origen: String!, $periodo: String!, $materia: String!) {
        gruposMateriaCount(origen: $origen, periodo: $periodo, materia: $materia)
      }`;
        const params = {
            origen,
            periodo,
            materia,
        };

        try {
            const resp = Number(await this.db.query(query, params));
            return resp;
        } catch (error) {
            console.error('Error en getGruposMateriaCount', error);
            throw error;
        }
    }

    /**
     * GET - Obtener detalle de alumnos inscritos en grupo
     */
    async getAlumnosInscritosDetalle(
        origen: ORIGEN = ORIGEN.ORACLE,
        periodo: string,
        grupo: string
    ): Promise<Array<IAlumnoInscrito>> {
        const query = `query ($origen: String!, $periodo: String!, $grupo: String!) {
        alumnosInscritos(origen: $origen, periodo: $periodo, grupo: $grupo){
          nombre
          nombremateria
          calificacion
          estatus
          expediente
          programa
          periodo
          grupo
          materia
          creditos
          area
        }
      }`;
        const params = {
            origen,
            periodo,
            grupo,
        };

        try {
            const resp = await this.db.query(query, params);
            return resp;
        } catch (error) {
            console.error('Error en getAlumnosInscritosDetalle', error);
            throw error;
        }
    }

    /**
     * GET - Obtener programa por clave (con caché)
     */
    async getPrograma(
        clave: string,
        forzarLectura?: boolean
    ): Promise<Programa> {
        const claveUnica = clave;

        // Usar caché si está disponible
        if (!forzarLectura && this.programasAlmacen.has(claveUnica))
            return this.programasAlmacen.get(claveUnica);

        const query = `query ($clave: String!) {
      programa(clave: $clave) {
        origen
        clave
        nombre
        nivelEducativo
        claveCarrera
        carrera
        departamento
        activo
      }
    }`;

        try {
            const resp = await this.db.query(query, { clave });
            this.programasAlmacen.set(claveUnica, resp);
            return resp;
        } catch (error) {
            console.error('Error en getPrograma', error);
            throw error;
        }
    }

    /**
     * GET - Obtener lista de programas
     */
    async getProgramas(
        nivelEducativo: string,
        minimoAlumnos?: number
    ): Promise<Array<Programa>> {
        const arr: Programa[] = [];
        const query = `query ( $nivelEducativo: String!, $minimoAlumnos: Int) {
      programas(nivelEducativo: $nivelEducativo,
        minimoAlumnos: $minimoAlumnos) {
          clave
          nombre
          nivelEducativo
          claveCarrera
          carrera
          departamento
          activo
      }
    }`;

        try {
            const data = await this.db.query(query, {
                nivelEducativo,
                minimoAlumnos: minimoAlumnos !== undefined ? minimoAlumnos : null
            });
            for (const e of data) {
                arr.push(new Programa(
                    e.clave ?? '',
                    e.nombre ?? '',
                    e.nivelEducativo ?? '',
                    e.claveCarrera ?? '',
                    e.carrera ?? '',
                    e.departamento ?? '',
                    !!e.activo
                ));
            }
            return arr;
        } catch (error) {
            console.error('Error en getProgramas', error);
            throw error;
        }
    }

    /**
     * GET - Obtener planes compartidos de un grupo
     */
    async getGrupoPlanesCompartidos(
        origen: ORIGEN = ORIGEN.ORACLE,
        periodo: string,
        grupo: string,
        rellenarFaltantes?: boolean
    ): Promise<Array<GrupoPlanCompartido>> {
        const query = `query ($origen: String!, $grupo: String!, $periodo: String!, $rellenarFaltantes: Boolean) {
        grupoPlanesCompartidos(origen: $origen, grupo: $grupo, periodo: $periodo, rellenarFaltantes: $rellenarFaltantes) {
          area
          areaCompleta
          cicloSugerido
          departamento
          programa
          materia
          cupo
        }
      }`;
        try {
            const resp = await this.db.query(query, {
                origen,
                grupo,
                periodo,
                rellenarFaltantes: rellenarFaltantes !== undefined ? rellenarFaltantes : null
            });
            return resp;
        } catch (error) {
            console.error('Error en getGrupoPlanesCompartidos', error);
            throw error;
        }
    }

    /**
     * GET - Obtener profesores de un grupo
     */
    async getProfesoresGrupo(origen: ORIGEN, periodo: string, grupo: string): Promise<Profesor[]> {
        const profes: Profesor[] = [];
        const query = `query ($origen: String!, $periodo: String!, $grupo: String!) {
      grupoProfesores(origen: $origen, periodo: $periodo, grupo: $grupo)
      {
        origen
        expediente
        nombre
        userName
        genero
	        tipo {
	          clave
	          nombre
	          acronimo
	        }
	        foto
	        fotoThumb
	        fechaNacimiento
	        cache
	      }
	    }`;

        try {
            const resp = await this.db.query(query, { origen, periodo, grupo });
            for (const per of resp) {
                const tipo: ITipoProfesor = { clave: per.tipo.clave, nombre: per.tipo.nombre, acronimo: per.tipo.acronimo };
                const p = new Profesor(
                    origen,
                    per.expediente,
                    per.nombre,
                    per.userName,
                    per.genero,
                    tipo,
                    per.foto,
                    per.fotoThumb,
                    per.fechaNacimiento
                );
                profes.push(p);
            }

            return profes;
        } catch (error) {
            console.error('Error en getProfesoresGrupo', error);
            throw error;
        }
    }

    /**
     * GET - Obtener encabezado de reserva grupo X
     */
    async encabezadoReservaGrupoX(idReserva: number): Promise<IInfoGrupoX> {
        const query = `query ($reservaID: Int!) {
      infoGrupoByReservaID(reservaID: $reservaID) {
        grupo_id
        grupo
        clavemateria
        nombremateria
        creditos
        nivelacademico
        departamento
        periodo
      }
    }`;
        try {
            const resp = await this.db.query(query, { reservaID: idReserva }) as IInfoGrupoX;
            return resp;
        } catch (error) {
            console.error('Error en encabezadoReservaGrupoX', error);
            throw error;
        }
    }

    /**
     * GET - Obtener detalle de reserva grupo X
     */
    async detalleReservaGrupoX(idGrupo: number): Promise<Array<GrupoHorario>> {
        const query = `query ($idGrupo: Int!) {
      detalleReservaGrupoX(idGrupo: $idGrupo) {
        plantilla
        numDiaSemana
        diaSemana
        claveEspacio
        horaInicio
        horaFin
      }
    }`;
        try {
            const resp = await this.db.query(query, { idGrupo }) as GrupoHorario[];
            return resp;
        } catch (error) {
            console.error('Error en detalleReservaGrupoX', error);
            throw error;
        }
    }

    /**
     * GET - Obtener catálogo de modificadores de grupo
     */
    async getModificadoresGrupoTodos(): Promise<IModificadoresGrupo[]> {
        if (this.modificadoresGrupo)
            return this.modificadoresGrupo;

        const query = `
      query {
        modificadoresGrupo{
          clave
          nombre
          descripcion
        }
      }`;

        try {
            const resp = await this.db.query(query);
            this.modificadoresGrupo = resp;
            return resp;
        } catch (error) {
            console.error('Error en getModificadoresGrupoTodos', error);
            throw error;
        }
    }

    // ==================  MUTATIONS GraphQL ==================

    /**
     * SAVE - Guardar grupo completo (encabezado, horarios, planes, mensajes)
     */
    async guardarGrupoDBO(
        grupo: Grupo,
        cambiosBitacora?: iCambioRealizado[]
    ): Promise<Grupo> {
        // Una respuesta fallida no demuestra rollback. Nunca iniciar otra escritura.
        const grupoGuardado = await this.guardarGrupoUnificado(grupo, cambiosBitacora);
        if (!grupoGuardado) {
            throw new Error('No se pudo confirmar el resultado del guardado.');
        }
        return this.normalizarGrupoGuardado(grupo, grupoGuardado);
    }

    private async guardarGrupoLegacy(
        grupo: Grupo,
        cambiosBitacora?: iCambioRealizado[]
    ): Promise<Grupo> {
        if (grupo.origen === ORIGEN.MSSQL) {
            await this.guardarGrupoMSSQL(grupo);
            await this.registrarCambiosBitacora(grupo, cambiosBitacora);
        }
        else {
            const encabezado: IEncabezadoGrupoOracle = {
                periodo: grupo.periodo,
                grupo: grupo.clave,
                periodoEscolarID: 0,
                cupo: grupo.cupoGeneral,
                cupoPrimerIngreso: grupo.cupoPrimerIngreso,
                cupoReingreso: grupo.cupoReingreso,
                cupoAC: grupo.cupoComplementario,
                cupoMax: 999,
                idioma: grupo.idioma,
                liberable: grupo.liberable,
                tipoGrupo: grupo.tipo,
                bloqueadoPorDSE: grupo.deshabilitado,
                tipoAsistenciaID: grupo.tipoAsistencia.clave,
                contenido: grupo.contenido,
                areaGrupo: '',
                grupoPadreID: 0,
                nivelExigenciaID: grupo.exigencia.clave,
                tipoGrupoID: '1',
                areaTrabajoID: grupo.materia.departamento
            };

            const grupoId = await this.guardarEncabezadoOracle(encabezado);

            // Guardar horarios
            grupo.getHorariosString();
            if (grupo.horarios)
                for (const gh of grupo.horarios) {
                    await this.guardarHorarioDBO(grupoId, grupo.periodo, gh);
                }

            // Guardar planes de estudio
            if (grupo.planesCompartidos)
                for (const gpc of grupo.planesCompartidos) {
                    if (gpc.cupo >= 0)
                        await this.guardarGrupoPlanDBO(grupoId, gpc.materia || grupo.materia.clave, gpc.programa, gpc.cupo);
                }

            // Guardar mensajes
            if (grupo.mensajes)
                for (const m of grupo.mensajes) {
                    await this.guardarMensajeGrupoDBO(grupoId, m.tipo, m.mensaje);
                }

            // Guardar cambios en bitácora
            await this.registrarCambiosBitacora(grupo, cambiosBitacora);
        }

        const grupoGuardado = await this.getGrupo(
            grupo.origen,
            grupo.periodo,
            grupo.clave,
            true,
            true
        );

        return this.normalizarGrupoGuardado(grupo, grupoGuardado);
    }

    private async guardarGrupoUnificado(
        grupo: Grupo,
        cambiosBitacora?: iCambioRealizado[]
    ): Promise<Grupo> {
        const grupoInput = this.construirGrupoInput(grupo);
        const cambios = this.construirCambiosBitacoraInput(cambiosBitacora);
        const query = `mutation (
      $origen: String!,
      $grupo: GrupoInput!,
      $cambiosBitacora: [CambioRealizadoInput!]
    ) {
      sql:guardarGrupo(
        origen: $origen,
        grupo: $grupo,
        cambiosBitacora: $cambiosBitacora
      ) {
        ${this.camposGrupo}
      }
    }`;

        try {
            return await this.db.mutation<Grupo>(query, {
                origen: grupo.origen,
                grupo: grupoInput,
                cambiosBitacora: cambios
            });
        } catch (error) {
            console.error('Error en guardarGrupo unificado', error);
            throw error;
        }
    }

    private async guardarGrupoMSSQL(grupo: Grupo): Promise<boolean> {
        const grupoInput = this.construirGrupoInput(grupo);
        let query = `query ($grupo: GrupoInput!) {
        guardarGrupoMSSQL(
          grupo: $grupo
        )}`;

        try {
            let resp = await this.db.query(query, {
                grupo: grupoInput
            });
            if (resp === null || resp === undefined) {
                return false;
            }
            let planes = grupo.planesCompartidos;
            if (planes)
                for (let i = 0; i < planes.length; i++) {
                    const cupo = planes[i].cupo;
                    const materia = planes[i].materia;
                    const programa = planes[i].programa;
                    const periodo = grupoInput.periodo;

                    query = `query ($periodo: String!, $grupo: String!, $programa: String!, $materia: String!, $cupo: Int!) {
                        guardarPlanCompartidoMSSQL(
                            periodo: $periodo
                            grupo: $grupo
                            programa: $programa
                            materia: $materia
                            cupo: $cupo
                        )
                    }`;
                    let resp = await this.db.query(query, {
                        grupo: grupoInput.clave,
                        cupo,
                        materia,
                        programa,
                        periodo,
                    });

                }
            return resp;
        } catch (error) {
            console.error('Error en guardarGrupoMSSQL', error);
            throw error;
        }
    }

    private async guardarGrupoPlanCompartidoMSSQL(
        grupo: Grupo
    ): Promise<boolean> {
        const grupoInput = this.construirGrupoInput(grupo);
        const query = `query ($grupo: GrupoInput!) {
        guardarGrupoMSSQL(
          grupo: $grupo
        )
      }`;
        try {
            const resp = await this.db.query(query, {
                grupo: grupoInput
            });
            return resp;
        } catch (error) {
            console.error('Error en guardarGrupoMSSQL', error);
            throw error;
        }
    }


    private construirGrupoInput(grupo: Grupo): GrupoInput {
        return {
            llaveUnica: grupo.llaveUnica,
            periodo: grupo.periodo,
            clave: grupo.clave,
            origen: grupo.origen,
            tipo: grupo.tipo,
            idioma: grupo.idioma,
            cupoGeneral: grupo.cupoGeneral,
            cupoPrimerIngreso: grupo.cupoPrimerIngreso,
            cupoReingreso: grupo.cupoReingreso,
            cupoComplementario: grupo.cupoComplementario,
            alumnosInscritos: grupo.alumnosInscritos,
            cupoMaximo: grupo.cupoMaximo,
            exportable: grupo.exportable,
            liberable: grupo.liberable,
            fijo: grupo.fijo,
            reportado: grupo.reportado,
            exportado: grupo.exportado,
            esGrupoPrimerIngreso: grupo.esGrupoPrimerIngreso,
            discapacidad: grupo.discapacidad,
            revisado: grupo.revisado,
            letra: grupo.letra,
            contenido: grupo.contenido,
            fechaCreacion: this.serializarFecha(grupo.fechaCreacion),
            fechaModificacion: this.serializarFecha(grupo.fechaModificacion),
            mensajes: grupo.mensajes?.map((mensaje) => ({
                tipo: mensaje.tipo,
                mensaje: mensaje.tipo === TIPO_MENSAJE.TIPO_POPUP
                    ? Utils.codificarPopupHtmlParaEnvio(mensaje.mensaje)
                    : mensaje.mensaje
            })),
            planesCompartidos: grupo.planesCompartidos?.map((plan) => ({
                origen: plan.origen,
                grupo: plan.grupo,
                periodo: plan.periodo,
                programa: plan.programa,
                materia: this.serializarMateriaPlanCompartido(plan.materia),
                cupo: plan.cupo
            })),
            materia: this.construirMateriaInput(grupo.materia),
            materiasAdicionales: grupo.materiasAdicionales?.map((materia) => this.construirMateriaInput(materia)),
            profesores: grupo.profesores?.map((profesor) => this.construirProfesorInput(profesor)),
            revisadoPor: grupo.revisadoPor ? [...grupo.revisadoPor] : undefined,
            horarios: grupo.horarios?.map((horario) => ({
                plantilla: horario.plantilla,
                numDiaSemana: horario.numDiaSemana,
                diaSemana: horario.diaSemana,
                claveEspacio: horario.claveEspacio,
                horaInicio: horario.horaInicio,
                horaFin: horario.horaFin
            })),
            tipoAsistencia: this.construirCatalogoSimpleInput(grupo.tipoAsistencia),
            exigencia: this.construirCatalogoSimpleInput(grupo.exigencia),
            modificadores: grupo.modificadores
        };
    }

    private normalizarGrupoGuardado(
        grupoOriginal: Grupo,
        grupoGuardado: Grupo
    ): Grupo {
        if (grupoGuardado.materia?.clave) {
            return grupoGuardado;
        }

        const grupoNormalizado = this.getGrupoCopia(grupoGuardado);
        grupoNormalizado.materia = grupoOriginal.materia;

        console.warn('El backend devolvio un grupo sin materia despues de guardar; se conserva la materia original en frontend.', {
            origen: grupoOriginal.origen,
            periodo: grupoOriginal.periodo,
            grupo: grupoOriginal.clave,
            materiaOriginal: grupoOriginal.materia?.clave
        });

        return grupoNormalizado;
    }

    private construirMateriaInput(materia?: Materia | null): MateriaInput | undefined {
        if (!materia) {
            return undefined;
        }

        return {
            clave: materia.clave,
            origen: materia.origen,
            nombre: materia.nombre,
            departamento: materia.departamento,
            creditos: materia.creditos,
            cupoSugerido: materia.cupoSugerido,
            claveMateria: materia.claveMateria,
            baseGrupo: materia.baseGrupo,
            horasTeoricas: materia.horasTeoricas,
            nivelAcademico: materia.nivelAcademico,
            fechaVigencia: materia.fechaVigencia,
            cache: materia.cache,
            extraordinario: materia.extraordinario
        };
    }

    private construirProfesorInput(profesor: Profesor): ProfesorInput {
        return {
            expediente: profesor.expediente,
            origen: profesor.origen,
            nombre: profesor.nombre,
            userName: profesor.userName,
            genero: profesor.genero,
            tipo: profesor.tipo ? {
                clave: profesor.tipo.clave,
                nombre: profesor.tipo.nombre,
                acronimo: profesor.tipo.acronimo
            } : undefined,
            foto: profesor.foto,
            fotoThumb: profesor.fotoThumb,
            fechaNacimiento: profesor.fechaNacimiento
        };
    }

    private construirCatalogoSimpleInput(catalogo?: ICatalogoSimple | null): CatalogoSimpleInput | undefined {
        if (!catalogo) {
            return undefined;
        }

        return {
            clave: catalogo.clave,
            nombre: catalogo.nombre
        };
    }

    private serializarFecha(fecha?: Date | string): string | undefined {
        if (!fecha) {
            return undefined;
        }

        return fecha instanceof Date ? fecha.toISOString() : fecha;
    }

    private serializarMateriaPlanCompartido(materia?: string | null): number | string | undefined {
        if (materia === null || materia === undefined) {
            return undefined;
        }

        const materiaNormalizada = String(materia).trim();
        if (/^\d+$/.test(materiaNormalizada)) {
            return Number(materiaNormalizada);
        }

        return materiaNormalizada;
    }

    private construirCambiosBitacoraInput(
        cambiosBitacora?: iCambioRealizado[]
    ): CambioRealizadoInput[] | undefined {
        if (!cambiosBitacora?.length) {
            return undefined;
        }

        return cambiosBitacora.map((cambio) => {
            const { valorAnterior, valorNuevo } = this.obtenerValoresBitacora(cambio);

            return {
                cambio: cambio.cambio,
                campo: cambio.campo,
                valorAnterior,
                valorNuevo
            };
        });
    }

    private debeUsarGuardadoLegacy(error: unknown): boolean {
        const mensaje = this.obtenerMensajeError(error).toLowerCase();

        return mensaje.includes('cannot query field "guardagrupo"')
            || mensaje.includes('schema is not configured to execute mutation')
            || mensaje.includes('unknown type "grupoinput"')
            || mensaje.includes('unknown type "cambiorealizadoinput"')
            || mensaje.includes('unknown argument "cambiosbitacora"')
            || mensaje.includes('unknown argument "origen"')
            || mensaje.includes('field "guardagrupo" argument')
            || mensaje.includes('field "planescompartidos" is not defined by type "grupoinput"')
            || (mensaje.includes('grupoinput') && mensaje.includes('planescompartidos'))
            || mensaje.includes('respuesta graphql sin datos');
    }

    private obtenerMensajeError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }

        if (typeof error === 'string') {
            return error;
        }

        try {
            return JSON.stringify(error);
        } catch {
            return '';
        }
    }

    private async registrarCambiosBitacora(
        grupo: Grupo,
        cambiosBitacora?: iCambioRealizado[]
    ): Promise<void> {
        if (!cambiosBitacora?.length) {
            return;
        }

        for (const cambio of cambiosBitacora) {
            const campo = cambio.campo ?? '';
            const { valorAnterior, valorNuevo } = this.obtenerValoresBitacora(cambio);

            await this.log.guardarBitacora(
                grupo.origen,
                grupo.clave,
                grupo.periodo,
                cambio.cambio,
                campo,
                valorAnterior,
                valorNuevo
            );
        }
    }

    private obtenerValoresBitacora(cambio: iCambioRealizado): { valorAnterior: string, valorNuevo: string } {
        if (cambio.stringAnterior !== undefined) {
            return {
                valorAnterior: cambio.stringAnterior,
                valorNuevo: cambio.stringNuevo ?? ''
            };
        }

        if (cambio.numeroAnterior !== undefined) {
            return {
                valorAnterior: cambio.numeroAnterior.toString(),
                valorNuevo: cambio.numeroNuevo?.toString() ?? ''
            };
        }

        if (cambio.booleanAnterior !== undefined) {
            return {
                valorAnterior: cambio.booleanAnterior ? 'Si' : 'No',
                valorNuevo: cambio.booleanNuevo ? 'Si' : 'No'
            };
        }

        return {
            valorAnterior: '',
            valorNuevo: ''
        };
    }


    /**
     * PRIVATE - Guardar encabezado del grupo en Oracle
     */
    private async guardarEncabezadoOracle(
        encabezado: IEncabezadoGrupoOracle
    ): Promise<number> {

        const query = `query ($periodo: String!, $claveGrupo: String!, $cupo: Int!, $cupoPrimerIngreso: Int!, $cupoReingreso: Int!, $cupoAC: Int!, $idioma: String!, $liberable: Boolean!, $bloqueadoPorDSE: Boolean!, $contenido: String!, $areaTrabajo: String!) {
      guardarEncabezadoGrupoDBO(
      periodo: $periodo
      claveGrupo: $claveGrupo
      cupo: $cupo
      cupoPrimerIngreso: $cupoPrimerIngreso
      cupoReingreso: $cupoReingreso
      cupoAC: $cupoAC
      idioma: $idioma
      liberable: $liberable
      bloqueadoPorDSE: $bloqueadoPorDSE
      contenido: $contenido
      areaTrabajo: $areaTrabajo
      )
    }`;

        try {
            const resp = await this.db.query(query, {
                periodo: encabezado.periodo,
                claveGrupo: encabezado.grupo,
                cupo: encabezado.cupo,
                cupoPrimerIngreso: encabezado.cupoPrimerIngreso,
                cupoReingreso: encabezado.cupoReingreso,
                cupoAC: encabezado.cupoAC,
                idioma: encabezado.idioma,
                liberable: encabezado.liberable,
                bloqueadoPorDSE: encabezado.bloqueadoPorDSE,
                contenido: encabezado.contenido,
                areaTrabajo: encabezado.areaTrabajoID
            });
            return resp;
        } catch (error) {
            console.error('Error en guardarEncabezadoOracle', error);
            throw error;
        }
    }

    /**
     * PRIVATE - Guardar horario del grupo
     */
    private async guardarHorarioDBO(
        grupoId: number,
        periodo: string,
        horario?: GrupoHorario
    ): Promise<boolean> {

        const query = `query ($grupoId: Int!, $periodo: String!, $diaSemana: Int!, $espacio: String!, $horaInicio: String!, $horaFin: String!, $plantilla: String!) {
          guardarHorarioGrupoDBO(
            grupoId: $grupoId
            periodo: $periodo
            diaSemana: $diaSemana
            espacio: $espacio
            horaInicio: $horaInicio
            horaFin: $horaFin
            plantilla: $plantilla
          )
      }`;

        try {
            const resp = await this.db.query(query, {
                grupoId,
                periodo,
                diaSemana: horario.numDiaSemana,
                espacio: horario.claveEspacio,
                horaInicio: horario.horaInicio,
                horaFin: horario.horaFin,
                plantilla: horario.plantilla
            });
            return resp;
        } catch (error) {
            console.error('Error en guardarHorarioDBO', {
                grupoId,
                periodo,
                horario,
                error
            });
            throw error;
        }
    }



    /**
     * PRIVATE - Guardar plan compartido del grupo
     */
    private async guardarGrupoPlanDBO(
        grupoId: number,
        materia: string,
        programa: string,
        cupo: number
    ): Promise<boolean> {

        const materiaId = Number(materia);

        if (!Number.isInteger(materiaId)) {
            throw new Error(`No se pudo guardar el plan compartido: materiaId invalido "${materia}"`);
        }

        const query = `query ($grupoId: Int!, $materiaId: Int!, $programa: String!, $cupo: Int!) {
        guardarPlanCompartidoGrupoDBO(
          grupoId: $grupoId
          materiaId: $materiaId
          programa: $programa
          cupo: $cupo
          )
      }`;

        try {
            const resp = await this.db.query(query, {
                grupoId,
                materiaId,
                programa,
                cupo
            });
            return resp;
        } catch (error) {
            console.error('Error en guardarGrupoPlanDBO', {
                grupoId,
                materia,
                materiaId,
                programa,
                cupo,
                error
            });
            throw error;
        }
    }

    /**
     * PRIVATE - Guardar mensaje del grupo
     */
    private async guardarMensajeGrupoDBO(
        grupoId: number,
        tipo: TIPO_MENSAJE,
        mensaje: string
    ): Promise<boolean> {

        const mensajeOriginalEraNulo = mensaje == null;
        const mensajeNormalizado = mensaje ?? '';

        if (!this.tieneContenidoMensaje(tipo, mensajeNormalizado)) {
            return true;
        }

        if (tipo === TIPO_MENSAJE.TIPO_POPUP) {
            mensaje = this.codificarBase64Utf8(mensajeNormalizado);
        } else {
            mensaje = mensajeNormalizado;
        }

        const query = `query ($grupoId: Int!, $tipo: String!, $mensaje: String!) {
        guardarMensajeGrupoDBO(
          grupoId: $grupoId
          tipo: $tipo
          mensaje: $mensaje
          )
      }`;

        try {
            const resp = await this.db.query(query, {
                grupoId,
                tipo,
                mensaje
            });
            return resp;
        } catch (error) {
            console.error('Error en guardarMensajeGrupoDBO', {
                grupoId,
                tipo,
                mensajeEraNulo: mensajeOriginalEraNulo,
                mensajeLength: mensaje.length,
                error
            });
            throw error;
        }
    }

    private codificarBase64Utf8(texto: string): string {
        const bytes = new TextEncoder().encode(texto);
        const chunkSize = 0x8000;
        let binario = '';

        // Evita desbordar el stack al convertir mensajes largos.
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binario += String.fromCharCode(...chunk);
        }

        return btoa(binario);
    }

    private tieneContenidoMensaje(tipo: TIPO_MENSAJE, mensaje: string): boolean {
        if (tipo === TIPO_MENSAJE.TIPO_POPUP) {
            return mensaje.replace(/<[^>]*>/g, '').trim().length > 0;
        }

        return mensaje.trim().length > 0;
    }

    // ==================  UTILITIES ==================

    /**
     * Obtener lista de materias de un grupo (materia + adicionales)
     */
    public getMateriasGrupo(grupo: Grupo): Array<Materia> {
        const arr: Array<Materia> = [];
        if (grupo.materia)
            arr.push(grupo.materia);
        for (const materia of grupo.materiasAdicionales ?? []) {
            arr.push(materia);
        }
        return arr;
    }

    /**
     * Crear una instancia vacía de Grupo
     */
    getGrupoVacio(): Grupo {
        return new Grupo(
            ORIGEN.MSSQL,
            '',
            '',
            '',
            this.materiasService.getMateriaVacia(),
            '',
            'Español',
            0,
            0,
            0,
            0,
            0,
            0,
            false,
            true,
            true,
            false,
            false,
            false,
            false,
            '',
            null,
            null,
            []
        );
    }

    /**
     * Crear una copia (clone) de un grupo
     */
    getGrupoCopia(grupo: Grupo): Grupo {
        const g2 = new Grupo(
            grupo.origen,
            grupo.llaveUnica,
            grupo.periodo,
            grupo.clave,
            grupo.materia,
            grupo.tipo,
            grupo.idioma,
            grupo.cupoGeneral,
            grupo.cupoPrimerIngreso,
            grupo.cupoReingreso,
            grupo.cupoComplementario,
            grupo.alumnosInscritos,
            grupo.cupoMaximo,
            grupo.exportable,
            grupo.liberable,
            grupo.fijo,
            grupo.reportado,
            grupo.exportado,
            grupo.esGrupoPrimerIngreso,
            grupo.discapacidad,
            grupo.revisado,
            grupo.exigencia,
            grupo.tipoAsistencia,
            grupo.profesores,
            grupo.materiasAdicionales,
            grupo.contenido,
            grupo.fechaCreacion,
            grupo.fechaModificacion,
            grupo.horarios,
            grupo.revisadoPor,
            grupo.letra,
            grupo.mensajes,
            grupo.planesCompartidos,
            grupo.modificadores
        );
        return g2;
    }

    /**
     * CALC - Calcular demanda general de un grupo (materia + adicionales)
     */
    async getDemandaGeneralGrupo(grupo: Grupo): Promise<number> {
        let dem = -999;
        if (grupo.materia) {
            dem = await this.materiasService.getMateriaDemanda(grupo.materia.clave, grupo.periodo);

            for (const mat of grupo.materiasAdicionales ?? []) {
                const dem2 = await this.materiasService.getMateriaDemanda(mat.clave, grupo.periodo);
                dem += dem2;
            }
        }
        return dem;
    }

    /**
     * CALC - Calcular demanda de una materia
     */
    async getDemandaGeneral(periodo: string, materia: string): Promise<number> {
        return await this.materiasService.getMateriaDemanda(materia, periodo);
    }
}

// ==================  INTERFACES ==================

export interface IAlumnosInscritos {
    grupo: string,
    periodo: string,
    alumnosInscritos: number
}

export interface IAlumnoInscrito {
    expediente: string,
    nombre: string,
    programa: string,
    grupo: string,
    periodo: string,
    materia: number,
    nombremateria: string,
    calificacion: number,
    estatus: number,
    creditos: number,
    area: string
}

export interface IEncabezadoGrupoOracle {
    periodo: string,
    grupo: string,
    periodoEscolarID: number,
    cupo: number,
    cupoPrimerIngreso: number,
    cupoReingreso: number,
    cupoAC: number,
    cupoMax: number,
    idioma: string,
    liberable: boolean,
    tipoGrupo: string,
    bloqueadoPorDSE: boolean,
    tipoAsistenciaID: string,
    contenido: string,
    areaGrupo: string,
    grupoPadreID: number,
    nivelExigenciaID: string,
    tipoGrupoID: string,
    areaTrabajoID: string,
}

interface CatalogoSimpleInput {
    clave?: string;
    nombre?: string;
}

interface TipoProfesorInput extends CatalogoSimpleInput {
    acronimo?: string;
}

interface ProfesorInput {
    expediente?: string;
    origen?: string;
    nombre?: string;
    userName?: string;
    genero?: string;
    tipo?: TipoProfesorInput;
    foto?: string;
    fotoThumb?: string;
    fechaNacimiento?: string;
    fechaIngreso?: string;
    cache?: boolean;
}

interface MateriaInput {
    clave?: string;
    origen?: string;
    nombre?: string;
    departamento?: string;
    creditos?: number;
    cupoSugerido?: number;
    claveMateria?: string;
    baseGrupo?: string;
    horasTeoricas?: number;
    nivelAcademico?: string;
    informacion?: string;
    fechaVigencia?: string;
    cache?: boolean;
    extraordinario?: number;
}

interface MensajeGrupoInput {
    tipo?: string;
    mensaje?: string;
}

interface PlanCompartidoInput {
    origen?: string;
    grupo?: string;
    periodo?: string;
    programa?: string;
    materia?: string | number;
    cupo?: number;
}

interface GrupoHorarioInput {
    plantilla?: string;
    numDiaSemana?: number;
    diaSemana?: string;
    claveEspacio?: string;
    horaInicio?: string;
    horaFin?: string;
}

interface GrupoInput {
    llaveUnica?: string;
    periodo?: string;
    clave?: string;
    origen?: string;
    tipo?: string;
    idioma?: string;
    cupoGeneral?: number;
    cupoPrimerIngreso?: number;
    cupoReingreso?: number;
    cupoComplementario?: number;
    alumnosInscritos?: number;
    cupoMaximo?: number;
    exportable?: boolean;
    liberable?: boolean;
    fijo?: boolean;
    reportado?: boolean;
    exportado?: boolean;
    esGrupoPrimerIngreso?: boolean;
    discapacidad?: boolean;
    revisado?: string;
    letra?: string;
    contenido?: string;
    fechaCreacion?: string;
    fechaModificacion?: string;
    mensajes?: MensajeGrupoInput[];
    planesCompartidos?: PlanCompartidoInput[];
    materia?: MateriaInput;
    materiasAdicionales?: MateriaInput[];
    profesores?: ProfesorInput[];
    revisadoPor?: string[];
    horarios?: GrupoHorarioInput[];
    tipoAsistencia?: CatalogoSimpleInput;
    exigencia?: CatalogoSimpleInput;
    cache?: boolean;
    modificadores?: string;
}

interface CambioRealizadoInput {
    cambio: string;
    campo?: string;
    valorAnterior?: string;
    valorNuevo?: string;
}

export interface GrupoPlanCompartidoExt {
    origen: ORIGEN,
    grupo: string,
    periodo: string,
    programa: string,
    materia: string,
    cupo: number,
    inscritos?: number,
    area: string,
    areaCompleta: string,
    cicloSugerido: number,
    departamento: string,
    nombrePrograma?: string,
    clase: string,
}

export interface IModificadoresGrupo {
    clave: string,
    nombre: string,
    descripcion: string
}

export interface IInfoGrupoX {
    grupo_id: number,
    grupo: string,
    clavemateria: string,
    nombremateria: string,
    creditos: number,
    nivelacademico: string,
    departamento: string,
    periodo: string
}

export interface iCambioRealizado {
    cambio: string,
    campo?: string,
    stringAnterior?: string,
    stringNuevo?: string,
    numeroAnterior?: number,
    numeroNuevo?: number,
    booleanAnterior?: boolean,
    booleanNuevo?: boolean
}
