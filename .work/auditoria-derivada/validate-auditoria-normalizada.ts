import assert from "assert";
import { Grupos } from "../src/clases/Grupos";
import { ORIGEN } from "../src/system/database";

const popupHtml = '<HTML><HEAD><BASEFONT FACE="Arial" SIZE="3" COLOR="#000000"></HEAD><BODY><h2>Mensaje POPUP</h2></BODY></HTML>';

function grupoOracleBase() {
  return {
    origen: ORIGEN.ORACLE,
    llaveUnica: "V2026|CPC3326G",
    periodo: "V2026",
    clave: "CPC3326G",
    tipo: "REINGRESO",
    idioma: "Español",
    cupoGeneral: 24,
    cupoPrimerIngreso: 0,
    cupoReingreso: 24,
    cupoComplementario: 24,
    cupoMaximo: 24,
    exportable: true,
    liberable: true,
    contenido: "",
    profesores: [{ expediente: "f000001" }],
    exigencia: { clave: "1" },
    tipoAsistencia: { clave: "1" },
    horarios: [
      { plantilla: "A", numDiaSemana: 1, claveEspacio: "B101", horaInicio: "07:00", horaFin: "09:00" },
      { plantilla: "B", numDiaSemana: 3, claveEspacio: "B102", horaInicio: "09:00", horaFin: "11:00" },
    ],
    mensajes: [
      { tipo: "POPUP", mensaje: popupHtml },
      { tipo: "GPO", mensaje: "REINGRESO" },
      { tipo: "INS", mensaje: "Mensaje INS" },
    ],
    planesCompartidos: [{ programa: "ITI", materia: 12345, cupo: 6 }],
  } as any;
}

async function main() {
  const grupos = Grupos.getInstancia() as any;
  const anterior = grupoOracleBase();
  const candidato = {
    ...anterior,
    cupoPrimerIngreso: 6,
    cupoComplementario: 9,
    cupoMaximo: undefined,
    exportable: undefined,
    mensajes: [
      { tipo: "INS", mensaje: "Mensaje INS" },
      { tipo: "POPUP", mensaje: Buffer.from(popupHtml, "utf8").toString("base64") },
      { tipo: "GPO", mensaje: "REINGRESO" },
    ],
  };

  const cambios = grupos.construyeCambiosBitacoraServidor(anterior, candidato, ORIGEN.ORACLE);
  assert.deepStrictEqual(cambios.map((c: any) => c.campo), ["cupoPrimerIngreso", "cupoComplementario"]);
  assert.ok(!cambios.some((c: any) => c.campo === "cupoMaximo"));
  assert.ok(!cambios.some((c: any) => c.campo === "exportable"));
  assert.ok(!cambios.some((c: any) => c.campo === "mensajes"));
  console.log("OK: auditoría Oracle ignora omisiones efectivas, excluye exportable y normaliza POPUP/orden de mensajes.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
