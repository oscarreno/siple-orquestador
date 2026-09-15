import * as assert from "assert";
import db, { ORIGEN } from "../src/system/database";
import oracle from "../src/system/oracle";
import { Grupos } from "../src/clases/Grupos";
import { Programas } from "../src/clases/Programas";
import Catalogos from "../src/clases/Catalogos";
import { TIPO_MENSAJE } from "../src/modelos/Grupo";

function crearGrupo(origen: ORIGEN) {
  return {
    origen,
    llaveUnica: "O2026|ABC123",
    periodo: "O2026",
    clave: "ABC123",
    tipo: "PRIMER INGRESO",
    idioma: "EN",
    cupoGeneral: 30,
    cupoPrimerIngreso: 20,
    cupoReingreso: 10,
    cupoComplementario: 5,
    alumnosInscritos: 18,
    cupoMaximo: 35,
    exportable: true,
    liberable: true,
    fijo: false,
    reportado: false,
    exportado: false,
    esGrupoPrimerIngreso: true,
    discapacidad: true,
    revisado: "Si",
    letra: "A",
    contenido: "Contenido de prueba",
    mensajes: [
      { tipo: TIPO_MENSAJE.TIPO_INSCRIPCION, mensaje: "Mensaje general" },
      { tipo: TIPO_MENSAJE.TIPO_PLANEACION, mensaje: "|PC|" },
    ],
    materia: {
      clave: "12345",
      departamento: "ESI",
      nombre: "Materia prueba",
    },
    materiasAdicionales: [
      { clave: "99999" },
    ],
    profesores: [
      { expediente: "012345" },
    ],
    revisadoPor: ["ITI"],
    horarios: [
      {
        plantilla: "A",
        numDiaSemana: 1,
        claveEspacio: "B101",
        horaInicio: "07:00",
        horaFin: "09:00",
      },
    ],
    tipoAsistencia: { clave: "2", nombre: "Semi" },
    exigencia: { clave: "3", nombre: "Intensivo" },
    cache: false,
    modificadores: "|PC|",
    planesCompartidos: [
      {
        origen,
        grupo: "ABC123",
        periodo: "O2026",
        programa: "ITI",
        materia: 12345,
        cupo: 12,
      },
    ],
  } as any;
}

async function main() {
  const grupos = Grupos.getInstancia();
  const programas = Programas.getInstancia();
  const catalogos = Catalogos.getInstancia() as any;
  const dbInst = db.getInstancia() as any;
  const oracleInst = oracle.getInstancia() as any;

  const originalDbQuerySinResultados = dbInst.querySinResultados;
  const originalGetGrupo = grupos.getGrupo;
  const originalGetPlanes = programas.getGrupoPlanesCompartidos;
  const originalGetPeriodo = catalogos.getPeriodo;
  const originalActualizarFecha = (grupos as any).actualizarFechaModificacionGrupo;
  const originalOracleTx = oracleInst.withTransaction;

  catalogos.getPeriodo = () => ({ fechainicio: "01/01/2026", fechafin: "31/05/2026" });

  try {
    pruebaArreglaObjetoOracle();
    await pruebaFelizMSSQL(grupos, programas, dbInst);
    await pruebaCompatibilidadHorarioLegacy(grupos, programas, dbInst);
    await pruebaFelizORACLE(grupos, programas, oracleInst);
    await pruebaRollbackIntermedioORACLE(grupos, oracleInst);
    console.log("Validacion guardarGrupo: OK");
  } finally {
    dbInst.querySinResultados = originalDbQuerySinResultados;
    grupos.getGrupo = originalGetGrupo;
    programas.getGrupoPlanesCompartidos = originalGetPlanes;
    catalogos.getPeriodo = originalGetPeriodo;
    (grupos as any).actualizarFechaModificacionGrupo = originalActualizarFecha;
    oracleInst.withTransaction = originalOracleTx;
  }
}

function pruebaArreglaObjetoOracle() {
  const registro = (oracle.getInstancia() as any).arreglaObjeto({
    TIPO: "POPUP",
    MENSAJE: "Linea 1\n\"Cita\"\r\nLinea 2",
    OTRO: "null",
  });

  assert.deepStrictEqual(registro, {
    tipo: "POPUP",
    mensaje: "Linea 1 \"Cita\"  Linea 2",
    otro: null,
  });
}

async function pruebaFelizMSSQL(grupos: Grupos, programas: Programas, dbInst: any) {
  const entrada = crearGrupo(ORIGEN.MSSQL);
  const hidratado = {
    ...entrada,
    tipo: "REINGRESO",
    cupoGeneral: 20,
    planesCompartidos: [
      { ...entrada.planesCompartidos[0], departamento: "ESI", area: "AC", areaCompleta: "AREA", cicloSugerido: 3 },
    ],
  };
  let queryGuardado = "";

  dbInst.querySinResultados = async (query: string) => {
    queryGuardado = query;
    return true;
  };
  grupos.getGrupo = async () => ({ ...hidratado });
  programas.getGrupoPlanesCompartidos = async () => hidratado.planesCompartidos;

  const resultado = await grupos.guardarGrupo(
    "tester",
    ORIGEN.MSSQL,
    entrada,
    [{ cambio: "fraude", campo: "campoFabricado", valorAnterior: "x", valorNuevo: "y" }]
  );

  assert.strictEqual(resultado.clave, hidratado.clave);
  assert.deepStrictEqual(resultado.planesCompartidos, hidratado.planesCompartidos);
  assert.match(queryGuardado, /BEGIN TRANSACTION/);
  assert.match(queryGuardado, /DELETE GrupoHorario/);
  assert.match(queryGuardado, /DELETE GrupoMensajes/);
  assert.match(queryGuardado, /DELETE GrupoPlanCompartido/);
  assert.match(queryGuardado, /INSERT INTO BitacoraSIPLE/);
  assert.match(queryGuardado, /'tipo'/);
  assert.doesNotMatch(queryGuardado, /campoFabricado/);
  assert.match(queryGuardado, /ROLLBACK TRANSACTION/);
}

