import { Profesores } from './Profesores';
import { AlumnoInscrito } from "../modelos/Alumno";
import { Grupo, GrupoHorario, ModificadoresGrupo, TIPO_MENSAJE, TIPO_MENSAJE_INT } from "../modelos/Grupo";
import Almacen from "../system/cache";
import db, { ORIGEN } from "../system/database";
import oracle, { IParametro } from "../system/oracle";
import Utils, { CONSOLA } from "../system/utils";
import Catalogos from "./Catalogos";
import construyeGrupo from "./Grupos.build";
import { Materias } from "./Materias";
import { Plantillas } from "./Plantillas";
import { Programas } from "./Programas";
import JWT from '../system/jwt';
import UtilsFechas from '../system/utilsFechas';
import oracledb from "../system/oracledbCompat";
import { Log } from './Log';
//import date from 'date-and-time';
//import es from 'date-and-time/locale/es';
import { Usuario } from '../modelos/Usuario';

export class Grupos {
  private static instancia: Grupos;
  private modificadoresGrupo: ModificadoresGrupo[] | undefined;

  private constructor() { }

  public getLLaveGrupo(periodo: string, clave: string): string {
    return `${periodo.trim()}|${clave.trim()}`;
  }

  public async getGrupo(origen: ORIGEN, periodo: string, clave: string, forzarLectura = false, integrarMSSQL = false): Promise<Grupo | null> {
    try {
      if (!periodo || !clave)
        return null;

      periodo = periodo.trim();
      clave = clave.trim();
      let llaveUnica = this.getLLaveGrupo(periodo, clave);


      if (!forzarLectura) {
        const valor = <Grupo | undefined>Almacen.getInstancia().getCache(origen, llaveUnica, "Grupo");
        if (valor !== undefined) return valor;
      }


      let grupo = await construyeGrupo(origen, periodo, clave, integrarMSSQL);
      if (grupo) {
        // TODO : Damos de baja temporal el almacén de grupos. A ver qué tal
        Almacen.getInstancia().setCache(origen, grupo.llaveUnica, "Grupo", grupo);
        return grupo;
      }
      //Utils.Mensaje(CONSOLA.ERROR_SIN_TRACE, `No se construyó el grupo ${clave} (${periodo}) | Origen: ${origen == ORIGEN.MSSQL ? "MSSQL" : "ORACLE"} | ¿No existe?`);
      return null;
    } catch (error) {
      Utils.Mensaje(CONSOLA.ERROR_SIN_TRACE, error);
      throw error;
    }
  }

  public async existeGrupo(origen: ORIGEN, periodo: string, clave: string): Promise<Grupo | null> {
    try {
      let g = this.getGrupo(origen, periodo, clave);
      return g;
    } catch (error) {
      return null;
    }
  }

  public async getGruposCount(origen: ORIGEN, periodo: string, departamento: string): Promise<number> {
    let query = "";
    let data: any;
    let numeroGrupos = 0;

    departamento = departamento.toUpperCase();

    try {
      if (origen === ORIGEN.MSSQL) {
        query = `SELECT count(G.Clave) grupos from Grupo G, Materia M
        WHERE Periodo = '${periodo}'
        AND G.Materia = M.Clave AND G.Clave IS NOT NULL AND G.Clave <> '' `;
        if (departamento) {
          if (departamento === 'PAP')
            query += "AND G.Clave LIKE 'PAP%' ";
          else
            query += `AND M.Departamento = '${departamento}' AND G.Clave NOT LIKE 'PAP%'  `;
        }

        data = await db.getInstancia().querySimpleArray(query);
      } else {
        let perOra = (await Catalogos.getInstancia().getPeriodo(periodo)).periodooracle;

        query = `SELECT count(distinct(codigo)) FROM S_GRUPO G, S_GRUPOMATEAREAPLAN M
        WHERE G.ID = M.GRUPO_ID
        AND G.PeriodoEscolar_ID = ${perOra}
        AND CODIGO NOT IN ('VIEJO', 'REVALI') `;

        if (departamento) {
          if (departamento === 'PAP')
            query += "AND G.Codigo LIKE 'PAP%' ";
          else
            query += `AND G.Codigo NOT LIKE 'PAP%' AND G.AREATRABAJO_ID IN (SELECT ID FROM S_AREATRABAJO WHERE CODIGO = '${departamento}')`;
        }

        data = await oracle.getInstancia().querySimpleArray(query);
      }
      //console.log('Grupos:', data);

      numeroGrupos = new Number(data[0]).valueOf();

      return numeroGrupos;
    } catch (error) {
      throw error;
    }

  }

  public async getAlumnosInscritos(origen: ORIGEN, periodo: string, grupo: string): Promise<Array<AlumnoInscrito>> {
    let query = "";
    let data;
    //let alumnos: Array<AlumnoInscrito> = [];

    grupo = grupo.toUpperCase();

    try {
      if (origen === ORIGEN.MSSQL) {
        query = `SELECT periodo, grupo, H.expediente, programa, materia, H.creditos, H.area, calificacion, 
        H.estatus, M.nombre as nombreMateria, A.nombre
        FROM AlumnoHistoria H, Materia M, Alumno A
        WHERE H.Periodo = '${periodo}' AND H.Grupo = '${grupo}'
        AND H.Expediente = A.Expediente
        AND H.Materia = M.Clave
        ORDER BY M.Nombre, M.Clave, A.Nombre`;

        data = await db.getInstancia().queryTabla(query);
      } else {
        //let perOra = Catalogos.getInstancia().getPeriodo(periodo);

        query = `SELECT periodo, grupo, H.expediente, programa, materia, H.creditos, H.area, calificacion, 
        H.estatus, M.nombre as nombremateria, A.nombre
        FROM ORACLEDBA.V_SIPF1_ALUMNOHISTORIA H, ORACLEDBA.V_SIPF1_MATERIA M, ORACLEDBA.V_SIPF1_ALUMNO A
        WHERE H.PERIODO = '${periodo}' AND H.GRUPO = '${grupo}'
        AND H.Expediente = A.Expediente
        AND H.Materia = M.Clave
        ORDER BY M.Nombre, M.Clave, A.Nombre`;

        data = await oracle.getInstancia().queryTabla(query);
      }
      //console.log('Grupos:', data);

      return data;
    } catch (error) {
      throw error;
    }

  }

  public async getGruposMateriaCount(origen: ORIGEN, periodo: string, materia: string): Promise<number> {
    let query = "";
    let data: any;
    let numeroGrupos = 0;

    try {
      if (origen === ORIGEN.MSSQL) {
        query = `SELECT count(G.Clave) grupos from Grupo G
        WHERE Periodo = '${periodo}'
        AND G.Materia = '${materia}' `;
        data = await db.getInstancia().querySimpleArray(query);
      } else {
        let perOra = (await Catalogos.getInstancia().getPeriodo(periodo)).periodooracle;

        query = `SELECT count(distinct(G.codigo)) FROM S_GRUPO G, S_GRUPOMATEAREAPLAN M, S_MATEAREAPLAN A
        WHERE G.ID = M.GRUPO_ID
        AND M.MATEAREAPLAN_ID = A.ID
        AND G.PeriodoEscolar_ID = ${perOra}
        AND A.Materia_ID = ${materia}
        AND G.CODIGO NOT IN ('VIEJO', 'REVALI')`;
        data = await oracle.getInstancia().querySimpleArray(query);
      }
      //console.log('Grupos:', data);

      numeroGrupos = new Number(data[0]).valueOf();

      return numeroGrupos;
    } catch (error) {
      throw error;
    }

  }

  public async getGruposEnEspacio(origen: ORIGEN, periodo: string, espacio: string): Promise<string[]> {
    let query = "";
    let data: string[] = [];

    try {
      if (origen === ORIGEN.MSSQL) {
        query = `Select DISTINCT(Grupo) from GrupoHorario WHERE Periodo = '${periodo}' AND Espacio = '${espacio}' `;
        data = await db.getInstancia().querySimpleArray(query);
      } else {
        query = `Select DISTINCT(Grupo) from ORACLEDBA.V_SIPF1_GrupoHorario WHERE Periodo = '${periodo}' AND Espacio = '${espacio}' `;

        data = await oracle.getInstancia().querySimpleArray(query);
      }
      return data;
    } catch (error) {
      throw error;
    }

  }

  public async getGruposProfesor(profesor: string, periodo: string): Promise<string[]> {
    let query = "";
    let data: string[] = [];

    try {
      query = `Select DISTINCT(Grupo) FROM ORACLEDBA.V_SIPF1_GRUPOPROFESOR WHERE Periodo = '${periodo}' AND PROFESOR = '${profesor}'`;

      data = await oracle.getInstancia().querySimpleArray(query);
      return data;
    } catch (error) {
      throw error;
    }

  }

  public async getListaGrupos(origen: ORIGEN, periodo: string, departamento: string | undefined, desde = -1, hasta = -1): Promise<Array<string>> {
    let query = "";
    let data: string[] = [];

    try {
      if (origen === ORIGEN.MSSQL) {
        query = `SELECT G.Clave grupo from Grupo G, Materia M
        WHERE Periodo = '${periodo}'
        AND G.Materia = M.Clave AND G.Clave IS NOT NULL AND G.Clave <> '' `;
        if (departamento) {
          if (departamento === 'PAP')
            query += "AND G.Clave LIKE 'PAP%' ";
          else if (departamento === 'TODOS')
            query += "";
          else
            query += `AND M.Departamento = '${departamento}' AND G.Clave NOT LIKE 'PAP%'  `;
        }

        query += `ORDER BY M.Nombre, G.Clave `;

        if (desde >= 0) query += `OFFSET ${desde} ROWS `;
        if (hasta > 0) query += `FETCH NEXT ${hasta} ROWS ONLY `;

        data = await db.getInstancia().querySimpleArray(query);
      } else {
        let perOra = (await Catalogos.getInstancia().getPeriodo(periodo)).periodooracle;

        query = `SELECT distinct(codigo) as grupo FROM S_GRUPO G, S_GRUPOMATEAREAPLAN M
        WHERE G.ID = M.GRUPO_ID
        AND G.PeriodoEscolar_ID = ${perOra}
        AND CODIGO NOT IN ('VIEJO', 'REVALI') `
        if (departamento) {
          if (departamento === 'PAP')
            query += "AND G.Codigo LIKE 'PAP%' ";
          else if (departamento === 'TODOS')
            query += "";
          else
            query += `AND G.Codigo NOT LIKE 'PAP%' AND G.AREATRABAJO_ID IN (SELECT ID FROM S_AREATRABAJO WHERE CODIGO = '${departamento}')`;
        }

        data = await oracle.getInstancia().querySimpleArray(query);
      }

      return data;

    } catch (error) {
      throw error;
    }
  }

