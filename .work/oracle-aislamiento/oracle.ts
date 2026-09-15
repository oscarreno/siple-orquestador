import OracleDB from "./oracledbCompat";
import { TipoFoto } from "../modelos/TipoFoto";
import Utils, { CONSOLA } from "./utils";
import { promises as fs } from 'fs';
import UtilsFechas from "./utilsFechas";

// Clase para manejar ORACLE

export default class Oracle {
  private static instancia: Oracle;
  private conn: any;
  private poolPromise?: Promise<any>;
  private connectionPromise?: Promise<any>;
  private mostrarConsola: boolean = process.env.MOSTRAR_CONSOLA_SQL == 'SI' || false;

  private constructor() { }

  private getMissingConfig() {
    const missing: string[] = [];
    if (!process.env.NODE_ORACLEDB_CONNECTIONSTRING) {
      missing.push("NODE_ORACLEDB_CONNECTIONSTRING");
    }

    const externalAuth = process.env.NODE_ORACLEDB_EXTERNALAUTH ? true : false;
    if (!externalAuth && !process.env.NODE_ORACLEDB_USER) {
      missing.push("NODE_ORACLEDB_USER");
    }

    return missing;
  }

  private async connect() {
    if (this.conn) return this.conn;
    if (!this.connectionPromise) {
      this.connectionPromise = this.acquireConnection().then(connection => {
        this.conn = connection;
        return connection;
      }).catch(error => {
        this.connectionPromise = undefined;
        throw error;
      });
    }
    return this.connectionPromise;
  }

  private async acquireConnection() {
    const pool = await this.getPool();
    return pool.getConnection({
      user: process.env.NODE_ORACLEDB_USER || "",
      password: process.env.NODE_ORACLEDB_PASSWORD || "",
    });
  }

  private getPool(): Promise<any> {
    if (!this.poolPromise) {
      this.poolPromise = this.createPool().catch(error => {
        this.poolPromise = undefined;
        throw error;
      });
    }
    return this.poolPromise;
  }

  private async createPool() {

    const missing = this.getMissingConfig();
    if (missing.length > 0) {
      throw new Error(`Falta configuracion ORACLE: ${missing.join(", ")}`);
    }

    const dbConfigOracle = {
      user: process.env.NODE_ORACLEDB_USER || "",
      password: process.env.NODE_ORACLEDB_PASSWORD || "",
      connectString: process.env.NODE_ORACLEDB_CONNECTIONSTRING || "",
      externalAuth: process.env.NODE_ORACLEDB_EXTERNALAUTH ? true : false,
      poolIncrement: 0,
      poolMax: 5,
      poolMin: 5,
      homogeneous: false,
      options: {
        trustServerCertificate: true
    }
    };

    let pool;

    try {
      Utils.Mensaje(CONSOLA.INFO, "Se abre conexión a ORACLE");
      OracleDB.outFormat = OracleDB.OUT_FORMAT_OBJECT;
      pool = await OracleDB.createPool(dbConfigOracle);
    } catch (err) {
      Utils.Mensaje(CONSOLA.ERROR, err);
      throw err;
    }

    return pool;
  }

  async ensureConnected() {
    try {
      await this.connect();
      Utils.Mensaje(CONSOLA.INFO, "Conexion ORACLE lista");
      return true;
    } catch (error: any) {
      Utils.Mensaje(CONSOLA.WARNING, `ORACLE no disponible al iniciar: ${error?.message || error}`);
      return false;
    }
  }

  async query(query: string) {
    query = Utils.quitarTabs(query);
    try {
      let con = await this.connect();
      if (con == undefined) con = await this.connect();
      if (this.mostrarConsola) Utils.Mensaje(CONSOLA.PROCESO, `query ORACLE: ${query}`);
      if (!this.conn)
        this.connect();
      let resultado = await con.execute(query);
      let res = resultado.rows[0];
      res = this.arreglaObjeto(res);
      return res;
    } catch (error) {
      //Utils.Mensaje(CONSOLA.ERROR, error);
      throw error;
    }
  }

