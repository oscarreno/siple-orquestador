import { Component, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { MessageService } from 'primeng/api';
import { Grupo, GrupoMensaje, TIPO_MENSAJE } from 'src/app/models/Grupo.';
import { GruposFacadeService } from 'src/app/services/grupos-facade.service';
import { UsuariosService } from 'src/app/services/usuarios.service';
import { EventoGenericoService } from '../../services/evento-generico.service';
import { EditarPlanesComponent } from './editar-planes/editar-planes.component';
import { LogService } from 'src/app/services/log.service';

@Component({
  selector: 'editar-grupo',
  templateUrl: './editar-grupo.component.html',
  styleUrls: ['./editar-grupo.component.css'],
  standalone: false
})
export class EditarGrupoComponent {
  readonly grupo = input.required<Grupo>();
  readonly seccionInicial = input(1);
  readonly guardandoChange = output<boolean>();
  readonly grupoGuardado = output<Grupo>();
  private readonly editarPlanesComponent = viewChild(EditarPlanesComponent);

  bloqueado = false;
  interval;
  readonly grupoActual = signal<Grupo | null>(null);
  readonly seccionActiva = signal(1);
  readonly cuposModificadosArray = signal<iCambioRealizado[]>([]);
  readonly generalesModificadosArray = signal<iCambioRealizado[]>([]);
  readonly mensajesModificadosArray = signal<iCambioRealizado[]>([]);
  readonly planesModificadosArray = signal<iCambioRealizado[]>([]);
  readonly espaciosModificadosArray = signal<iCambioRealizado[]>([]);
  readonly botonDeshabilitado = signal(false);
  readonly cuposTienenError = signal(false);
  readonly estaGrabando = signal(false);
  readonly guardadoNoConfirmado = signal(false);
  readonly consultandoGuardado = signal(false);
  readonly grupoConsultado = signal<Grupo | null>(null);
  readonly puedeEditarEspacios = signal(false);

  private grupoCopia: Grupo | null = null;

  readonly huboCambios = computed(() => this.obtenerCambiosPendientes().length > 0);

  private readonly eventoGenerico = inject(EventoGenericoService);
  private readonly usuariosService = inject(UsuariosService);
  private readonly messageService = inject(MessageService);
  private readonly gruposFacade = inject(GruposFacadeService);
  private readonly log = inject(LogService);

  constructor() {
    effect(() => {
      const grupoEntrada = this.grupo();
      untracked(() => this.sincronizarGrupoEntrada(grupoEntrada));
    });

    effect(() => {
      this.seccionActiva.set(this.seccionInicial());
    });

    effect(() => {
      this.guardandoChange.emit(this.estaGrabando());
    });
  }

  async inicio(grupoBase: Grupo | null = this.grupoActual()): Promise<void> {
    const grupo = grupoBase;
    if (!grupo) {
      return;
    }

    this.resetCambiosPendientes();
    this.grupoCopia = this.gruposFacade.crearCopiaGrupo(grupo);
    this.puedeEditarEspacios.set(await this.usuariosService.tienePermiso('editarEspacios'));
  }

  async guardar(): Promise<void> {
    if (this.estaGrabando() || this.guardadoNoConfirmado() || this.consultandoGuardado()) return;
    const grupo = this.grupoActual();
    if (!grupo || !this.grupoCopia) return;

    this.estaGrabando.set(true);
    let solicitudEnviada = false;
    try {
      this.eventoGenerico.dispararEvento({ periodo: grupo.periodo, grupo: grupo.clave, evento: 'solicitarCambios' });
      await this.asignarPlanesAntesDeGuardar();
      if (!this.esGrupoActivo(grupo)) return;
      const cambios = this.obtenerCambiosPendientes();
      if (cambios.length === 0) {
        this.messageService.add({ severity: 'warn', detail: 'No se guardó porque no se han hecho modificaciones al grupo.' });
        return;
      }

      await this.asignarCambios();
      if (!this.esGrupoActivo(grupo)) return;
      solicitudEnviada = true;
      const grupoGuardado = await this.gruposFacade.guardarGrupo(this.grupoCopia, cambios);
      if (!this.esGrupoActivo(grupo)) return;

      const canonico = this.gruposFacade.crearCopiaGrupo(grupoGuardado);
      this.grupoActual.set(canonico);
      this.grupoCopia = this.gruposFacade.crearCopiaGrupo(canonico);
      this.resetCambiosPendientes();
      this.messageService.add({ severity: 'success', detail: 'Cambios guardados. ' + canonico.clave });
      this.eventoGenerico.dispararEvento({ origen: canonico.origen, periodo: canonico.periodo, grupo: canonico.clave, evento: 'tabBitacoraClicked' });
      this.eventoGenerico.dispararEvento({ origen: canonico.origen, periodo: canonico.periodo, grupo: canonico.clave, objeto: canonico, evento: 'grupoGuardado' });
      this.grupoGuardado.emit(grupoGuardado);
      // Un fallo del log de uso no cambia el resultado confirmado por el servidor.
      try {
        await this.log.guardarLog({ aplicacion: 'Editar Grupo', periodo: canonico.periodo,
          departamento: canonico.materia?.departamento, origen: canonico.origen,
          tipo: 'Cambios guardados: ' + cambios.length });
      } catch {
        console.warn('No se pudo registrar el log de uso del editor.');
      }
    } catch {
      if (!this.esGrupoActivo(grupo)) return;
      if (solicitudEnviada) {
        this.guardadoNoConfirmado.set(true);
        this.grupoConsultado.set(null);
        this.messageService.add({ severity: 'warn', detail: 'No se pudo confirmar el guardado. Consulta el estado actual antes de volver a guardar.' });
      } else {
        this.messageService.add({ severity: 'error', detail: 'No se pudo preparar el guardado. Tus cambios se conservan.' });
      }
    } finally {
      this.estaGrabando.set(false);
    }
  }

  async consultarEstadoGuardado(): Promise<void> {
    const grupo = this.grupoActual();
    if (!grupo || !this.guardadoNoConfirmado() || this.consultandoGuardado()) return;
    this.consultandoGuardado.set(true);
    this.grupoConsultado.set(null);
    try {
      const actual = await this.gruposFacade.obtenerGrupo(grupo.origen, grupo.periodo, grupo.clave, true, true);
      if (!this.esGrupoActivo(grupo)) return;
      if (!actual || !this.esMismoGrupo(grupo, actual)) throw new Error('Respuesta de grupo inválida');
      this.grupoConsultado.set(this.gruposFacade.crearCopiaGrupo(actual));
    } catch {
      if (this.esGrupoActivo(grupo)) {
        this.messageService.add({ severity: 'error', detail: 'No se pudo consultar el estado actual. Tu edición se conserva y el guardado sigue bloqueado.' });
      }
    } finally {
      this.consultandoGuardado.set(false);
    }
  }

  usarEstadoConsultado(): void {
    const actual = this.grupoConsultado();
    if (!actual || !this.guardadoNoConfirmado() || this.consultandoGuardado() || !this.esGrupoActivo(actual)) return;
    this.grupoActual.set(actual);
    this.grupoCopia = this.gruposFacade.crearCopiaGrupo(actual);
    this.resetCambiosPendientes();
    this.guardadoNoConfirmado.set(false);
    this.grupoConsultado.set(null);
    this.messageService.add({ severity: 'info', detail: 'Se cargó el estado actual. Revisa los datos antes de hacer nuevos cambios.' });
  }

  private esGrupoActivo(grupo: Grupo): boolean {
    const actual = this.grupoActual();
    return actual !== null && this.esMismoGrupo(actual, grupo);
  }

  private async asignarCambios(): Promise<void> {
    if (!this.grupoCopia) {
      return;
    }

    let cambioModificadores = false;

    for (let i = 0; i < this.cuposModificadosArray().length; i++) {
      const e = this.cuposModificadosArray()[i];
      switch (e.campo) {
        case 'Gral':
          this.grupoCopia.cupoGeneral = e.numeroNuevo;
          break;
        case 'RE':
          this.grupoCopia.cupoReingreso = e.numeroNuevo;
          break;
        case 'PI':
          this.grupoCopia.cupoPrimerIngreso = e.numeroNuevo;
          break;
        case 'AC':
          this.grupoCopia.cupoComplementario = e.numeroNuevo;
          break;
      }
    }

    for (let i = 0; i < this.generalesModificadosArray().length; i++) {
      const e = this.generalesModificadosArray()[i];
      switch (e.cambio) {
        case 'Tipo Grupo':
          this.grupoCopia.tipo = e.stringNuevo;
          break;
        case 'Idioma':
          this.grupoCopia.idioma = e.stringNuevo;
          break;
        case 'Liberable':
          this.grupoCopia.liberable = e.booleanNuevo;
          break;
        case 'Modificadores':
          this.grupoCopia.modificadores = e.stringNuevo;
          this.grupoCopia.discapacidad = e.stringNuevo?.includes('PB') ?? false;
          cambioModificadores = true;
          break;
        case 'Contenido':
          this.grupoCopia.contenido = e.stringNuevo;
          break;
      }
    }

    const newMensajes: GrupoMensaje[] = [];
    let mInsSeModifico = false;
    let mPopSeModifico = false;
    let mPlaSeModifico = false;
    let mensajePLANuevo: string | null = null;

    for (let i = 0; i < this.mensajesModificadosArray().length; i++) {
      const m = this.mensajesModificadosArray()[i];
      const mensajeTexto = m.stringNuevo?.trim() ?? '';

      if (m.campo === 'INS') {
        if (mensajeTexto) {
          newMensajes.push(new GrupoMensaje(TIPO_MENSAJE.TIPO_INSCRIPCION, mensajeTexto));
        }
        mInsSeModifico = true;
      } else if (m.campo === 'POP') {
        if (mensajeTexto) {
          const pop = `<HTML><HEAD> <BASEFONT FACE="Arial" SIZE="3" COLOR="#000000"> </HEAD> <BODY> <h2>${mensajeTexto}</h2>   </BODY></HTML>`;
          newMensajes.push(new GrupoMensaje(TIPO_MENSAJE.TIPO_POPUP, pop));
        }
        mPopSeModifico = true;
      } else if (m.campo === 'PLA') {
        mensajePLANuevo = mensajeTexto;
        mPlaSeModifico = true;
      }
    }

    if (cambioModificadores || mPlaSeModifico) {
      if (mensajePLANuevo === null) {
        const mensajeBD = this.grupoCopia.getMensaje(TIPO_MENSAJE.TIPO_PLANEACION);
        if (mensajeBD) {
          mensajePLANuevo = mensajeBD.mensaje.substring(mensajeBD.mensaje.lastIndexOf('|') + 1);
        }
      }

      if (this.grupoCopia.modificadores) {
        mensajePLANuevo = this.grupoCopia.modificadores + (mensajePLANuevo ?? '');
      }

      if ((mensajePLANuevo ?? '').trim()) {
        newMensajes.push(new GrupoMensaje(TIPO_MENSAJE.TIPO_PLANEACION, mensajePLANuevo ?? ''));
      }
    }

    {
      let m = this.grupoCopia.getMensaje(TIPO_MENSAJE.TIPO_INSCRIPCION);
      if (!mInsSeModifico && m) {
        newMensajes.push(m);
      }
      m = this.grupoCopia.getMensaje(TIPO_MENSAJE.TIPO_POPUP);
      if (!mPopSeModifico && m) {
        newMensajes.push(m);
      }
      m = this.grupoCopia.getMensaje(TIPO_MENSAJE.TIPO_PLANEACION);
      if (!mPlaSeModifico && !cambioModificadores && m) {
        newMensajes.push(m);
      }
      m = this.grupoCopia.getMensaje(TIPO_MENSAJE.TIPO_TIPOGRUPO);
      if (m) {
        newMensajes.push(m);
      }

      this.grupoCopia.setMensajes(newMensajes);
    }
  }

  private async asignarPlanesAntesDeGuardar(): Promise<void> {
    const grupo = this.grupoActual();
    if (!this.grupoCopia || !grupo) {
      return;
    }

    const editorPlanes = this.editarPlanesComponent();
    const planesActualizados = editorPlanes
      ? await editorPlanes.obtenerPlanesParaGuardarConstruidos()
      : await this.gruposFacade.obtenerPlanesCompartidos(grupo.origen, grupo.periodo, grupo.clave, true);

    if (this.esGrupoActivo(grupo)) this.grupoCopia.setPlanesCompartidos(planesActualizados ?? []);
  }

  handleChange(index: number | string): void {
    const grupo = this.grupoActual();
    if (!grupo) {
      return;
    }

    const activeIndex = Number(index);
    this.seccionActiva.set(activeIndex);
    if (activeIndex === 0) {
      this.eventoGenerico.dispararEvento({ periodo: grupo.periodo, grupo: grupo.clave, evento: 'tabGeneralesClicked' });
    } else if (activeIndex === 3) {
      this.eventoGenerico.dispararEvento({ periodo: grupo.periodo, grupo: grupo.clave, evento: 'tabPlanesClicked' });
    } else if (activeIndex === 4) {
      this.eventoGenerico.dispararEvento({ periodo: grupo.periodo, grupo: grupo.clave, evento: 'tabBitacoraClicked' });
    }
  }

  cuposConError(hayError: boolean): void {
    this.cuposTienenError.set(hayError);
  }

  cuposModificados(datos: iCambioRealizado[]): void {
    this.cuposModificadosArray.set(datos);
  }

  espaciosModificados(datos: iCambioRealizado[]): void {
    this.espaciosModificadosArray.set(datos);
  }

  generalesModificados(datos: iCambioRealizado[]): void {
    this.generalesModificadosArray.set(datos);
  }

  mensajesModificados(datos: iCambioRealizado[]): void {
    this.mensajesModificadosArray.set(datos);
  }

  planesModificados(datos: iCambioRealizado[]): void {
    this.planesModificadosArray.set(datos);
  }

  private obtenerCambiosPendientes(): iCambioRealizado[] {
    return [
      ...this.cuposModificadosArray(),
      ...this.espaciosModificadosArray(),
      ...this.generalesModificadosArray(),
      ...this.mensajesModificadosArray(),
      ...this.planesModificadosArray()
    ];
  }

  private resetCambiosPendientes(): void {
    this.cuposModificadosArray.set([]);
    this.espaciosModificadosArray.set([]);
    this.generalesModificadosArray.set([]);
    this.mensajesModificadosArray.set([]);
    this.planesModificadosArray.set([]);
  }

  private sincronizarGrupoEntrada(grupoEntrada: Grupo): void {
    const grupoActual = this.grupoActual();
    if (grupoActual && this.esMismoGrupo(grupoActual, grupoEntrada)
      && (this.estaGrabando() || this.guardadoNoConfirmado() || this.consultandoGuardado())) return;
    const grupoEntradaClonado = this.gruposFacade.crearCopiaGrupo(grupoEntrada);

    if (!grupoActual || !this.esMismoGrupo(grupoActual, grupoEntrada)) {
      this.guardadoNoConfirmado.set(false);
      this.grupoConsultado.set(null);
      this.grupoActual.set(grupoEntradaClonado);
      void this.inicio(grupoEntradaClonado);
      return;
    }

    if (this.obtenerMarcaGrupo(grupoEntrada) <= this.obtenerMarcaGrupo(grupoActual)) {
      return;
    }

    this.grupoActual.set(grupoEntradaClonado);
    void this.inicio(grupoEntradaClonado);
  }

  private esMismoGrupo(grupoActual: Grupo, grupoEntrada: Grupo): boolean {
    return grupoActual.origen === grupoEntrada.origen
      && grupoActual.periodo === grupoEntrada.periodo
      && grupoActual.clave === grupoEntrada.clave;
  }

  private obtenerMarcaGrupo(grupo: Grupo | null): number {
    if (!grupo) {
      return 0;
    }

    const fechaModificacion = Number(grupo.fechaModificacion ?? 0);
    const fechaCreacion = Number(grupo.fechaCreacion ?? 0);
    return Math.max(fechaModificacion, fechaCreacion, 0);
  }
}