  public async getListaGruposMateria(origen: ORIGEN, periodo: string, materia: string): Promise<Array<string>> {
    let query = "";

    let data: string[] = [];

    try {
      //TODO: Validar Usuario
      if (origen === ORIGEN.MSSQL) {
        query = `SELECT g.clave
        FROM Grupo g
        WHERE Periodo = '${periodo}'
        AND ((g.materia = '${materia}')
        OR g.Clave in (Select Grupo from GrupoMateria WHERE Periodo = '${periodo}' and materia = '${materia}'))
        ORDER BY G.Clave`;

        data = await db.getInstancia().querySimpleArray(query);
      } else {
        let perOra = (await Catalogos.getInstancia().getPeriodo(periodo)).periodooracle;

        query = `SELECT codigo
        FROM S_GRUPO g
        WHERE PeriodoEscolar_ID = ${perOra}
        AND G.ID IN (SELECT P.Grupo_ID FROM S_GRUPOMATEAREAPLAN P, S_MATEAREAPLAN A 
            WHERE P.MateAreaPlan_ID = A.ID AND A.Materia_ID = ${materia})
        AND g.Codigo NOT IN ('VIEJO', 'REVALI')`

        data = await oracle.getInstancia().querySimpleArray(query);
      }

      return data;

    } catch (error) {
      throw error;
    }
  }

  public async getListaGruposDepartamento(origen: ORIGEN, periodo: string, departamento: string): Promise<Array<string>> {
    let query = "";

    let data: string[] = [];

    try {
      if (origen === ORIGEN.MSSQL) {
        query = `SELECT g.clave
        FROM Grupo g
        WHERE Periodo = '${periodo}'
        AND ((g.materia in (Select Clave from Materia WHERE departamento = '${departamento}'))
        OR g.Clave in (Select Grupo from GrupoMateria WHERE Periodo = '${periodo}' 
              and materia in (Select Clave from Materia WHERE departamento = '${departamento}')))
        ORDER BY G.Clave`;

        data = await db.getInstancia().querySimpleArray(query);
      } else {
        query = `SELECT clave  FROM ORACLEDBA.V_SIPF1_GRUPO WHERE Periodo = '${periodo}'
        AND Materia_ID IN (SELECT clave FROM ORACLEDBA.V_SIPF1_MATERIA where departamento = '${departamento}')`;

        data = await oracle.getInstancia().querySimpleArray(query);
      }

      return data;

    } catch (error) {
      throw error;
    }
  }

  public async getGruposMateriaEncabezado(origen: ORIGEN, periodo: string, materia: string): Promise<Array<Grupo>> {
    let query = "";
    let data;
    let grupos: Grupo[] = [];
    try {
      //TODO: Validar usuario
      if (origen === ORIGEN.MSSQL) {
        query = `SELECT     
        g.clave, g.materia, g.tipo, g.idioma, g.cupo, g.primeringreso, 
        g.reingreso, g.complementarios, g.exportable, g.liberable, g.fijo, 
        g.reportado, g.exportado, g.esgrupoprimeringreso, g.discapacidad, g.exigencia, g.tipoasistencia        
        FROM Grupo g
        WHERE Periodo = '${periodo}'
        AND ((g.materia = ${materia})
        OR g.Clave in (Select Grupo from GrupoMateria WHERE Periodo = '${periodo}' and materia = ${materia}))
        ORDER BY G.Clave`;

        data = await db.getInstancia().queryTabla(query);
      } else {
        let perOra = (await Catalogos.getInstancia().getPeriodo(periodo)).periodooracle;

        query = `SELECT codigo clave, 0 as materia, tg.nombre tipo, i.nombre idioma, g.cupototal cupo, 
        g.cupoprimeringr primeringreso, g.cuporeingreso reingreso, g.cupoareacomplem complementarios, 
        1 as exportable, g.liberable, 0 as fijo, 0 as reportado, 0 as exportado, 0 as esgrupoprimeringreso, 
        0 as discapacidad, g.nivelexigenc_id exigencia, g.tipoasistenc_id tipoasistencia        
        FROM S_GRUPO g, S_IDIOMA i, S_TIPOGRUPO tg WHERE 
        g.Idioma_ID = i.id
        AND g.tipogrupo_ID = tg.id
        AND PeriodoEscolar_ID = ${perOra}
        AND G.ID IN (SELECT P.Grupo_ID FROM S_GRUPOMATEAREAPLAN P, S_MATEAREAPLAN A 
            WHERE P.MateAreaPlan_ID = A.ID AND A.Materia_ID = ${materia})
        AND g.Codigo NOT IN ('VIEJO', 'REVALI')`

        data = await oracle.getInstancia().queryTabla(query);
      }

      let m = await Materias.getInstancia().getMateria(materia);

      for (let i = 0; i < data.length; i++) {
        const o = data[i];
        let clave = Utils.getValorCampo(o["clave"]);
        let llaveUnica = this.getLLaveGrupo(periodo, clave);
        let profesores = await Profesores.getInstancia().getGrupoProfesores(origen, periodo, clave);

        let g = new Grupo(
          origen,
          llaveUnica,
          periodo,
          clave,
          Utils.getValorCampo(o["tipo"]),
          Utils.getValorCampo(o["idioma"]),
          Utils.getValorCampoInt(o["cupo"]),
          Utils.getValorCampoInt(o["primeringreso"]),
          Utils.getValorCampoInt(o["reingreso"]),
          Utils.getValorCampoInt(o["complementarios"]),
          -1, //AlumnosInscritos
          -1, // Cupo Maximo
          Utils.getValorCampoInt(o["exportable"]) === 1,
          Utils.getValorCampoInt(o["liberable"]) === 1,
          false, // fijo
          Utils.getValorCampoInt(o["reportado"]) === 1,
          Utils.getValorCampoInt(o["exportado"]) === 1,
          false, //Es PI
          false, // discapacidad
          '', // revisado
          Catalogos.getInstancia().getNivelExigencia(Utils.getValorCampoInt(o["exigencia"])),
          Catalogos.getInstancia().getTipoAsistencia(Utils.getValorCampoInt(o["tipoasistencia"])),
          m,
          profesores,
        );
        grupos.push(g);
      }
      return grupos;

    } catch (error) {
      throw error;
    }
  }


  public async getGrupos(origen: ORIGEN, periodo: string, departamento: string | undefined, desde = -1, hasta = -1, forzarLectura = false): Promise<Array<Grupo | null>> {
    let data: string[] = [];

    try {
      data = await this.getListaGrupos(origen, periodo, departamento, desde, hasta);
      return await this.construirGruposConcurrenciaLimitada(origen, periodo, data, forzarLectura);
    } catch (error) {
      throw error;
    }
  }

  private getMaxConstruccionesConcurrentes() {
    const valor = Number.parseInt(`${process.env.GRUPOS_MAX_CONCURRENCY || "6"}`.trim(), 10);
    return Number.isFinite(valor) ? Math.max(1, Math.min(valor, 20)) : 6;
  }

  private async construirGruposConcurrenciaLimitada(origen: ORIGEN, periodo: string, claves: string[], forzarLectura = false): Promise<Array<Grupo | null>> {
    const resultados: Array<Grupo | null> = new Array(claves.length);
    let siguiente = 0;
    const trabajadores = Math.min(this.getMaxConstruccionesConcurrentes(), claves.length);

    const trabajador = async () => {
      while (true) {
        const indice = siguiente++;
        if (indice >= claves.length)
          return;
        resultados[indice] = await this.getGrupo(origen, periodo, claves[indice], forzarLectura);
      }
    };

    await Promise.all(Array.from({ length: trabajadores }, () => trabajador()));
    return resultados;
  }

  public async reconstruyeCache(origen: ORIGEN, periodo: string): Promise<boolean> {
    let data: string[] = [];
    try {
      data = await this.getListaGrupos(origen, periodo, undefined, undefined, undefined);

      for (let i = 0; i < data.length; i++) {
        if (process.env.RECONSRUYENDO_CACHE !== 'SI') {
          Utils.Mensaje(CONSOLA.WARNING, `Reconstruccion de cache interrumpida en ${periodo}. ${i}/${data.length} grupos procesados.`);
          return false;
        }

        await this.getGrupo(origen, periodo, data[i], true);
        if ((i + 1) % 100 === 0) {
          Utils.Mensaje(CONSOLA.PROCESO, (i + 1).toString() + " grupos reconstruidos en caché hasta el momento. (" + periodo + ")");
        }
      }
      Utils.Mensaje(CONSOLA.PROCESO, data.length.toString() + " grupos reconstruidos en caché finalmente. (" + periodo + ")");

      if (process.env.RECONSRUYENDO_CACHE !== 'SI') {
        Utils.Mensaje(CONSOLA.WARNING, `Reconstruccion de oferta omitida porque se interrumpió el proceso. (${periodo})`);
        return false;
      }

      const ofertas = await Materias.getInstancia().reconstruyeCacheOferta(origen, periodo);
      Utils.Mensaje(CONSOLA.PROCESO, ofertas.toString() + " ofertas reconstruidas en caché. (" + periodo + ")");

      if (process.env.RECONSRUYENDO_CACHE !== 'SI') {
        Utils.Mensaje(CONSOLA.WARNING, `Reconstruccion de demanda omitida porque se interrumpió el proceso. (${periodo})`);
        return false;
      }

      const demandas = await Materias.getInstancia().reconstruyeCacheDemanda(periodo);
      Utils.Mensaje(CONSOLA.PROCESO, demandas.toString() + " demandas reconstruidas en caché. (" + periodo + ")");
      return true;
    } catch (error) {
      throw error;
    }
  }

  public interrumpirReconstruccionCache(): boolean {
    if (process.env.RECONSRUYENDO_CACHE !== 'SI') {
      Utils.Mensaje(CONSOLA.INFO, "No hay una reconstruccion de cache activa para interrumpir.");
      return false;
    }

    process.env.RECONSRUYENDO_CACHE = 'NO';
    Utils.Mensaje(CONSOLA.WARNING, "Se solicito interrumpir la reconstruccion de cache.");
    return true;
  }


  public async getGruposMateria(origen: ORIGEN, periodo: string, materia: string, usuario: string, soloEncabezado: boolean, forzarLectura = false): Promise<Array<Grupo | null>> {
    let data: string[] = [];

    try {
      if (soloEncabezado)
        return this.getGruposMateriaEncabezado(origen, periodo, materia);

      data = await this.getListaGruposMateria(origen, periodo, materia);
      return await this.construirGruposConcurrenciaLimitada(origen, periodo, data, forzarLectura);
    } catch (error) {
      throw error;
    }
  }

