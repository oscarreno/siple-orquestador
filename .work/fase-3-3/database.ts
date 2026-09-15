//import { renameType } from "graphql-tools";
import * as sql from "mssql";
import Utils, { CONSOLA } from "./utils";
import UtilsFechas, { FORMATO_FECHA } from "./utilsFechas";

// Clase para manejar MSSQL

export enum ORIGEN {
  MSSQL = "MSSQL",
  ORACLE = "ORACLE",
}

export default class Database {
  private static instancia: Database;
  private conn: any;
  private conexionEnCurso: Promise<any> | undefined;
  private mostrarConsola: boolean = process.env.MOSTRAR_CONSOLA_SQL == 'SI' || false;
  private consultasActivas = 0;
  private colaConsultas: Array<() => void> = [];
  private ultimoAvisoColaSaturada = 0;

  private constructor() {}

  private envEsSi(nombre: string, valorPorDefecto = false) {
    const valor = process.env[nombre];
    if (!valor) return valorPorDefecto;
    return valor.trim().toUpperCase() === "SI";
  }

  private envNumero(nombre: string, valorPorDefecto: number) {
    const valor = Number.parseInt(`${process.env[nombre] || ""}`.trim(), 10);
    return Number.isFinite(valor) ? valor : valorPorDefecto;
  }

  private getMaxConsultasAplicacion() {
    const maxPool = Math.max(1, this.envNumero("SQL_POOL_MAX", 30));
    const maxAplicacion = this.envNumero("SQL_APP_MAX_CONCURRENCY", Math.min(maxPool, 15));
    return Math.max(1, Math.min(maxPool, maxAplicacion));
  }

  private getMaxPendientesAplicacion() {
    return Math.max(0, this.envNumero("SQL_APP_MAX_PENDING", 150));
  }

  private getTimeoutColaAplicacion() {
    return Math.max(1000, this.envNumero("SQL_APP_QUEUE_TIMEOUT_MS", 10000));
  }

  private getAppQueueStats() {
    return {
      active: this.consultasActivas,
      pending: this.colaConsultas.length,
      maxConcurrency: this.getMaxConsultasAplicacion(),
      maxPending: this.getMaxPendientesAplicacion(),
      timeoutMs: this.getTimeoutColaAplicacion(),
    };
  }

  private crearErrorColaSaturada() {
    const error: any = new Error("MSSQL ocupado: se alcanzó el límite de solicitudes en espera");
    error.code = "MSSQL_QUEUE_FULL";
    error.statusCode = 503;
    return error;
  }

  private esColaSaturada(error: any) {
    return error?.code === "MSSQL_QUEUE_FULL";
  }

  private registrarErrorConsulta(query: string, error: any) {
    if (this.esColaSaturada(error)) {
      const ahora = Date.now();
      if (ahora - this.ultimoAvisoColaSaturada >= 5000) {
        this.ultimoAvisoColaSaturada = ahora;
        Utils.Mensaje(
          CONSOLA.WARNING,
          `[mssql] solicitud rechazada por cola saturada | query=${query.substring(0, 300)}`
        );
      }
      return;
    }

    Utils.Mensaje(CONSOLA.ERROR_SIN_TRACE, query);
    Utils.Mensaje(CONSOLA.ERROR, error);
  }

  private drenarColaConsultas() {
    while (this.consultasActivas < this.getMaxConsultasAplicacion() && this.colaConsultas.length > 0) {
      const siguiente = this.colaConsultas.shift();
      if (siguiente)
        siguiente();
    }
  }