  async querySimpleInt(query: string): Promise<number> {
    query = Utils.quitarTabs(query);
    try {
      let con = await this.connect();
      if (con == undefined) con = await this.connect();
      if (this.mostrarConsola) Utils.Mensaje(CONSOLA.PROCESO, `querySimpleInt ORACLE: ${query}`);

      if (!this.conn)
        this.connect();
      let resultado = await con.execute(query);
      let res = resultado.rows[0];
      //console.log("AA", res[Object.keys(res)[0]]);


      let parsed = parseInt(res[Object.keys(res)[0]]);
      if (isNaN(parsed)) { return 0; }
      return parsed;
    } catch (error) {
      return 0;
    }
  }

  async querySinResultados(query: string) {
    let con = await this.connect();
    if (con == undefined) con = await this.connect();
    if (this.mostrarConsola) Utils.Mensaje(CONSOLA.PROCESO, `querySinResultados ORACLE: ${query}`);

    if (!this.conn)
      this.connect();
    let resultado = await con.execute(query);
    //console.log("QuerySinRes", query, resultado);
  }

  async withTransaction<T>(work: (connection: any) => Promise<T>): Promise<T> {
    // Esta conexión pertenece únicamente al callback; nunca se publica en conn.
    const con = await this.acquireConnection();

    try {
      const resultado = await work(con);
      await con.commit();
      return resultado;
    } catch (error) {
      try {
        await con.rollback();
      } catch (rollbackError) {
        Utils.Mensaje(CONSOLA.ERROR, rollbackError);
      }
      throw error;
    } finally {
      try {
        await con.close();
      } catch (closeError) {
        // Un fallo al liberar no convierte un commit confirmado en un rechazo.
        Utils.Mensaje(CONSOLA.WARNING, closeError);
      }
    }
  }

  async querySimpleArray(query: string): Promise<Array<string>> {
    query = Utils.quitarTabs(query);
    let arreglo: string[] = [];

    let data = [];
    let valor = "";

    try {
      const con = await this.connect();
      if (con != null) {
        if (this.mostrarConsola) Utils.Mensaje(CONSOLA.PROCESO, `querySimpleArray ORACLE: ${query}`);

        if (!this.conn)
          this.connect();
        const resultado = await con.execute(query);

        for (let i = 0; i < resultado.rows.length; i++) {
          data = resultado.rows[i];
          if (data) {
            valor = data[Object.keys(data)[0]];
            if (valor !== null && valor.length > 0) valor = valor.trim();
            arreglo.push(valor);
          }
        }
      }
    } catch (error) {
      //Utils.Mensaje(CONSOLA.ERROR, error);
      throw error;
    }
    return arreglo;
  }

  async queryTabla(query: string): Promise<any> {
    query = Utils.quitarTabs(query);
    let arreglo: Object[] = [];
    let data = [];
    const con = await this.connect();
    if (this.mostrarConsola) Utils.Mensaje(CONSOLA.PROCESO, `queryTabla ORACLE: ${query}`);

    if (!this.conn)
      this.connect();
    const resultado = await con.execute(query);
    for (let i = 0; i < resultado.rows.length; i++) {
      let objeto = resultado.rows[i];
      objeto = this.arreglaObjeto(objeto);
      arreglo.push(objeto);
    }
    return arreglo;
  }

  async queryTablaParams(query: string, params: Record<string, unknown>): Promise<any> {
    query = Utils.quitarTabs(query);
    let arreglo: Object[] = [];
    const con = await this.connect();
    if (this.mostrarConsola) Utils.Mensaje(CONSOLA.PROCESO, `queryTablaParams ORACLE: ${query}`);

    if (!this.conn)
      this.connect();
    const resultado = await con.execute(query, params || {});
    for (let i = 0; i < resultado.rows.length; i++) {
      let objeto = resultado.rows[i];
      objeto = this.arreglaObjeto(objeto);
      arreglo.push(objeto);
    }
    return arreglo;
  }



  async ejecutaRetorno(procedimiento: string, parametros: IParametro[]) {

    try {
      let params = "";
      let valores = new Map();

      for (let i = 0; i < parametros.length; i++) {
        const p = parametros[i];
        params += ":" + p.argumento + ", ";
        let detalle = new Map();
        if (p.tipo)
          detalle.set("type", p.tipo);
        if (p.dir)
          detalle.set("dir", p.dir);
        else
          detalle.set("val", p.valor);

        const det = Object.fromEntries(detalle);
        valores.set(p.argumento, det);
      }
      params = params.substring(0, params.length - 2);

      let p = `BEGIN
          ${procedimiento}(${params});
        END;`;

      //console.log(p, valores);

      if (!this.conn)
        this.connect();
      const result = await this.conn.execute(p, Object.fromEntries(valores));

      console.log(result.outBinds);

    } catch (err) {
      console.error(err);
      return false;
    }
    return true;
  }