  public async getListaGruposUAB(origen: ORIGEN, periodo: string, UAB: string): Promise<Array<string>> {
    let query = "";
    let promesas: Array<Promise<string[]>> = [];
    let data: string[] = [];

    try {
      let materias = await Materias.getInstancia().getClavesMateriaUAB(UAB, periodo);
      if (origen === ORIGEN.MSSQL) {
        for (let i = 0; i < materias.length; i++) {
          const materia = materias[i];

          query = `SELECT g.clave
          FROM Grupo g
          WHERE Periodo = '${periodo}'
          AND ((g.materia = '${materia}')
          OR g.Clave in (Select Grupo from GrupoMateria WHERE Periodo = '${periodo}' and materia = '${materia}'))
          ORDER BY G.Clave`;

          promesas.push(db.getInstancia().querySimpleArray(query));
        }
      } else {
        let perOra = (await Catalogos.getInstancia().getPeriodo(periodo)).periodooracle;
        for (let i = 0; i < materias.length; i++) {
          const materia = materias[i];

          query = `SELECT codigo
          FROM S_GRUPO g
          WHERE PeriodoEscolar_ID = ${perOra}
          AND G.ID IN (SELECT P.Grupo_ID FROM S_GRUPOMATEAREAPLAN P, S_MATEAREAPLAN A 
            WHERE P.MateAreaPlan_ID = A.ID AND A.Materia_ID = ${materia})
            AND g.Codigo NOT IN ('VIEJO', 'REVALI')`

          promesas.push(oracle.getInstancia().querySimpleArray(query));
        }
      }

      return await Promise.all(promesas).then(listas => {
        for (let i = 0; i < listas.length; i++) {
          data.concat(listas[i]);
        }
        return data;
      });

    } catch (error) {
      throw error;
    }
  }

  public async getClaveORACLE(periodo: string, grupo: string): Promise<number> {
    return await oracle.getInstancia().querySimpleInt(`SELECT ORACLEDBA.SIPF1_GRUPOID('${grupo}', '${periodo}') FROM dual`);
  }

  public async guardarGrupo(
    usuario: string,
    origenEntrada: ORIGEN | string,
    grupo: Grupo,
    cambiosBitacora: CambioBitacoraGrupo[] = [],
  ): Promise<Grupo> {
    const origen = this.getOrigenGuardado(origenEntrada, grupo?.origen);
    const clave = Utils.sanitizaTextoSQL(grupo?.clave || "", 20);
    const periodo = Utils.sanitizaTextoSQL(grupo?.periodo || "", 10);
    const resumen = this.resumenGuardarGrupo(origen, grupo, cambiosBitacora, clave, periodo);

    Utils.Mensaje(CONSOLA.INFO, `[guardarGrupo] inicio | ${JSON.stringify(resumen)}`);

    if (!clave || !periodo) {
      throw new Error("GrupoInput incompleto: se requiere periodo y clave");
    }

    grupo.origen = origen;
    grupo.clave = clave;
    grupo.periodo = periodo;

    const grupoActual = await this.obtenerGrupoHidratado(origen, periodo, clave);
    const cambiosParaAuditoria = grupoActual
      ? this.construyeCambiosBitacoraServidor(grupoActual, grupo, origen)
      : [];

    try {
      if (origen === ORIGEN.MSSQL) {
        Utils.Mensaje(CONSOLA.INFO, `[guardarGrupo] rama MSSQL | ${periodo}|${clave}`);
        await this.guardarGrupoMSSQLAgregado(usuario, grupo, cambiosParaAuditoria);
      } else {
        Utils.Mensaje(CONSOLA.INFO, `[guardarGrupo] rama ORACLE | ${periodo}|${clave}`);
        await this.guardarGrupoOracleAgregado(usuario, grupo, cambiosParaAuditoria, grupoActual);
      }
    } catch (error) {
      Utils.Mensaje(CONSOLA.ERROR_SIN_TRACE, `[guardarGrupo] fallo persistencia | ${JSON.stringify(resumen)}`);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      throw error;
    }

    Almacen.getInstancia().borrarCache(origen, this.getLLaveGrupo(periodo, clave), "Grupo");

    Utils.Mensaje(CONSOLA.INFO, `[guardarGrupo] rehidratando | ${periodo}|${clave}`);
    const guardado = await this.obtenerGrupoHidratado(origen, periodo, clave);
    if (!guardado) {
      throw new Error(`No fue posible rehidratar el grupo ${periodo}|${clave} despues de guardar`);
    }

    Utils.Mensaje(CONSOLA.INFO, `[guardarGrupo] fin | ${periodo}|${clave}`);
    return guardado;
  }


  /*
    public async guardarEncabezadoGrupoNuevo(origen: ORIGEN, usuario: string, tokenSesion: string, periodo: string, claveGrupo: string,
      grupo: string, profesorTentativo: string, cupo: number,
      cupoPrimerIngreso: number, cupoReingreso: number, cupoAC: number, cupoMax: number, idioma: string, liberable: number,
      tipoGrupo: string, bloqueadoPorDSE: number, tipoAsistenciaID: number, contenido: string, areaGrupo: string,
      nivelExigenciaID: number, tipoGrupoID: number, areaTrabajo: string): Promise<number> {
  
      let periodoEscolarID = await oracle.getInstancia().querySimpleInt(`SELECT PeriodoEscolar_ID FROM ORACLEDBA.V_SIPF1_PERIODOS WHERE ClaveSIPLE = '${periodo}'`);
      let areaTrabajoID = await oracle.getInstancia().querySimpleInt(`SELECT ID FROM ORACLEDBA.AREATRABAJO WHERE Codigo = '${areaTrabajo}'`);
  
      if (periodoEscolarID > 0) {
        let query = `declare i number;
          begin
             i:=oracledba.SIPF1_ALTAGRUPO2(${periodoEscolarID},'${grupo}','${profesorTentativo}',${cupo},${cupoPrimerIngreso},${cupoReingreso},
             ${cupoAC},${cupoMax},'${idioma}','${liberable == 1 ? 'S' : 'N'}','${tipoGrupo}',${bloqueadoPorDSE},${tipoAsistenciaID},'${contenido}',
             '${areaGrupo}',null,${nivelExigenciaID},${tipoGrupoID},${areaTrabajoID});
          end;`;
        //           dbms_output.put_line(i);
  
        await oracle.getInstancia().querySinResultados(query);
  
        return await this.getClaveORACLE(grupo, periodo);
  
      }
  */

  /*                
if (await JWT.getInstancia().verificarToken(usuario, tokenSesion) === "Ok") {
  let query = `IF EXISTS(select * from SuscripcionCorreoUsuario WHERE Usuario = '${usuario}' AND Correo='${correo}')
  UPDATE SuscripcionCorreoUsuario SET Suscrito = 1 WHERE Usuario = '${usuario}' AND Correo='${correo}'
  ELSE
  INSERT INTO SuscripcionCorreoUsuario (Usuario, Correo, Suscrito) VALUES ('${usuario}', '${correo}', 1) `;
  return await db.getInstancia().querySinResultados(query)
}
*/

  /*
  
  if (tipo.Equals("CU"))
                      area = "CURRICULUM UNIVERSITARIO";
                  else if (tipo.Equals("AC"))
                      area = "SABERES COMPLEMENTARIOS";
                  else if (tipo.Equals("REINGRESO") || tipo.StartsWith("PRIMER"))
                      area = "SABERES PROFESIONALES";
                  else
                      area = "SIN AREA";
  
                  TipoAsistencia
  
  1             Presencial
  2             Semi-presencial
  3             En línea
  4             Asesoría
  5             Videoconferencia
  
  NivelExigencia
  1             Ordinario
  2             Intensivo
  3             Verano Internacional
  4             Bimestral
  
  TipoGrupo
  1             Reingreso
  2             Primer Ingreso
                  */

  /*
              20	AEJ	CENTRO ACOMPAÑAMIENTO Y EST JUVENILES
              266644	CAR	CENTRO DE APRENDIZAJE EN RED
              75	EFS	CENTRO DE EDUCACION FISICA Y SALUD INTEGRAL
              19	IFS	CENTRO DE INVESTIGACION Y FORMACION SOCIAL
              77	CPC	CENTRO DE PROMOCION CULTURAL
              418982	GIT	CENTRO PARA LA GESTION DE LA INNOVACION Y LA TECNOLOGIA
              38	DUE	CENTRO UNIVERSIDAD EMPRESA
              18	CUI	CENTRO UNIVERSITARIO IGNACIANO
              195	EAM	DEPARTAMENTO DE ECONOMIA, ADMINISTRACION Y MERCADOLOGIA
              26	ESI	DEPARTAMENTO DE ELECTRONICA, SISTEMAS E INFORMATICA
              27	ESO	DEPARTAMENTO DE ESTUDIOS SOCIOCULTURALES
              28	SOJ	DEPARTAMENTO DE ESTUDIOS SOCIOPOLITICOS Y JURIDICOS
              35	FIH	DEPARTAMENTO DE FILOSOFIA Y HUMANIDADES
              500127	DFH	DEPARTAMENTO DE FORMACION HUMANA
              503030	DEL	DEPARTAMENTO DE LENGUAS
              30	MAF	DEPARTAMENTO DE MATEMATICAS Y FISICA
              32	PTI	DEPARTAMENTO DE PROCESOS TECNOLOGICOS E INDUSTRIALES
              471246	PES	DEPARTAMENTO DE PSICOLOGIA EDUCACION Y SALUD
              29	HDU	DEPARTAMENTO DEL HABITAT Y DESARROLLO URBANO
              503028	DIA	DIRECCION DE INFORMACION ACADEMICA
              7	DGA	DIRECCION GENERAL ACADEMICA
  
  return 0;

}
*/