  private ejecutarConCupo<T>(trabajo: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let esperando = true;
      let temporizador: ReturnType<typeof setTimeout> | undefined;
      let ejecutar: () => void;

      ejecutar = () => {
        if (!esperando)
          return;

        esperando = false;
        if (temporizador)
          clearTimeout(temporizador);
        this.consultasActivas++;
        trabajo()
          .then(resolve, reject)
          .finally(() => {
            this.consultasActivas--;
            this.drenarColaConsultas();
          });
      };

      if (this.consultasActivas < this.getMaxConsultasAplicacion()) {
        ejecutar();
        return;
      }

      if (this.colaConsultas.length >= this.getMaxPendientesAplicacion()) {
        reject(this.crearErrorColaSaturada());
        return;
      }

      this.colaConsultas.push(ejecutar);
      temporizador = setTimeout(() => {
        if (!esperando)
          return;

        esperando = false;
        const indice = this.colaConsultas.indexOf(ejecutar);
        if (indice >= 0)
          this.colaConsultas.splice(indice, 1);
        reject(this.crearErrorColaSaturada());
      }, this.getTimeoutColaAplicacion());
    });
  }

  private getMissingConfig() {
    const missing: string[] = [];
    if (!process.env.SQL_SERVER) missing.push("SQL_SERVER");
    if (!process.env.SQL_DATABASE) missing.push("SQL_DATABASE");
    if (!process.env.SQL_USER) missing.push("SQL_USER");
    return missing;
  }

  private async connect() {
    if (this.conn) return this.conn;

    if (!this.conexionEnCurso) {
      this.conexionEnCurso = this.crearConexion().finally(() => {
        this.conexionEnCurso = undefined;
      });
    }

    return await this.conexionEnCurso;
  }

  private async crearConexion() {
    if (this.conn) return this.conn;

    const missing = this.getMissingConfig();
    if (missing.length > 0) {
      throw new Error(`Falta configuracion MSSQL: ${missing.join(", ")}`);
    }

    const encrypt = this.envEsSi("SQL_ENCRYPT");
    const trustServerCertificate = this.envEsSi("SQL_TRUST_SERVER_CERTIFICATE", true);
    const options: any = {
      encrypt,
      enableArithAbort: true,
      trustServerCertificate,
    };

    const tlsMinVersion = process.env.SQL_TLS_MIN_VERSION;
    if (encrypt && tlsMinVersion) {
      options.cryptoCredentialsDetails = {
        minVersion: tlsMinVersion as "TLSv1" | "TLSv1.1" | "TLSv1.2" | "TLSv1.3",
      };
    }

    const poolMin = this.envNumero("SQL_POOL_MIN", 5);
    const poolMax = this.envNumero("SQL_POOL_MAX", 30);
    const idleTimeoutMillis = this.envNumero("SQL_POOL_IDLE_TIMEOUT_MS", 30000);
    const acquireTimeoutMillis = this.envNumero("SQL_POOL_ACQUIRE_TIMEOUT_MS", 120000);
    const createTimeoutMillis = this.envNumero("SQL_POOL_CREATE_TIMEOUT_MS", 30000);
    const createRetryIntervalMillis = this.envNumero("SQL_POOL_CREATE_RETRY_INTERVAL_MS", 200);
    const reapIntervalMillis = this.envNumero("SQL_POOL_REAP_INTERVAL_MS", 1000);
    const connectionTimeout = this.envNumero("SQL_CONNECTION_TIMEOUT_MS", 300000);
    const requestTimeout = this.envNumero("SQL_REQUEST_TIMEOUT_MS", 300000);

    const pool: any = {
      min: poolMin,
      max: poolMax,
      idleTimeoutMillis,
      acquireTimeoutMillis,
      createTimeoutMillis,
      createRetryIntervalMillis,
      reapIntervalMillis,
    };

    const config: sql.config = {
      user: process.env.SQL_USER || "",
      password: process.env.SQL_PASSWORD || "",
      database: process.env.SQL_DATABASE || "",
      server: process.env.SQL_SERVER || "",
      options,
      pool,
      connectionTimeout,
      requestTimeout,
    };
  //   mssql.connect({
  //     user: "this.user",
  //     password: "this.password",
  //     server: "this.server",
  //     database: "this.database",
  //     options: {
  //         cryptoCredentialsDetails: {
  //             minVersion: 'TLSv1'
  //         }
  //     }
  // });    
    const dbPool = new sql.ConnectionPool(config);
    this.conn = await dbPool.connect() as sql.ConnectionPool;
    Utils.Mensaje(CONSOLA.INFO, `[mssql] pool conectado | ${JSON.stringify(this.getPoolStats())}`);
    return this.conn;
  }

  private getPoolStats() {
    const con: any = this.conn;
    if (!con) {
      return { connected: false };
    }

    return {
      connected: true,
      size: typeof con.size === "number" ? con.size : undefined,
      available: typeof con.available === "number" ? con.available : undefined,
      pending: typeof con.pending === "number" ? con.pending : undefined,
      borrowed: typeof con.borrowed === "number" ? con.borrowed : undefined,
      appQueue: this.getAppQueueStats(),
    };
  }

  /** Estadisticas seguras para la telemetria del proceso; no expone credenciales. */
  getRuntimeStats() {
    return this.getPoolStats();
  }

  private describeError(error: any) {
    return `${error?.message || error || "error-desconocido"}`;
  }

  private esTimeoutPool(error: any) {
    const mensaje = this.describeError(error).toLowerCase();
    return mensaje.includes("operation timed out")
      || mensaje.includes("timeout")
      || mensaje.includes("timed out");
  }

  private async ejecutarConTelemetria<T>(operacion: string, query: string, trabajo: () => Promise<T>) {
    const inicio = Date.now();
    let esperaColaMs = 0;
    let inicioTrabajo = inicio;

    try {
      const resultado = await this.ejecutarConCupo(async () => {
        inicioTrabajo = Date.now();
        esperaColaMs = inicioTrabajo - inicio;
        return await trabajo();
      });
      const duracion = Date.now() - inicio;
      const umbralLento = this.envNumero("SQL_SLOW_QUERY_MS", 5000);
      if (duracion >= umbralLento) {
        const umbralWarning = this.envNumero("SQL_WARNING_QUERY_MS", 10000);
        const umbralCritico = this.envNumero("SQL_CRITICAL_QUERY_MS", 30000);
        const esperaCritica = esperaColaMs >= umbralCritico;
        const esperaDegradada = esperaColaMs >= umbralLento;
        const critica = duracion >= umbralCritico || esperaCritica;
        const degradada = duracion >= umbralWarning || esperaDegradada;
        const nivel = critica
          ? CONSOLA.ERROR_SIN_TRACE
          : degradada ? CONSOLA.WARNING : CONSOLA.INFO;
        const etiqueta = critica
          ? "query critica"
          : degradada ? "query lenta" : "query lenta transitoria";
        Utils.Mensaje(
          nivel,
          `[mssql] ${etiqueta} | ${JSON.stringify({ operacion, duracionMs: duracion, esperaColaMs, duracionTrabajoMs: duracion - esperaColaMs, pool: this.getPoolStats(), query: query.substring(0, 300) })}`
        );
      }
      return resultado;
    } catch (error) {
      const duracion = Date.now() - inicio;
      const detalle = {
        operacion,
        duracionMs: duracion,
        esperaColaMs,
        duracionTrabajoMs: inicioTrabajo === inicio ? 0 : duracion - esperaColaMs,
        pool: this.getPoolStats(),
        error: this.describeError(error),
        query: query.substring(0, 300),
      };

      if (this.esTimeoutPool(error)) {
        Utils.Mensaje(CONSOLA.WARNING, `[mssql] timeout de pool | ${JSON.stringify(detalle)}`);
      }

      throw error;
    }
  }

  async ensureConnected() {
    try {
      await this.connect();
      Utils.Mensaje(CONSOLA.INFO, "Conexion MSSQL lista");
      return true;
    } catch (error: any) {
      Utils.Mensaje(CONSOLA.WARNING, `MSSQL no disponible al iniciar: ${error?.message || error}`);
      return false;
    }
  }

  async querySinResultados(query: string) {
    query = Utils.quitarTabs(query);
    if (this.mostrarConsola) Utils.Mensaje(CONSOLA.PROCESO, `querySinResultados: ${query}`);
    try {
      return await this.ejecutarConTelemetria("querySinResultados", query, async () => {
        const con = await this.connect();
        await con.query(query);
        return true;
      });
    } catch (error) {
      this.registrarErrorConsulta(query, error);
      throw error;
    }
  }
  async query(query: string, formatoFecha=FORMATO_FECHA.FECHA_HORA_CORTA) {
    query = Utils.quitarTabs(query);
    if (this.mostrarConsola) Utils.Mensaje(CONSOLA.PROCESO, `ejecutaQuery: ${query}`);
    try {
      return await this.ejecutarConTelemetria("query", query, async () => {
        const con = await this.connect();
        let res = await con.query(query);
        if (res.recordset)
          res = this.arreglaObjeto(res.recordset[0], formatoFecha);

        return res;
      });
    } catch (error) {
      this.registrarErrorConsulta(query, error);
      throw error;
    }
  }

  async queryNumber(query: string) {
    try {
      let a = await this.querySimpleArray(query);
      return new Number(a[0]).valueOf();
    } catch (error) {
      return 0;
    }
  }

  async querySimpleArray(query: string): Promise<Array<string>> {
    let arreglo: string[] = [];
    if (query?.length > 0) {
      query = Utils.quitarTabs(query);

      let data = [];
      let valor = "";

      if (this.mostrarConsola) Utils.Mensaje(CONSOLA.PROCESO, `QuerySimpleArray: ${query}`);
      try {
        await this.ejecutarConTelemetria("querySimpleArray", query, async () => {
          const con = await this.connect();
          const resultado = await con.query(query);

          if (!resultado.recordset)
            Utils.Mensaje(CONSOLA.ERROR, "NO SE TUVO RESULTADO" + query);
          else
          for (let i = 0; i < resultado.recordset.length; i++) {
            data = resultado.recordset[i];
            if (data) {
              valor = data[Object.keys(data)[0]];
              if (valor.length > 0) valor = valor.trim();
              arreglo.push(valor);
            }
          }
        });
      } catch (error) {
        this.registrarErrorConsulta(query, error);
        throw error;
      }
    }
    return arreglo;
  }

  async queryTabla(query: string, formatoFecha=FORMATO_FECHA.FECHA_HORA_CORTA) {
    query = Utils.quitarTabs(query);
    let arreglo: Object[] = [];
    let data = [];

    if (this.mostrarConsola) Utils.Mensaje(CONSOLA.PROCESO, `queryTabla: ${query}`);

    try {
      await this.ejecutarConTelemetria("queryTabla", query, async () => {
        const con = await this.connect();
        const resultado = await con.query(query);

        if (!resultado || !resultado.recordset) return;

        for (let i = 0; i < resultado.recordset.length; i++) {
          data = resultado.recordset[i];
          data = this.arreglaObjeto(data, formatoFecha);
          arreglo.push(data);
        }
      });
    } catch (error) {
      this.registrarErrorConsulta(query, error);
      throw error; 
    }
    return arreglo;
  }

  async querySinResultadosParams(query: string, params: Record<string, unknown>) {
    query = Utils.quitarTabs(query);
    if (this.mostrarConsola) Utils.Mensaje(CONSOLA.PROCESO, `querySinResultadosParams: ${query}`);
    try {
      return await this.ejecutarConTelemetria("querySinResultadosParams", query, async () => {
        const con = await this.connect();
        const request = con.request();

        for (const [nombre, valor] of Object.entries(params || {})) {
          request.input(nombre, valor as any);
        }

        await request.query(query);
        return true;
      });
    } catch (error) {
      this.registrarErrorConsulta(query, error);
      throw error;
    }
  }

  async queryTablaParams(query: string, params: Record<string, unknown>, formatoFecha=FORMATO_FECHA.FECHA_HORA_CORTA) {
    query = Utils.quitarTabs(query);
    let arreglo: Object[] = [];
    let data = [];

    if (this.mostrarConsola) Utils.Mensaje(CONSOLA.PROCESO, `queryTablaParams: ${query}`);

    try {
      await this.ejecutarConTelemetria("queryTablaParams", query, async () => {
        const con = await this.connect();
        const request = con.request();

        for (const [nombre, valor] of Object.entries(params || {})) {
          request.input(nombre, valor as any);
        }

        const resultado = await request.query(query);

        if (!resultado || !resultado.recordset) return;

        for (let i = 0; i < resultado.recordset.length; i++) {
          data = resultado.recordset[i];
          data = this.arreglaObjeto(data, formatoFecha);
          arreglo.push(data);
        }
      });
    } catch (error) {
      this.registrarErrorConsulta(query, error);
      throw error;
    }

    return arreglo;
  }

  arreglaObjeto(objeto: any, formatoFecha=FORMATO_FECHA.FECHA_HORA_CORTA) {
    if (!objeto) return objeto;
    
    try {
      const registro: any = {};
      for (const key in objeto) {
        let valor = objeto[key];
        let nombreCampo = key.toLowerCase();

        if (nombreCampo === "clave") {
          valor = valor.toString();
        }

        if (valor === "null") valor = null;
        
        let tipo = typeof valor;

        if (valor === null) {
          registro[nombreCampo] = null;
        } else if (tipo === "object") {
          let esFecha = Utils.getValorCampoFecha(valor,true);

          if (esFecha) {
            registro[nombreCampo] = UtilsFechas.formatearFechaHora(esFecha, formatoFecha);
          } else {
            valor = Utils.quitarTabs(valor);
            registro[nombreCampo] = valor;
          }
        } else if (tipo === "string") {
          valor = Utils.getValorCampo(valor);
          valor = Utils.quitarTabs(valor);
          registro[nombreCampo] = valor;
        } else {
          registro[nombreCampo] = valor;
        }
      }
      return registro;
    } catch (error) {
      console.log("No se puede arreglar el objeto", objeto);
      throw error;
    }
  }


  public mostrarEnConsola(mostrar: boolean) {
    this.mostrarConsola = mostrar;
  }

  public formatearFechaDB(fecha:string|Date) : string {
    try {
      let date = new Date(fecha); 
      let s = date.getFullYear() + "-";
      s += Utils.cerosIzquierda(date.getUTCMonth()+1,2) + "-";
      s += Utils.cerosIzquierda(date.getUTCDate(),2) + " ";
      s += Utils.cerosIzquierda(date.getUTCHours(),2) + ":";
      s += Utils.cerosIzquierda(date.getUTCMinutes(),2) ; //+ ":";
      //s += Utils.cerosIzquierda(date.getUTCSeconds(),2) + ":0000";
      return `'${s}'`;
    } catch (error) {
      return 'null';
    }
  }
  private formatearNombre(s: string) {
    if (typeof s !== "string") return "";
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  



  static getInstancia(): Database {
    if (!Database.instancia) {
      Database.instancia = new Database();
    }
    return Database.instancia;
  }
}
