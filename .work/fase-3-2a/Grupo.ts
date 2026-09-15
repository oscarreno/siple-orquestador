import { ORIGEN } from "../system/database";
import { ITipoProfesor, ICatalogoSimple } from "../clases/Catalogos";
import { Profesor } from "./Profesor";
import { Materia } from "./Materia";
import { GrupoPlanCompartido } from "./Programa";

export enum TIPO_MENSAJE_INT {
  SIN_TIPO,
  TIPO_PLANEACION,
  TIPO_INSCRIPCION,
  TIPO_TIPO3,
  TIPO_POPUP,
  TIPO_TIPOGRUPO,
}

export enum TIPO_MENSAJE {
  SIN_TIPO = "",
  TIPO_PLANEACION = "PLA",
  TIPO_INSCRIPCION = "INS",
  TIPO_TIPO3 = "TIPO 3",
  TIPO_POPUP = "POPUP",
  TIPO_TIPOGRUPO = "GPO",
}

export class Grupo {
  nivelAcademico?: string;
  //tipoProfesor?: ITipoProfesor;
  mensajes?: GrupoMensaje[];


  constructor(
    public origen: ORIGEN,
    public llaveUnica: string,
    public periodo: string,
    public clave: string,
    public tipo: string,
    public idioma: string,
    public cupoGeneral: number,
    public cupoPrimerIngreso: number,
    public cupoReingreso: number,
    public cupoComplementario: number,
    public alumnosInscritos: number,
    public cupoMaximo: number,
    public exportable: boolean,
    public liberable: boolean,
    public fijo: boolean,
    public reportado: boolean,
    public exportado: boolean,
    public esGrupoPrimerIngreso: boolean,
    public discapacidad: boolean,
    public revisado: string,
    public exigencia: ICatalogoSimple,
    public tipoAsistencia: ICatalogoSimple,
    public materia?: Materia,
    public profesores?: Profesor[],
    public materiasAdicionales?: Array<Materia>,
    public contenido?: string,
    public fechaCreacion?: Date,
    public fechaModificacion?: Date,
    public horarios?: GrupoHorario[],
    public planesCompartidos?: GrupoPlanCompartido[],
    public revisadoPor?: Array<string>,
    public letra?: string,
    public modificadores?: string
  ) { }

  getHorariosString(html = false): string {
    let s = "";
    let espacio = "";
    if (html) s = "<ul>";

    if (this.horarios) {
      for (let i = 0; i < this.horarios.length; i++) {
        const horario = this.horarios[i];

        if (horario.claveEspacio === "VIDEOCONFERENCIA")
          espacio = "Videoconferencia";
        else if (horario.claveEspacio === "ASESORIA")
          espacio = "Asesoría";
        else if (horario.claveEspacio === "POR ASIGNAR")
          espacio = "(Espacio por asignar)";
        else
          espacio = horario.claveEspacio;

        if (html) {
          s += "<li>";

          if (horario.claveEspacio === "EN LINEA") s += 'Sesiones en línea <em class="resaltado">(asíncrono)</em>';
          else
            s += "<strong>" + horario.diaSemana + "</strong> " + horario.horaInicio + "-" + horario.horaFin + ' <em class="resaltado">' + espacio + "</em>";
          s += "</li>";

          s += "<hr>";
        } else {
          if (horario.claveEspacio === "EN LINEA") s += "EN LÍNEA";
          else s += horario.diaSemana + " " + horario.horaInicio + "-" + horario.horaFin + espacio + "\n";
        }
      }
    }

    if (html) {
      s = s.substring(0, s.length - 4);
      s += "</ul>";
    }

    return s;
  }

  getClaveMateriasString(): string {
    let materias = `'${this.materia?.clave}', `;
    if (this.materiasAdicionales)
      for (let i = 0; i < this.materiasAdicionales.length; i++)
        materias += `'${this.materiasAdicionales[i].clave}', `;
    materias = materias.substring(0, materias.length - 2);
    return materias;
  }
}

export class GrupoHorario {

  constructor(
    public plantilla: string,
    public numDiaSemana: number,
    public claveEspacio: string,
    public horaInicio: string,
    public horaFin: string,
    public diaSemana?: string,
    public tipoEspacio?: string
  ) { }
}

export class GrupoHorarioExtendido extends GrupoHorario {
  // tipo:string;
  // idReserva:number;
  constructor(
    plantilla: string,
    numDiaSemana: number,
    public reservasPendientes: number,
    claveEspacio: string,
    horaInicio: string,
    horaFin: string,
    public tipo: string,
    public idReserva: number) {
    super(
      plantilla,
      numDiaSemana,
      claveEspacio,
      horaInicio,
      horaFin,
    );
  }
}
export class GrupoMensaje {
  constructor(
    public tipo: TIPO_MENSAJE,
    public mensaje: string) {
  }
}


export interface ModificadoresGrupo {
  clave: string,
  nombre: string,
  descripcion?: string
}

export interface EncabezadoReserva {
  nombre: string,
  descripcion?: string,
  expediente?: string,
  nombreEmpleado?: string,
  apellidos?: string,
  usuario?: string,
  departamento?: string,
  genero?: string,
}