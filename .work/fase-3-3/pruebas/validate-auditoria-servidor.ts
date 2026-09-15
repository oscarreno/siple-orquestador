import assert from "assert";
import { Grupos } from "../src/clases/Grupos";
import { Programas } from "../src/clases/Programas";
import { ORIGEN } from "../src/system/database";

function grupoBase() {
  return {
    origen: ORIGEN.MSSQL,
    llaveUnica: "O2026|ABC123",
    periodo: "O2026",
    clave: "ABC123",
    tipo: "REINGRESO",
    idioma: "ES",
    cupoGeneral: 20,
    cupoPrimerIngreso: 10,
    cupoReingreso: 10,
    cupoComplementario: 2,
    alumnosInscritos: 15,
    cupoMaximo: 25,
    exportable: true,
    liberable: true,
    fijo: false,
    reportado: false,
    exportado: false,
    esGrupoPrimerIngreso: false,
    discapacidad: false,
    revisado: "No",
    exigencia: { clave: "1", nombre: "Normal" },
    tipoAsistencia: { clave: "1", nombre: "Presencial" },
    contenido: "Original",
    materia: { clave: "12345", departamento: "ESI" },
    profesores: [{ expediente: "012345" }],
    materiasAdicionales: [{ clave: "99999" }],
    horarios: [{ plantilla: "A", numDiaSemana: 1, claveEspacio: "B101", horaInicio: "07:00", horaFin: "09:00" }],
    mensajes: [{ tipo: "INS", mensaje: "Aviso" }],
    planesCompartidos: [{ programa: "ITI", materia: 12345, cupo: 10 }],
    revisadoPor: ["ITI"],
    letra: "A",
    modificadores: "",
  } as any;
}

async function main() {
  const grupos = Grupos.getInstancia() as any;
  const programas = Programas.getInstancia() as any;
  const anterior = grupoBase();
  const candidato = { ...anterior, tipo: "PRIMER INGRESO", cupoGeneral: 30 };
  let lectura = 0;
  let recibido: any[] = [];
  const originalGetGrupo = grupos.getGrupo;
  const originalPlanes = programas.getGrupoPlanesCompartidos;
  const originalGuardado = grupos.guardarGrupoMSSQLAgregado;

  grupos.getGrupo = async () => (++lectura === 1 ? anterior : candidato);
  programas.getGrupoPlanesCompartidos = async () => candidato.planesCompartidos;
  grupos.guardarGrupoMSSQLAgregado = async (_usuario: string, _grupo: any, cambios: any[]) => {
    recibido = cambios;
  };

  try {
    await grupos.guardarGrupo("tester", ORIGEN.MSSQL, candidato, [
      { cambio: "fraude", campo: "campoFabricado", valorAnterior: "x", valorNuevo: "y" },
    ]);
    assert.deepStrictEqual(recibido.map(c => c.campo), ["tipo", "cupoGeneral"]);
    assert.strictEqual(recibido[0].valorAnterior, "REINGRESO");
    assert.strictEqual(recibido[0].valorNuevo, "PRIMER INGRESO");
    assert.strictEqual(recibido[1].valorAnterior, "20");
    assert.strictEqual(recibido[1].valorNuevo, "30");
    assert.ok(!recibido.some(c => c.campo === "campoFabricado"));
    console.log("OK: diferencias MSSQL calculadas desde estado anterior; cambiosBitacora del cliente ignorados.");
  } finally {
    grupos.getGrupo = originalGetGrupo;
    programas.getGrupoPlanesCompartidos = originalPlanes;
    grupos.guardarGrupoMSSQLAgregado = originalGuardado;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