  async ejecuta(procedimiento: string, parametros: IParametro[]) {

    try {
      let params = "";
      let valores = new Array();

      for (let i = 0; i < parametros.length; i++) {
        const p = parametros[i];
        params += ":" + p.argumento + ", ";
        valores.push(p.valor);
      }
      params = params.substring(0, params.length - 2);

      let p = `BEGIN
          ${procedimiento}(${params});
        END;`;

      // console.log(p, valores);
      if (!this.conn)
        this.connect();
      const result = await this.conn.execute(p, valores);

      // console.log(result);

    } catch (err) {
      console.error(err);
      return false;
    }
    return true;
  }


  arreglaObjeto(objeto: any) {
    if (!objeto) return objeto;
    try {
      const registro: any = {};
      for (const key in objeto) {
        let valor = objeto[key];
        const tipo = typeof valor;
        const llave = key.toLowerCase();

        if (valor === null) {
          registro[llave] = null;
        } else if (tipo === "object") {
          const esFecha = Utils.getValorCampoFecha(valor);
          if (esFecha) {
            UtilsFechas.arreglaDateUTC(esFecha);
            registro[llave] = esFecha.toJSON();
          } else {
            registro[llave] = valor;
          }
        } else if (tipo === "string") {
          valor = valor.trim();
          if (valor == "null") {
            registro[llave] = null;
          } else {
            registro[llave] = Utils.quitarTabs(valor);
          }
        } else {
          registro[llave] = valor;
        }
      }

      return registro;
    } catch (error) {
      console.log(objeto);
      throw error;
    }
  }

  private formatearNombre(s: string) {
    if (typeof s !== "string") return "";
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  async guardarFoto(tipo: TipoFoto, expediente: string, ruta: string) {
    let query = '';
    switch (tipo) {
      case TipoFoto.USUARIO:
        query = `SELECT P.foto FROM ORACLEDBA.PERSONA P, ORACLEDBA.ADCUENTA A WHERE P.Id = A.Persona_ID AND A.UserName = '${expediente}'`;
        break;
      case TipoFoto.ALUMNO:
        query = `SELECT fotografia FROM ORACLEDBA.V_SIPF1_ALUMNO WHERE EXPEDIENTE = '${expediente.replace('f', '')}'`;
        break;
      case TipoFoto.PROFESOR:
        query = `SELECT foto FROM ORACLEDBA.PERSONA P WHERE P.EXPEMPLEADO = '${expediente.replace('f', '')}'`;
        break;

      default:
        break;
    }

    OracleDB.fetchAsBuffer = [OracleDB.BLOB];

    const con = await this.connect();
    if (this.mostrarConsola) Utils.Mensaje(CONSOLA.PROCESO, `query ORACLE GUARDANDO FOTO: ${query}`);

    if (!this.conn)
      this.connect();
    const resultado = await con.execute(query);

    if (!resultado)
      return false;

    try {
      let objeto = resultado.rows[0];
      if (objeto) {
        let foto = objeto.FOTO;
        if (tipo === TipoFoto.ALUMNO)
          foto = objeto.FOTOGRAFIA;

        if (foto) {
          const fotoBuffer = Buffer.isBuffer(foto) ? foto : Buffer.from(foto || []);
          if (fotoBuffer.length === 0) {
            Utils.Mensaje(CONSOLA.WARNING, `Foto ORACLE vacia ${tipo} > ${expediente}`);
            return false;
          }

          await fs.writeFile(`${ruta}/${expediente}.jpg`, fotoBuffer);
          Utils.Mensaje(CONSOLA.PROCESO, `Creada foto ${tipo} > ${expediente}`);
          return true;
        }
      }
    } catch (error) {
      Utils.Mensaje(CONSOLA.ERROR_SIN_TRACE, "Foto NO guardada " + expediente + " " + error);
      return false;
    }

  }

  static getInstancia(): Oracle {
    if (!Oracle.instancia) {
      Oracle.instancia = new Oracle();
    }
    return Oracle.instancia;
  }
}

export interface IParametro {
  argumento: string,
  valor: any,
  tipo?: number,
  dir?: number
}