  public async guardarEncabezadoGrupoDBO(usuario: string, tokenSesion: string, periodo: string, claveGrupo: string, cupo: number,
    cupoPrimerIngreso: number, cupoReingreso: number, cupoAC: number, idioma: string, liberable: boolean,
    bloqueadoPorDSE: boolean, contenido: string,
    areaTrabajo: string): Promise<number> {

    if (await JWT.getInstancia().verificarToken(usuario, tokenSesion) === "Ok") {
      console.info("El usuario ", usuario, "está guardando el grupo", claveGrupo, periodo);

      let periodoEscolarID = await oracle.getInstancia().querySimpleInt(`SELECT PeriodoEscolar_ID FROM ORACLEDBA.V_SIPF1_PERIODOS WHERE ClaveSIPLE = '${periodo}'`);
      let areaTrabajoID = await oracle.getInstancia().querySimpleInt(`SELECT ID FROM ORACLEDBA.AREATRABAJO WHERE Codigo = '${areaTrabajo}'`);
      let cupoMax = 999;
      let profesorTentativo = '';


      if (periodoEscolarID > 0) {
        let grupo = await this.getGrupo(ORIGEN.ORACLE, periodo, claveGrupo, true);
        let areaGrupo = ''; //'SABERES PROFESIONALES';
        let nivelExigencia = '1';
        let tipoGrupoID = '1';
        let tipoAsistencia = '1';
        if (!grupo)
          return -1;

        nivelExigencia = grupo.exigencia.clave;
        tipoAsistencia = grupo.tipoAsistencia.clave;
        let query = `declare i number;
        begin
           i:=oracledba.SIPF1_ALTAGRUPO2(${periodoEscolarID},'${grupo.clave}','${profesorTentativo}',${cupo},${cupoPrimerIngreso},${cupoReingreso},
           ${cupoAC},${cupoMax},'${idioma}','${liberable ? 'S' : 'N'}','${grupo.tipo}',${bloqueadoPorDSE ? 1 : 0},${tipoAsistencia},'${contenido}',
           '${areaGrupo}',null,${nivelExigencia},${tipoGrupoID},${areaTrabajoID});
        end;`;
        await oracle.getInstancia().querySinResultados(query);

        /*
        let parametros : IParametro[] = [];
        parametros.push( {argumento : "grupoId",            valor : null,                     tipo : oracledb.NUMBER,  dir: oracledb.BIND_OUT });
        parametros.push( {argumento : "P_PERIODOESCOLARID", valor : periodoEscolarID,         tipo : oracledb.NUMBER });
        parametros.push( {argumento : "P_CLAVEGRUPO",       valor : grupo.clave,              tipo : oracledb.STRING });
        parametros.push( {argumento : "P_PROFESORTENT",     valor : profesorTentativo,        tipo : oracledb.STRING });
        parametros.push( {argumento : "P_CTOTAL",           valor : cupo,                     tipo : oracledb.NUMBER });
        parametros.push( {argumento : "P_C1ERINGRESO",      valor : cupoPrimerIngreso,        tipo : oracledb.NUMBER });
        parametros.push( {argumento : "P_CREINGRESO",       valor : cupoReingreso,            tipo : oracledb.NUMBER });
        parametros.push( {argumento : "P_CAREACOMPL",       valor : cupoAC,                   tipo : oracledb.NUMBER });
        parametros.push( {argumento : "P_CUPOMAXIMO",       valor : cupoMax,                  tipo : oracledb.NUMBER });
        parametros.push( {argumento : "P_IDIOMA",           valor : idioma,                   tipo : oracledb.STRING });
        parametros.push( {argumento : "P_LIBERABLE",        valor : liberable ? 'S' : 'N',    tipo : oracledb.STRING });
        parametros.push( {argumento : "P_MSSGRUPO",         valor : grupo.tipo,               tipo : oracledb.STRING });
        parametros.push( {argumento : "P_BLOQUEADOXSSE",    valor : bloqueadoPorDSE ? 1 : 0,  tipo : oracledb.NUMBER });
        parametros.push( {argumento : "P_TIPOASISTENC_ID",  valor : parseInt(tipoAsistencia), tipo : oracledb.NUMBER });
        parametros.push( {argumento : "P_CONTENIDO",        valor : contenido,                tipo : oracledb.STRING });
        parametros.push( {argumento : "P_AREAGRUPO",        valor : areaGrupo,                tipo : oracledb.STRING });
       // parametros.push( {argumento : "P_GRUPOPADRE_ID",    valor : null,                     tipo : oracledb.NUMBER });
        parametros.push( {argumento : "P_NIVELEXIGENC_ID",  valor : parseInt(nivelExigencia), tipo : oracledb.NUMBER });
        parametros.push( {argumento : "P_TIPOGRUPO_ID",     valor : parseInt(tipoGrupoID),    tipo : oracledb.NUMBER });
        parametros.push( {argumento : "P_AREATRABAJO_ID",   valor : areaTrabajoID,            tipo : oracledb.NUMBER });

        let r = await oracle.getInstancia().ejecutaRetorno("ORACLEDBA.SIPF1_ALTAGRUPO2", parametros); 
        console.log("r",r);
        */

        await this.actualizarFechaModificacionGrupo(periodo, claveGrupo);
        return this.getClaveORACLE(periodo, claveGrupo);
        //return true;
      }
    }

    console.error("El usuario ", usuario, "intentó guardar el grupo", claveGrupo, periodo, "con el token", tokenSesion, "pero fue DENEGADO");
    return -4;

  }

  async guardarMensajeGrupoDBO(usuario: string, tokenSesion: string, grupoId: number, tipoMensaje: string, mensaje: string): Promise<boolean> {
    if (await JWT.getInstancia().verificarToken(usuario, tokenSesion) !== "Ok")
      return false;

    if (`${tipoMensaje || ""}`.toUpperCase() === TIPO_MENSAJE.TIPO_POPUP) {
      mensaje = this.decodificaPopupEntrada(mensaje);
    }

    if (!mensaje)
      mensaje = '';

    let parametros: IParametro[] = [];
    parametros.push({ argumento: "P_GRUPOID", valor: grupoId, tipo: oracledb.NUMBER });
    parametros.push({ argumento: "P_TIPOMENSAJE", valor: tipoMensaje, tipo: oracledb.STRING });
    parametros.push({ argumento: "P_MENSAJE", valor: mensaje, tipo: oracledb.STRING });

    //console.log(tipoMensaje, mensaje);
    return await oracle.getInstancia().ejecuta("ORACLEDBA.SIPF1_ALTAMENSAJE", parametros);
  }


  async guardarHorarioGrupoDBO(usuario: string, tokenSesion: string, grupoId: number, periodo: string, diaSemana: number, espacio: string,
    horaInicio: string, horaFin: string, plantilla: string): Promise<boolean> {

    if (await JWT.getInstancia().verificarToken(usuario, tokenSesion) !== "Ok")
      return false;

    let per = await Catalogos.getInstancia().getPeriodo(periodo);

    let fi = UtilsFechas.parseFecha(per.fechainicio);
    let ff = UtilsFechas.parseFecha(per.fechafin);
    let hi = UtilsFechas.formatearHoraStringOracle(horaInicio);
    let hf = UtilsFechas.formatearHoraStringOracle(horaFin);

    let parametros: IParametro[] = [];
    parametros.push({ argumento: "P_GRUPOID", valor: grupoId, tipo: oracledb.NUMBER });
    parametros.push({ argumento: "P_FECHAINICIAL", valor: fi, tipo: oracledb.DB_TYPE_TIMESTAMP_TZ });
    parametros.push({ argumento: "P_FECHAFINAL", valor: ff, tipo: oracledb.DB_TYPE_TIMESTAMP_TZ });
    parametros.push({ argumento: "P_DIASEMANA", valor: diaSemana, tipo: oracledb.NUMBER });
    parametros.push({ argumento: "P_SALON", valor: espacio, tipo: oracledb.STRING });
    parametros.push({ argumento: "P_HORAINICIO", valor: hi, tipo: oracledb.STRING });
    parametros.push({ argumento: "P_HORAFIN", valor: hf, tipo: oracledb.STRING });
    parametros.push({ argumento: "P_PLANTILLA", valor: plantilla, tipo: oracledb.STRING });
    //parametros.push( {argumento : "PAUTOCOMMIT", valor : '', tipo : oracledb.STRING });

    return await oracle.getInstancia().ejecuta("ORACLEDBA.SIPF1_ALTAHORARIO", parametros);
  }

  async guardarPlanCompartidoDBO(usuario: string, tokenSesion: string, grupoId: number, materiaId: number, programa: string, cupo: number): Promise<boolean> {
    if (await JWT.getInstancia().verificarToken(usuario, tokenSesion) !== "Ok")
      return false;
    //let query = `EXECUTE ORACLEDBA.SIPF1_ALTAGMAP(${grupoId},  ${materiaId}, '${programa}', ${cupo});`;

    //console.log("Se guardará", query);
    //await oracle.getInstancia().query(query);
    let parametros: IParametro[] = [];
    parametros.push({ argumento: "P_GRUPOID", valor: grupoId, tipo: oracledb.DB_TYPE_NUMBER });
    parametros.push({ argumento: "P_MATERIAID", valor: materiaId, tipo: oracledb.DB_TYPE_NUMBER });
    parametros.push({ argumento: "P_CLAVEPLAN", valor: programa, tipo: oracledb.DB_TYPE_VARCHAR });
    parametros.push({ argumento: "P_CUPOGRUPO", valor: cupo, tipo: oracledb.DB_TYPE_NUMBER });

    return await oracle.getInstancia().ejecuta("ORACLEDBA.SIPF1_ALTAGMAP22", parametros);

  }

  async guardarGrupoMSSQL(usuario: string, tokenSesion: string, grupo: Grupo) {
    if (await JWT.getInstancia().verificarToken(usuario, tokenSesion) !== "Ok")
      return false;

    try {
      grupo.origen = ORIGEN.MSSQL;
      await this.guardarGrupoMSSQLAgregado(usuario, grupo, [], false);
      return true;
    } catch (error) {
      Utils.Mensaje(CONSOLA.ERROR_SIN_TRACE, error);
      return false;
    }
  }