async function pruebaCompatibilidadHorarioLegacy(grupos: Grupos, programas: Programas, dbInst: any) {
  const entrada = crearGrupo(ORIGEN.MSSQL);
  entrada.horarios = [
    {
      plantilla: "C",
      diaSemana: "Miércoles",
      espacio: "C202",
      horaInicio: "09:00",
      horaFin: "11:00",
    } as any,
  ];
  let queryGuardado = "";

  dbInst.querySinResultados = async (query: string) => {
    queryGuardado = query;
    return true;
  };
  grupos.getGrupo = async () => ({ ...entrada } as any);
  programas.getGrupoPlanesCompartidos = async () => entrada.planesCompartidos;

  await grupos.guardarGrupo("tester", ORIGEN.MSSQL, entrada, []);

  assert.match(queryGuardado, /INSERT INTO GrupoHorario/);
  assert.match(queryGuardado, /'C202'/);
  assert.match(queryGuardado, /, 3, '09:00', '11:00', 'C202'/);
}

async function pruebaFelizORACLE(grupos: Grupos, programas: Programas, oracleInst: any) {
  const entrada = crearGrupo(ORIGEN.ORACLE);
  const actual = { ...entrada, tipo: "REINGRESO", discapacidad: false };
  const hidratado = { ...entrada };
  const sentencias: string[] = [];
  let commit = false;
  let rollback = false;
  let lecturasGrupo = 0;

  grupos.getGrupo = async () => {
    lecturasGrupo++;
    return lecturasGrupo === 1 ? ({ ...actual } as any) : ({ ...hidratado } as any);
  };
  programas.getGrupoPlanesCompartidos = async () => hidratado.planesCompartidos;
  (grupos as any).actualizarFechaModificacionGrupo = async () => true;
  oracleInst.withTransaction = async (work: (connection: any) => Promise<any>) => {
    const connection = {
      async execute(query: string) {
        sentencias.push(query);
        if (query.includes("SELECT PeriodoEscolar_ID")) return { rows: [{ PERIODOESCOLAR_ID: 44 }] };
        if (query.includes("SELECT ID FROM ORACLEDBA.AREATRABAJO")) return { rows: [{ ID: 88 }] };
        if (query.includes("SELECT ORACLEDBA.SIPF1_GRUPOID")) return { rows: [{ GRUPOID: 999 }] };
        return { rows: [] };
      },
      async commit() {
        commit = true;
      },
      async rollback() {
        rollback = true;
      },
    };

    const resultado = await work(connection);
    await connection.commit();
    return resultado;
  };

  const resultado = await grupos.guardarGrupo("tester", ORIGEN.ORACLE, entrada, []);

  assert.strictEqual(resultado.clave, hidratado.clave);
  assert.strictEqual(commit, true);
  assert.strictEqual(rollback, false);
  assert.ok(sentencias.some((sql) => sql.includes("SIPF1_ALTAGRUPO2")));
  assert.ok(!sentencias.some((sql) => sql.includes("DELETE FROM ORACLEDBA.ESPACIORESERVADO")));
  assert.ok(!sentencias.some((sql) => sql.includes("V_SIPF1_GRUPOMENSAJES")));
  assert.ok(!sentencias.some((sql) => sql.includes("V_SIPF1_GRUPOPLANCOMPARTIDO")));
  assert.ok(sentencias.some((sql) => sql.includes("SIPF1_ALTAHORARIO")));
  assert.ok(sentencias.some((sql) => sql.includes("SIPF1_ALTAMENSAJE")));
  assert.ok(sentencias.some((sql) => sql.includes("SIPF1_ALTAGMAP22")));
}

async function pruebaRollbackIntermedioORACLE(grupos: Grupos, oracleInst: any) {
  const entrada = crearGrupo(ORIGEN.ORACLE);
  let commit = false;
  let rollback = false;
  let contador = 0;

  grupos.getGrupo = async () => ({ ...entrada });
  oracleInst.withTransaction = async (work: (connection: any) => Promise<any>) => {
    const connection = {
      async execute(query: string) {
        contador++;
        if (query.includes("SELECT PeriodoEscolar_ID")) return { rows: [{ PERIODOESCOLAR_ID: 44 }] };
        if (query.includes("SELECT ID FROM ORACLEDBA.AREATRABAJO")) return { rows: [{ ID: 88 }] };
        if (query.includes("SELECT ORACLEDBA.SIPF1_GRUPOID")) return { rows: [{ GRUPOID: 999 }] };
        if (contador >= 6) throw new Error("Fallo intermedio");
        return { rows: [] };
      },
      async commit() {
        commit = true;
      },
      async rollback() {
        rollback = true;
      },
    };

    try {
      const resultado = await work(connection);
      await connection.commit();
      return resultado;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  };

  await assert.rejects(
    () => grupos.guardarGrupo("tester", ORIGEN.ORACLE, entrada, []),
    /Fallo intermedio/
  );
  assert.strictEqual(commit, false);
  assert.strictEqual(rollback, true);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