  private async guardarGrupoMSSQLAgregado(
    usuario: string,
    grupo: Grupo,
    cambiosBitacora: CambioBitacoraGrupo[] = [],
    reemplazoCompleto = true,
  ) {
    if (grupo.origen != ORIGEN.MSSQL)
      throw new Error("El guardado agregado MSSQL requiere origen MSSQL");

    if (!grupo?.clave || !grupo?.periodo)
      throw new Error("GrupoInput incompleto: se requiere periodo y clave");

    const clave = Utils.sanitizaTextoSQL(grupo.clave);
    const periodo = Utils.sanitizaTextoSQL(grupo.periodo);
    const materiaClave = Utils.sanitizaTextoSQL(grupo.materia?.clave || "");
    const profesorExpediente = Utils.sanitizaTextoSQL(grupo.profesores?.[0]?.expediente || "0");
    const contenido = Utils.sanitizaTextoSQL(grupo.contenido || "", 200);
    const idioma = Utils.sanitizaTextoSQL(grupo.idioma || "", 20);
    const tipoGrupo = Utils.sanitizaTextoSQL(grupo.tipo || "", 20);
    const mensajes = reemplazoCompleto
      ? this.normalizaMensajesGrupo(grupo)
      : (grupo.mensajes !== undefined || grupo.modificadores !== undefined ? this.normalizaMensajesGrupo(grupo) : undefined);
    const horarios = reemplazoCompleto
      ? this.normalizaHorariosGrupo(grupo.horarios || [])
      : (grupo.horarios !== undefined ? this.normalizaHorariosGrupo(grupo.horarios) : undefined);
    const revisadoPor = reemplazoCompleto ? (grupo.revisadoPor || []) : grupo.revisadoPor;
    const planesCompartidos = reemplazoCompleto ? (grupo.planesCompartidos || []) : grupo.planesCompartidos;
    const materiasAdicionales = reemplazoCompleto ? (grupo.materiasAdicionales || []) : grupo.materiasAdicionales;
    const letraGrupo = Utils.sanitizaTextoSQL(
      grupo.letra?.trim() || await Plantillas.getInstancia().getGrupoHorarioBaseGrupo(horarios || grupo.horarios),
      10
    );

    const cupoGeneral = this.numeroSeguro(grupo.cupoGeneral);
    const cupoPrimerIngreso = this.numeroSeguro(grupo.cupoPrimerIngreso);
    const cupoReingreso = this.numeroSeguro(grupo.cupoReingreso);
    const cupoComplementario = this.numeroSeguro(grupo.cupoComplementario);
    const cupoMaximo = this.numeroSeguro(grupo.cupoMaximo, 999);
    const alumnosInscritos = this.numeroSeguro(grupo.alumnosInscritos);
    const tipoAsistencia = this.numeroSeguro(grupo.tipoAsistencia?.clave, 1);
    const nivelExigencia = this.numeroSeguro(grupo.exigencia?.clave, 1);
    const exportable = grupo.exportable && !tipoGrupo.toUpperCase().startsWith("OTRO") ? 1 : 0;
    const liberable = grupo.liberable ? 1 : 0;
    const fijo = grupo.fijo ? 1 : 0;
    const discapacidad = grupo.discapacidad ? 1 : 0;

    const sentencias: string[] = [];

    sentencias.push(`
      IF EXISTS (SELECT Clave FROM Grupo WHERE Clave = '${clave}' AND Periodo = '${periodo}')
      BEGIN
        UPDATE Grupo
        SET Profesor = '${profesorExpediente}',
            Cupo = ${cupoGeneral},
            PrimerIngreso = ${cupoPrimerIngreso},
            Reingreso = ${cupoReingreso},
            Complementarios = ${cupoComplementario},
            CupoMaximo = ${cupoMaximo},
            Idioma = '${idioma}',
            AlumnosInscritos = ${alumnosInscritos},
            Planes = '',
            Exportable = ${exportable},
            Observaciones = '${contenido}',
            Materia = '${materiaClave}',
            FechaModificacion = GETDATE(),
            Tipo = '${tipoGrupo}',
            Liberable = ${liberable},
            Fijo = ${fijo},
            Reportado = 0,
            TipoAsistencia = ${tipoAsistencia},
            Exigencia = ${nivelExigencia},
            Discapacidad = ${discapacidad},
            Letra = '${letraGrupo}'
        WHERE Clave = '${clave}' AND Periodo = '${periodo}'
      END
      ELSE
      BEGIN
        INSERT INTO Grupo (
          Clave, Periodo, Materia, Profesor, CupoMaximo, Cupo, PrimerIngreso,
          Reingreso, Complementarios, Planes, Exportable, Observaciones,
          Tipo, Idioma, Liberable, Fijo, AlumnosInscritos, TipoAsistencia,
          Exigencia, Discapacidad, Letra, FechaCreacion, FechaModificacion, Reportado
        ) VALUES (
          '${clave}', '${periodo}', '${materiaClave}', '${profesorExpediente}', ${cupoMaximo}, ${cupoGeneral}, ${cupoPrimerIngreso},
          ${cupoReingreso}, ${cupoComplementario}, '', ${exportable}, '${contenido}',
          '${tipoGrupo}', '${idioma}', ${liberable}, ${fijo}, ${alumnosInscritos}, ${tipoAsistencia},
          ${nivelExigencia}, ${discapacidad}, '${letraGrupo}', GETDATE(), GETDATE(), 0
        )
      END
    `);

    if (reemplazoCompleto || grupo.materia || materiasAdicionales !== undefined) {
      sentencias.push(`DELETE GrupoMateria WHERE Grupo = '${clave}' AND Periodo = '${periodo}'`);

      const materiasInsertar = new Map<string, number>();
      if (materiaClave.length > 0) {
        materiasInsertar.set(materiaClave.toUpperCase(), 1);
      }
      for (const materia of materiasAdicionales || []) {
        const claveMateria = Utils.sanitizaTextoSQL(materia?.clave || "");
        if (claveMateria.length > 0 && !materiasInsertar.has(claveMateria.toUpperCase())) {
          materiasInsertar.set(claveMateria.toUpperCase(), 0);
        }
      }

      for (const [claveMateria, principal] of materiasInsertar.entries()) {
        sentencias.push(`
          INSERT INTO GrupoMateria (Grupo, Periodo, Materia, Principal)
          VALUES ('${clave}', '${periodo}', '${claveMateria}', ${principal})
        `);
      }
    }

    if (horarios !== undefined) {
      sentencias.push(`DELETE GrupoHorario WHERE Grupo = '${clave}' AND Periodo = '${periodo}'`);

      for (const horario of horarios || []) {
        const plantilla = Utils.sanitizaTextoSQL(
          horario.plantilla?.trim() || await Plantillas.getInstancia().identificarPlantilla(horario.numDiaSemana, horario.horaInicio, horario.horaFin),
          10
        );
        const diaSemana = this.numeroSeguro(horario.numDiaSemana);
        const horaInicio = this.normalizaHoraMSSQL(horario.horaInicio);
        const horaFin = this.normalizaHoraMSSQL(horario.horaFin);
        const espacio = Utils.sanitizaTextoSQL(horario.claveEspacio || "");

        sentencias.push(`
          INSERT INTO GrupoHorario (Grupo, Periodo, Plantilla, DiaSemana, HoraInicio, HoraFin, Espacio)
          VALUES ('${clave}', '${periodo}', '${plantilla}', ${diaSemana}, '${horaInicio}', '${horaFin}', '${espacio}')
        `);
      }
    }

    if (mensajes !== undefined) {
      sentencias.push(`DELETE GrupoMensajes WHERE Grupo = '${clave}' AND Periodo = '${periodo}'`);

      let numero = 1;
      for (const mensaje of mensajes || []) {
        const tipo = this.tipoMensajeMSSQL(mensaje?.tipo);
        const texto = Utils.sanitizaTextoSQL(mensaje?.mensaje || "", 249);

        sentencias.push(`
          INSERT INTO GrupoMensajes (Grupo, Periodo, Numero, Tipo, Mensaje)
          VALUES ('${clave}', '${periodo}', ${numero}, ${tipo}, '${texto}')
        `);
        numero++;
      }
    }

    if (revisadoPor !== undefined) {
      sentencias.push(`DELETE GrupoRevisado WHERE Periodo = '${periodo}' AND Grupo = '${clave}'`);

      const programas = new Set<string>();
      for (const programa of revisadoPor || []) {
        const clavePrograma = Utils.sanitizaTextoSQL(programa || "");
        if (clavePrograma.length > 0) {
          programas.add(clavePrograma.toUpperCase());
        }
      }

      for (const programa of programas) {
        sentencias.push(`
          INSERT INTO GrupoRevisado (Periodo, Grupo, Programa, Confirmado)
          VALUES ('${periodo}', '${clave}', '${programa}', 1)
        `);
      }
    }

    if (planesCompartidos !== undefined) {
      sentencias.push(`DELETE GrupoPlanCompartido WHERE Grupo = '${clave}' AND Periodo = '${periodo}'`);

      for (const plan of planesCompartidos || []) {
        const programa = Utils.sanitizaTextoSQL(plan?.programa || "", 20);
        const materia = Utils.sanitizaTextoSQL(`${plan?.materia ?? ""}`, 20);
        const cupo = this.numeroSeguro(plan?.cupo);

        if (!programa || !materia) {
          continue;
        }

        sentencias.push(`
          INSERT INTO GrupoPlanCompartido (Grupo, Periodo, Programa, Materia, Cupo)
          VALUES ('${clave}', '${periodo}', '${programa}', '${materia}', ${cupo})
        `);
      }
    }

    const cambios = this.normalizaCambiosBitacora(cambiosBitacora);
    Utils.Mensaje(
      CONSOLA.INFO,
      `[guardarGrupo][MSSQL] detalle | ${JSON.stringify({
        clave,
        periodo,
        horarios: horarios?.length || 0,
        mensajes: mensajes?.length || 0,
        planesCompartidos: planesCompartidos?.length || 0,
        cambiosBitacora: cambios,
      })}`
    );
    for (const cambio of cambios) {
      sentencias.push(this.queryInsertBitacoraMSSQL(ORIGEN.MSSQL, usuario, clave, periodo, cambio));
    }

    const query = `
      BEGIN TRY
        BEGIN TRANSACTION
        ${sentencias.join("\n")}
        COMMIT TRANSACTION
      END TRY
      BEGIN CATCH
        IF @@TRANCOUNT > 0
          ROLLBACK TRANSACTION
        THROW
      END CATCH
    `;

    Utils.Mensaje(CONSOLA.INFO, `[guardarGrupo][MSSQL] ejecutando transaccion | ${periodo}|${clave}`);
    await db.getInstancia().querySinResultados(query);
    Utils.Mensaje(CONSOLA.INFO, `[guardarGrupo][MSSQL] transaccion OK | ${periodo}|${clave}`);
    Almacen.getInstancia().borrarCache(ORIGEN.MSSQL, this.getLLaveGrupo(periodo, clave), "Grupo");
  }

  private async guardarGrupoOracleAgregado(
    usuario: string,
    grupo: Grupo,
    cambiosBitacora: CambioBitacoraGrupo[] = [],
    grupoActualEntrada?: Grupo | null,
  ) {
    if (grupo.origen != ORIGEN.ORACLE)
      throw new Error("El guardado agregado ORACLE requiere origen ORACLE");

    const grupoActual = grupoActualEntrada === undefined
      ? await this.getGrupo(ORIGEN.ORACLE, grupo.periodo, grupo.clave, true, true)
      : grupoActualEntrada;
    if (!grupoActual) {
      throw new Error(`No existe el grupo ORACLE ${grupo.periodo}|${grupo.clave}`);
    }

    const contenido = Utils.sanitizaTextoSQL(grupo.contenido ?? grupoActual.contenido ?? "", 2000);
    const idioma = Utils.sanitizaTextoSQL(grupo.idioma || grupoActual.idioma || "", 20);
    const tipoGrupo = Utils.sanitizaTextoSQL(grupo.tipo || grupoActual.tipo || "", 20);
    const profesorTentativo = Utils.sanitizaTextoSQL(grupo.profesores?.[0]?.expediente || "", 20);
    const areaTrabajo = Utils.sanitizaTextoSQL(
      grupo.materia?.departamento || grupoActual.materia?.departamento || "DGA",
      10
    );
    const cupoGeneral = this.numeroSeguro(grupo.cupoGeneral, grupoActual.cupoGeneral);
    const cupoPrimerIngreso = this.numeroSeguro(grupo.cupoPrimerIngreso, grupoActual.cupoPrimerIngreso);
    const cupoReingreso = this.numeroSeguro(grupo.cupoReingreso, grupoActual.cupoReingreso);
    const cupoComplementario = this.numeroSeguro(grupo.cupoComplementario, grupoActual.cupoComplementario);
    const cupoMaximo = this.numeroSeguro(grupo.cupoMaximo, grupoActual.cupoMaximo || 999);
    const liberable = grupo.liberable ? 'S' : 'N';
    const tipoAsistencia = this.numeroSeguro(grupo.tipoAsistencia?.clave, this.numeroSeguro(grupoActual.tipoAsistencia?.clave, 1));
    const nivelExigencia = this.numeroSeguro(grupo.exigencia?.clave, this.numeroSeguro(grupoActual.exigencia?.clave, 1));
    const tipoGrupoID = this.tipoGrupoIdOracle(tipoGrupo, cupoPrimerIngreso);
    const horarios = this.normalizaHorariosGrupo(grupo.horarios || []);
    const mensajes = this.normalizaMensajesGrupo(grupo);
    const planesCompartidos = grupo.planesCompartidos || [];
    const cambios = this.normalizaCambiosBitacora(cambiosBitacora);
    const periodoCatalogo = await Catalogos.getInstancia().getPeriodo(grupo.periodo);
    Utils.Mensaje(
      CONSOLA.INFO,
      `[guardarGrupo][ORACLE] detalle | ${JSON.stringify({
        clave: grupo.clave,
        periodo: grupo.periodo,
        horarios: horarios.length,
        mensajes: mensajes.length,
        planesCompartidos: planesCompartidos.length,
        cambiosBitacora: cambios,
      })}`
    );
    const fechaInicial = UtilsFechas.parseFecha(periodoCatalogo.fechainicio);
    const fechaFinal = UtilsFechas.parseFecha(periodoCatalogo.fechafin);

    await oracle.getInstancia().withTransaction(async (connection) => {
      Utils.Mensaje(CONSOLA.INFO, `[guardarGrupo][ORACLE] inicia transaccion | ${grupo.periodo}|${grupo.clave}`);
      const periodoEscolarID = await this.oracleQuerySimpleIntTx(
        connection,
        `SELECT PeriodoEscolar_ID FROM ORACLEDBA.V_SIPF1_PERIODOS WHERE ClaveSIPLE = '${grupo.periodo}'`
      );
      const areaTrabajoID = await this.oracleQuerySimpleIntTx(
        connection,
        `SELECT ID FROM ORACLEDBA.AREATRABAJO WHERE Codigo = '${areaTrabajo}'`
      );

      if (periodoEscolarID <= 0) {
        throw new Error(`No existe PeriodoEscolar_ID para ${grupo.periodo}`);
      }
      if (areaTrabajoID <= 0) {
        throw new Error(`No existe AreaTrabajo_ID para ${areaTrabajo}`);
      }

      await connection.execute(
        `DECLARE i NUMBER;
         BEGIN
           i := ORACLEDBA.SIPF1_ALTAGRUPO2(:1,:2,:3,:4,:5,:6,:7,:8,:9,:10,:11,:12,:13,:14,:15,NULL,:16,:17,:18);
         END;`,
        [
          periodoEscolarID,
          grupo.clave,
          profesorTentativo,
          cupoGeneral,
          cupoPrimerIngreso,
          cupoReingreso,
          cupoComplementario,
          cupoMaximo,
          idioma,
          liberable,
          tipoGrupo,
          0,
          tipoAsistencia,
          contenido,
          "",
          nivelExigencia,
          tipoGrupoID,
          areaTrabajoID,
        ]
      );

      const grupoId = await this.oracleQuerySimpleIntTx(
        connection,
        `SELECT ORACLEDBA.SIPF1_GRUPOID('${grupo.clave}', '${grupo.periodo}') AS GRUPOID FROM dual`
      );

      if (grupoId <= 0) {
        throw new Error(`No fue posible obtener el grupoId ORACLE de ${grupo.periodo}|${grupo.clave}`);
      }

      Utils.Mensaje(CONSOLA.INFO, `[guardarGrupo][ORACLE] grupoId | ${grupoId}`);

      for (const horario of horarios) {
        const plantilla = Utils.sanitizaTextoSQL(
          horario.plantilla?.trim() || await Plantillas.getInstancia().identificarPlantilla(horario.numDiaSemana, horario.horaInicio, horario.horaFin),
          10
        );
        try {
          await connection.execute(
            `BEGIN ORACLEDBA.SIPF1_ALTAHORARIO(:1,:2,:3,:4,:5,:6,:7,:8); END;`,
            [
              grupoId,
              fechaInicial,
              fechaFinal,
              this.numeroSeguro(horario.numDiaSemana),
              Utils.sanitizaTextoSQL(horario.claveEspacio || "", 80),
              UtilsFechas.formatearHoraStringOracle(horario.horaInicio),
              UtilsFechas.formatearHoraStringOracle(horario.horaFin),
              plantilla,
            ]
          );

        } catch (error) {
          Utils.Mensaje(CONSOLA.WARNING, `No se pudo grabar horario ${horario.numDiaSemana} ${horario.horaInicio}-${horario.horaFin} | ${error}`);
          throw error;
        }
      }

      for (const mensaje of mensajes) {
        if (mensaje == null || mensaje.tipo === TIPO_MENSAJE.SIN_TIPO || !mensaje.mensaje) {
          continue;
        }


        try {
          await connection.execute(
            `BEGIN ORACLEDBA.SIPF1_ALTAMENSAJE(:1,:2,:3); END;`,
            [
              grupoId,
              Utils.sanitizaTextoSQL(mensaje.tipo || "", 20),
              this.normalizaMensajeOracle(mensaje.tipo, mensaje.mensaje),
            ]
          );

        } catch (error) {
          Utils.Mensaje(CONSOLA.WARNING, `"No se pudo grabar mensaje ${mensaje.tipo} | ${mensaje.mensaje}`);
          throw error;
        }
      }

      for (const plan of planesCompartidos) {
        const materiaId = this.numeroSeguro(plan?.materia);
        const programa = Utils.sanitizaTextoSQL(plan?.programa || "", 20);
        if (materiaId <= 0 || !programa) {
          continue;
        }

        try {
          await connection.execute(
            `BEGIN ORACLEDBA.SIPF1_ALTAGMAP22(:1,:2,:3,:4); END;`,
            [

              grupoId,
              materiaId,
              programa,
              this.numeroSeguro(plan?.cupo),
            ]
          );

        } catch (error) {
          Utils.Mensaje(CONSOLA.WARNING, `"No se pudo grabar plan ${programa}`);
          throw error;
        }
      }

      Utils.Mensaje(CONSOLA.INFO, `[guardarGrupo][ORACLE] transaccion OK | ${grupo.periodo}|${grupo.clave}`);
    });

    try {
      await this.actualizarFechaModificacionGrupo(grupo.periodo, grupo.clave);
    } catch (error) {
      Utils.Mensaje(CONSOLA.WARNING, `No se pudo actualizar FechaModificacion MSSQL para ${grupo.periodo}|${grupo.clave}`);
    }

    if (cambios.length > 0) {
      for (const cambio of cambios) {
        try {
          await Log.getInstancia().guardarBitacora({
            origen: ORIGEN.ORACLE,
            usuario: this.usuarioBitacora(usuario),
            grupo: grupo.clave,
            periodo: grupo.periodo,
            secuencia: -1,
            cambio: cambio.cambio,
            campo: cambio.campo,
            valorAnterior: this.textoPlanoBitacora(cambio.valorAnterior),
            valorNuevo: this.textoPlanoBitacora(cambio.valorNuevo),
          });
        } catch (error) {
          Utils.Mensaje(CONSOLA.WARNING, `Bitacora ORACLE no persistida de forma atomica para ${grupo.periodo}|${grupo.clave}`);
        }
      }
    }
  }

  async guardarPlanCompartidoMSSQL(usuario: string, tokenSesion: string, grupo: string,
    periodo: string, programa: string, materia: string, cupo: number): Promise<boolean> {
    if (await JWT.getInstancia().verificarToken(usuario, tokenSesion) !== "Ok")
      return false;

    let query = "";
    if (this.existeGrupo(ORIGEN.MSSQL, periodo, grupo)) {
      query = `IF EXISTS (SELECT * FROM GrupoPlanCompartido WHERE Grupo = '${grupo}' AND Periodo = '${periodo}' AND Programa = '${programa}' AND Materia = '${materia}')
      BEGIN
        UPDATE GrupoPlanCompartido SET Cupo = ${cupo}
        WHERE Grupo = '${grupo}' AND Periodo = '${periodo}' AND Programa = '${programa}' AND Materia = '${materia}'
      END ELSE
      BEGIN
        INSERT INTO GrupoPlanCompartido (Grupo, Periodo, Programa, Materia, Cupo) VALUES ('${grupo}', '${periodo}', '${programa}', '${materia}', ${cupo})
      END 
    `;
      return await db.getInstancia().query(query).then(() => true).catch(() => false);
    }

    return false;

  }

  private numeroSeguro(valor: any, fallback = 0) {
    const numero = Number.parseInt(`${valor ?? fallback}`, 10);
    return Number.isFinite(numero) ? numero : fallback;
  }

  private getOrigenGuardado(origenEntrada?: ORIGEN | string, origenGrupo?: ORIGEN | string) {
    const origen = `${origenEntrada || origenGrupo || ORIGEN.ORACLE}`.toUpperCase();
    if (origen === ORIGEN.MSSQL) {
      return ORIGEN.MSSQL;
    }
    return ORIGEN.ORACLE;
  }

  private async obtenerGrupoHidratado(origen: ORIGEN, periodo: string, clave: string): Promise<Grupo | null> {
    const grupo = await this.getGrupo(origen, periodo, clave, true, origen === ORIGEN.ORACLE);
    if (!grupo) {
      return null;
    }

    grupo.planesCompartidos = await Programas.getInstancia().getGrupoPlanesCompartidos(origen, periodo, clave, true);
    return grupo;
  }

  private normalizaMensajesGrupo(grupo: Grupo) {
    const mensajes = (grupo.mensajes || []).map((mensaje) => ({
      tipo: (mensaje?.tipo || TIPO_MENSAJE.SIN_TIPO) as TIPO_MENSAJE,
      mensaje: Utils.quitarTabs(mensaje?.mensaje || "").trim(),
    }));

    if (grupo.modificadores === undefined && !grupo.discapacidad) {
      return mensajes;
    }

    const codigos = new Set<string>();
    const modificadores = `${grupo.modificadores || ""}`.split("|").map((item) => item.trim()).filter(Boolean);
    for (const modificador of modificadores) {
      codigos.add(Utils.sanitizaTextoSQL(modificador, 20).toUpperCase());
    }
    if (grupo.discapacidad) {
      codigos.add("PB");
    }

    const mensajePlano = codigos.size > 0 ? `|${Array.from(codigos).join("|")}|` : "";
    const indicePlaneacion = mensajes.findIndex((mensaje) => mensaje.tipo === TIPO_MENSAJE.TIPO_PLANEACION);

    if (indicePlaneacion >= 0) {
      mensajes[indicePlaneacion].mensaje = mensajePlano;
    } else if (mensajePlano.length > 0) {
      mensajes.push({
        tipo: TIPO_MENSAJE.TIPO_PLANEACION,
        mensaje: mensajePlano,
      });
    }

    return mensajes;
  }

  private normalizaHorariosGrupo(horarios?: Array<GrupoHorario | any>) {
    return (horarios || [])
      .filter((horario) => horario !== undefined && horario !== null)
      .map((horario) => {
        const espacio =
          `${horario?.claveEspacio || ""}`.trim()
          || `${horario?.espacio || ""}`.trim()
          || `${horario?.espacio?.clave || ""}`.trim()
          || `${horario?.espacio?.descripcion || ""}`.trim();
        const diaSemana = this.normalizaNumeroDiaSemana(horario?.numDiaSemana, horario?.diaSemana);

        return new GrupoHorario(
          `${horario?.plantilla || ""}`.trim(),
          diaSemana,
          espacio,
          `${horario?.horaInicio || ""}`.trim(),
          `${horario?.horaFin || ""}`.trim(),
          `${horario?.diaSemana || ""}`.trim(),
        );
      });
  }

  private normalizaMensajeOracle(tipo?: TIPO_MENSAJE, mensaje?: string) {
    const texto = Utils.sanitizaTextoSQL(mensaje || "", 4000);
    if (tipo !== TIPO_MENSAJE.TIPO_POPUP) {
      return texto;
    }

    if (!this.esBase64Estricto(texto)) {
      return texto;
    }

    try {
      return Utils.sanitizaTextoSQL(Buffer.from(texto, "base64").toString("utf8"), 4000);
    } catch (error) {
      return texto;
    }
  }

  private decodificaPopupEntrada(mensaje?: string) {
    const texto = `${mensaje || ""}`.trim();
    if (!texto || !this.esBase64Estricto(texto)) {
      return texto;
    }

    try {
      const decodificado = Buffer.from(texto, "base64").toString("utf8");
      if (!decodificado || decodificado.includes("\uFFFD")) {
        return texto;
      }
      return decodificado;
    } catch (error) {
      return texto;
    }
  }

  private esBase64Estricto(texto: string) {
    if (texto.length === 0 || texto.length % 4 !== 0) {
      return false;
    }
    return /^[A-Za-z0-9+/]+={0,2}$/.test(texto);
  }

  private normalizaCambiosBitacora(cambiosBitacora: CambioBitacoraGrupo[] = []) {
    return (cambiosBitacora || [])
      .filter((cambio) => cambio !== undefined && cambio !== null)
      .map((cambio) => ({
        cambio: Utils.sanitizaTextoSQL(cambio.cambio || "guardarGrupo", 80),
        campo: Utils.sanitizaTextoSQL(cambio.campo || "", 80),
        valorAnterior: this.textoPlanoBitacora(cambio.valorAnterior),
        valorNuevo: this.textoPlanoBitacora(cambio.valorNuevo),
      }));
  }

  private construyeCambiosBitacoraServidor(
    anterior: Grupo,
    candidato: Grupo,
    origen: ORIGEN = ORIGEN.MSSQL,
  ): CambioBitacoraGrupo[] {
    const cambios: CambioBitacoraGrupo[] = [];
    const agregar = (campo: string, valorAnterior: any, valorNuevo: any) => {
      const anteriorTexto = this.serializaEstadoAuditoria(valorAnterior);
      const nuevoTexto = this.serializaEstadoAuditoria(valorNuevo);
      if (anteriorTexto !== nuevoTexto) {
        cambios.push({
          cambio: "guardarGrupo",
          campo,
          valorAnterior: anteriorTexto,
          valorNuevo: nuevoTexto,
        });
      }
    };

    if (origen === ORIGEN.ORACLE) {
      const estadoAnterior = this.proyectaEstadoOracleParaAuditoria(anterior, anterior);
      const estadoEfectivo = this.proyectaEstadoOracleParaAuditoria(anterior, candidato);
      agregar("tipo", estadoAnterior.tipo, estadoEfectivo.tipo);
      agregar("idioma", estadoAnterior.idioma, estadoEfectivo.idioma);
      agregar("cupoGeneral", estadoAnterior.cupoGeneral, estadoEfectivo.cupoGeneral);
      agregar("cupoPrimerIngreso", estadoAnterior.cupoPrimerIngreso, estadoEfectivo.cupoPrimerIngreso);
      agregar("cupoReingreso", estadoAnterior.cupoReingreso, estadoEfectivo.cupoReingreso);
      agregar("cupoComplementario", estadoAnterior.cupoComplementario, estadoEfectivo.cupoComplementario);
      agregar("cupoMaximo", estadoAnterior.cupoMaximo, estadoEfectivo.cupoMaximo);
      agregar("liberable", estadoAnterior.liberable, estadoEfectivo.liberable);
      agregar("contenido", estadoAnterior.contenido, estadoEfectivo.contenido);
      agregar("profesor", estadoAnterior.profesor, estadoEfectivo.profesor);
      agregar("exigencia", estadoAnterior.exigencia, estadoEfectivo.exigencia);
      agregar("tipoAsistencia", estadoAnterior.tipoAsistencia, estadoEfectivo.tipoAsistencia);
      agregar("horarios", estadoAnterior.horarios, estadoEfectivo.horarios);
      agregar("mensajes", estadoAnterior.mensajes, estadoEfectivo.mensajes);
      agregar("planesCompartidos", estadoAnterior.planesCompartidos, estadoEfectivo.planesCompartidos);
      return cambios;
    }

    agregar("tipo", anterior.tipo, candidato.tipo);
    agregar("idioma", anterior.idioma, candidato.idioma);
    agregar("cupoGeneral", anterior.cupoGeneral, candidato.cupoGeneral);
    agregar("cupoPrimerIngreso", anterior.cupoPrimerIngreso, candidato.cupoPrimerIngreso);
    agregar("cupoReingreso", anterior.cupoReingreso, candidato.cupoReingreso);
    agregar("cupoComplementario", anterior.cupoComplementario, candidato.cupoComplementario);
    agregar("cupoMaximo", anterior.cupoMaximo, candidato.cupoMaximo);
    agregar("alumnosInscritos", anterior.alumnosInscritos, candidato.alumnosInscritos);
    agregar("exportable", anterior.exportable, candidato.exportable);
    agregar("liberable", anterior.liberable, candidato.liberable);
    agregar("fijo", anterior.fijo, candidato.fijo);
    agregar("discapacidad", anterior.discapacidad, candidato.discapacidad);
    agregar("contenido", anterior.contenido, candidato.contenido);
    agregar("materia", anterior.materia?.clave, candidato.materia?.clave);
    agregar("profesor", anterior.profesores?.[0]?.expediente, candidato.profesores?.[0]?.expediente);
    agregar("exigencia", anterior.exigencia?.clave, candidato.exigencia?.clave);
    agregar("tipoAsistencia", anterior.tipoAsistencia?.clave, candidato.tipoAsistencia?.clave);
    agregar("letra", anterior.letra, candidato.letra);
    agregar("materiasAdicionales", (anterior.materiasAdicionales || []).map(m => m?.clave).sort(), (candidato.materiasAdicionales || []).map(m => m?.clave).sort());
    agregar("revisadoPor", [...(anterior.revisadoPor || [])].sort(), [...(candidato.revisadoPor || [])].sort());
    agregar("horarios", this.normalizaHorariosGrupo(anterior.horarios || []), this.normalizaHorariosGrupo(candidato.horarios || []));
    agregar("mensajes", this.normalizaMensajesGrupo(anterior), this.normalizaMensajesGrupo(candidato));
    agregar("planesCompartidos", this.proyectaPlanesAuditoria(anterior.planesCompartidos), this.proyectaPlanesAuditoria(candidato.planesCompartidos));
    return cambios;
  }

  private proyectaEstadoOracleParaAuditoria(anterior: Grupo, candidato: Grupo) {
    return {
      tipo: candidato.tipo || anterior.tipo,
      idioma: candidato.idioma || anterior.idioma,
      cupoGeneral: this.numeroSeguro(candidato.cupoGeneral, anterior.cupoGeneral),
      cupoPrimerIngreso: this.numeroSeguro(candidato.cupoPrimerIngreso, anterior.cupoPrimerIngreso),
      cupoReingreso: this.numeroSeguro(candidato.cupoReingreso, anterior.cupoReingreso),
      cupoComplementario: this.numeroSeguro(candidato.cupoComplementario, anterior.cupoComplementario),
      cupoMaximo: this.numeroSeguro(candidato.cupoMaximo, anterior.cupoMaximo || 999),
      liberable: Boolean(candidato.liberable),
      contenido: candidato.contenido ?? anterior.contenido,
      profesor: candidato.profesores?.[0]?.expediente || "",
      exigencia: this.numeroSeguro(candidato.exigencia?.clave, this.numeroSeguro(anterior.exigencia?.clave, 1)),
      tipoAsistencia: this.numeroSeguro(candidato.tipoAsistencia?.clave, this.numeroSeguro(anterior.tipoAsistencia?.clave, 1)),
      horarios: this.proyectaHorariosAuditoria(candidato.horarios || []),
      mensajes: this.proyectaMensajesOracleAuditoria(candidato),
      planesCompartidos: this.proyectaPlanesAuditoria(candidato.planesCompartidos),
    };
  }

  private proyectaHorariosAuditoria(horarios: Array<any>) {
    return this.normalizaHorariosGrupo(horarios)
      .map(horario => ({
        plantilla: horario.plantilla,
        numDiaSemana: horario.numDiaSemana,
        claveEspacio: horario.claveEspacio,
        horaInicio: horario.horaInicio,
        horaFin: horario.horaFin,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  private proyectaMensajesOracleAuditoria(grupo: Grupo) {
    return this.normalizaMensajesGrupo(grupo)
      .filter(mensaje => mensaje != null && mensaje.tipo !== TIPO_MENSAJE.SIN_TIPO && !!mensaje.mensaje)
      .map(mensaje => ({
        tipo: mensaje.tipo,
        mensaje: this.normalizaMensajeOracle(mensaje.tipo, mensaje.mensaje),
      }))
      .sort((a, b) => `${a.tipo}|${a.mensaje}`.localeCompare(`${b.tipo}|${b.mensaje}`));
  }

  private proyectaPlanesAuditoria(planes?: Array<any>) {
    return (planes || [])
      .map(plan => ({ programa: plan?.programa || "", materia: `${plan?.materia ?? ""}`, cupo: this.numeroSeguro(plan?.cupo) }))
      .sort((a, b) => `${a.programa}|${a.materia}`.localeCompare(`${b.programa}|${b.materia}`));
  }

  private serializaEstadoAuditoria(valor: any): string {
    if (valor === undefined || valor === null) return "";
    if (valor instanceof Date) return valor.toISOString();
    if (Array.isArray(valor)) return JSON.stringify(valor.map(item => this.serializaObjetoAuditoria(item)));
    if (typeof valor === "object") return JSON.stringify(this.serializaObjetoAuditoria(valor));
    return `${valor}`;
  }

  private serializaObjetoAuditoria(valor: any): any {
    if (valor === undefined || valor === null) return valor;
    if (valor instanceof Date) return valor.toISOString();
    if (Array.isArray(valor)) return valor.map(item => this.serializaObjetoAuditoria(item));
    if (typeof valor === "object") {
      return Object.keys(valor).sort().reduce((obj, key) => {
        obj[key] = this.serializaObjetoAuditoria(valor[key]);
        return obj;
      }, {} as Record<string, any>);
    }
    return valor;
  }

  private resumenGuardarGrupo(
    origen: ORIGEN,
    grupo: Grupo,
    cambiosBitacora: CambioBitacoraGrupo[],
    clave: string,
    periodo: string,
  ) {
    return {
      origen,
      clave,
      periodo,
      horarios: grupo?.horarios?.length || 0,
      mensajes: grupo?.mensajes?.length || 0,
      planesCompartidos: grupo?.planesCompartidos?.length || 0,
      cambiosBitacora: this.normalizaCambiosBitacora(cambiosBitacora),
    };
  }

  private textoPlanoBitacora(valor: any) {
    const texto = valor === undefined || valor === null ? "" : `${valor}`;
    const limpio = Utils.sanitizaTextoSQL(texto, 300);
    return limpio.length > 300 ? limpio.substring(0, 290) + " (mas)" : limpio;
  }

  private usuarioBitacora(usuario?: string) {
    return Utils.sanitizaTextoSQL((usuario || "").trim() || "SIN_USUARIO", 60);
  }

  private queryInsertBitacoraMSSQL(origen: ORIGEN, usuario: string, grupo: string, periodo: string, cambio: CambioBitacoraNormalizado) {
    return `INSERT INTO BitacoraSIPLE (Usuario, Grupo, Periodo, Origen, Fecha, Cambio, Campo, ValorAnterior, ValorNuevo)
      VALUES ('${this.usuarioBitacora(usuario)}', '${grupo}', '${periodo}', '${origen}', GETDATE(), '${cambio.cambio}', '${cambio.campo}', '${cambio.valorAnterior}', '${cambio.valorNuevo}')`;
  }

  private tipoGrupoIdOracle(tipoGrupo: string, cupoPrimerIngreso: number) {
    const tipo = (tipoGrupo || "").toUpperCase();
    if (tipo.startsWith("PRIMER") || cupoPrimerIngreso > 0) {
      return 2;
    }
    return 1;
  }

  private async oracleQuerySimpleIntTx(connection: any, query: string) {
    const resultado = await connection.execute(Utils.quitarTabs(query));
    const fila = resultado?.rows?.[0];
    if (!fila) {
      return 0;
    }

    const llave = Object.keys(fila)[0];
    const valor = fila[llave];
    const numero = Number.parseInt(`${valor ?? 0}`, 10);
    return Number.isFinite(numero) ? numero : 0;
  }

  private normalizaHoraMSSQL(hora?: string) {
    const valor = (hora || "").trim();
    if (valor.length === 0) {
      return "00:00";
    }

    const partes = valor.split(":");
    const horas = this.numeroSeguro(partes[0], 0).toString().padStart(2, "0");
    const minutos = this.numeroSeguro(partes[1], 0).toString().padStart(2, "0");
    return `${horas}:${minutos}`;
  }

  private normalizaNumeroDiaSemana(valor: any, diaSemana?: string) {
    const numero = this.numeroSeguro(valor, 0);
    if (numero >= 1 && numero <= 7) {
      return numero;
    }

    const texto = `${diaSemana || ""}`.trim().toUpperCase();
    if (texto.startsWith("LU")) return 1;
    if (texto.startsWith("MA")) return 2;
    if (texto.startsWith("MI")) return 3;
    if (texto.startsWith("JU")) return 4;
    if (texto.startsWith("VI")) return 5;
    if (texto.startsWith("SA")) return 6;
    if (texto.startsWith("DO")) return 7;
    return 0;
  }

  private tipoMensajeMSSQL(tipo?: TIPO_MENSAJE) {
    switch (tipo) {
      case TIPO_MENSAJE.TIPO_PLANEACION:
        return TIPO_MENSAJE_INT.TIPO_PLANEACION;
      case TIPO_MENSAJE.TIPO_INSCRIPCION:
        return TIPO_MENSAJE_INT.TIPO_INSCRIPCION;
      case TIPO_MENSAJE.TIPO_POPUP:
        return TIPO_MENSAJE_INT.TIPO_POPUP;
      case TIPO_MENSAJE.TIPO_TIPOGRUPO:
        return TIPO_MENSAJE_INT.TIPO_TIPOGRUPO;
      default:
        return TIPO_MENSAJE_INT.SIN_TIPO;
    }
  }

  async actualizarFechaModificacionGrupo(periodo: string, grupo: string) {
    let query = `UPDATE GRUPO SET FechaModificacion = GETDATE() WHERE Periodo = '${periodo}' AND Clave = '${grupo}' `;
    return db.getInstancia().querySinResultados(query);
  }

  async getModificadoresGrupo(forzarLectura = false): Promise<ModificadoresGrupo[]> {
    if (this.modificadoresGrupo && !forzarLectura)
      return this.modificadoresGrupo;

    let query = `SELECT * from ModificadoresGrupo `;
    this.modificadoresGrupo = await db.getInstancia().queryTabla(query) as ModificadoresGrupo[];
    return this.modificadoresGrupo;
  }

  async getInfoGrupoByReservaID(ReservaID: string): Promise<IInfoGrupoX> {
    let query = `SELECT G.ID AS grupo_id, G.CODIGO AS grupo, M.CODIGO AS clavemateria, M.NOMBRE AS nombremateria, M.creditos, NA.NOMBRE AS nivelacademico, ART.CODIGO AS departamento, CC.NOMBRE AS periodo
        FROM S_GRUPO             G,
            S_GRUPOMATEAREAPLAN GAP,
            S_MATEAREAPLAN      AP,
            S_MATERIA           M,
            S_PERIODOESCOLAR    P,
            S_NIVELACADEMICO    NA,
            S_AREATRABAJO       ART,
            S_CICLO             CC,
            S_ESPACIORESERVADO  R
      WHERE G.ID = GAP.Grupo_ID
        AND GAP.MateAreaPlan_ID = AP.ID
        AND AP.Materia_ID = M.ID
        AND P.CICLO_ID = CC.ID
        AND M.AreaTrabajo_ID = ART.ID
        and m.nivelacademico_id = na.id
        AND G.Periodoescolar_id = P.ID
        AND G.ID = R.GRUPO_ID
        AND R.ID = ${ReservaID}`;

    try {
      return await oracle.getInstancia().query(query);
    } catch (error) {
      throw error;
    }

  }

  async revisarGrupoPlaneacion(periodo: string, grupo: string, quienVerifica: string, forzarRevisado?: boolean): Promise<boolean> {
    // periodo = Utils.sanitizaTextoSQL(periodo);
    // grupo = Utils.sanitizaTextoSQL(grupo);
    // quienVerifica = Utils.sanitizaTextoSQL(quienVerifica);
    const revisadoPorAnterior = await db.getInstancia().querySimpleArray(
      `SELECT TOP 1 Programa FROM GrupoRevisado WHERE Periodo = '${periodo}' AND Grupo = '${grupo}'`
    );
    let verificar = revisadoPorAnterior.length == 0;

    const valorAnterior = revisadoPorAnterior.length > 0 ? 'Revisado' : 'No Revisado';

    if (forzarRevisado !== undefined) {
      verificar = forzarRevisado;
    }
    const valorNuevo = verificar ? 'Revisado' : 'No Revisado';

    const sentencias = [
      `DELETE FROM GrupoRevisado WHERE Periodo = '${periodo}' AND Grupo = '${grupo}'`
    ];

    if (verificar) {
      sentencias.push(
        `INSERT INTO GrupoRevisado (Periodo, Grupo, Programa, Confirmado) VALUES ('${periodo}', '${grupo}', '${quienVerifica}', 1)`
      );
    }

    const query = `
      BEGIN TRY
        BEGIN TRANSACTION
        ${sentencias.join("\n")}
        COMMIT TRANSACTION
      END TRY
      BEGIN CATCH
        IF @@TRANCOUNT > 0
          ROLLBACK TRANSACTION
        THROW
      END CATCH
    `;

    try {
      await db.getInstancia().querySinResultados(query);
      await Log.getInstancia().guardarBitacora({
        origen: ORIGEN.MSSQL,
        usuario: quienVerifica,
        grupo: grupo,
        periodo: periodo,
        secuencia: -1,
        cambio: "GrupoRevisado",
        campo: "",
        valorAnterior,
        valorNuevo,
      });
      return verificar;
    } catch (error) {
      throw error;
    }
  }

  static getInstancia(): Grupos {
    if (!Grupos.instancia) {
      Utils.Mensaje(CONSOLA.DATA, "Se construye Clase Grupos");
      Grupos.instancia = new Grupos();
    }
    return Grupos.instancia;
  }
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

export interface CambioBitacoraGrupo {
  cambio?: string,
  campo?: string,
  valorAnterior?: string,
  valorNuevo?: string,
}

interface CambioBitacoraNormalizado {
  cambio: string,
  campo: string,
  valorAnterior: string,
  valorNuevo: string,
}
