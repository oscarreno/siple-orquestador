const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, 'src/app/components/editar-grupo/editar-grupo.component.ts');
let source = fs.readFileSync(file, 'utf8');
source = source.replace('Component, ViewChild, computed', 'Component, computed')
  .replace('signal, untracked }', 'signal, untracked, viewChild }')
  .replace('@ViewChild(EditarPlanesComponent) private editarPlanesComponent?: EditarPlanesComponent;',
    'private readonly editarPlanesComponent = viewChild(EditarPlanesComponent);')
  .replace('readonly estaGrabando = signal(false);', `readonly estaGrabando = signal(false);
  readonly guardadoNoConfirmado = signal(false);
  readonly consultandoGuardado = signal(false);
  readonly grupoConsultado = signal<Grupo | null>(null);`);
const start = source.indexOf('  async guardar(): Promise<void> {');
const end = source.indexOf('  private async asignarCambios()', start);
if (start < 0 || end < 0) throw new Error('No se encontró guardar');
source = source.slice(0, start) + `  async guardar(): Promise<void> {
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
        this.log.guardarLog({ aplicacion: 'Editar Grupo', periodo: canonico.periodo,
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

` + source.slice(end);
source = source.replace(`const planesActualizados = this.editarPlanesComponent
      ? await this.editarPlanesComponent.obtenerPlanesParaGuardarConstruidos()`,
  `const editorPlanes = this.editarPlanesComponent();
    const planesActualizados = editorPlanes
      ? await editorPlanes.obtenerPlanesParaGuardarConstruidos()`);
// The file may contain CRLF, so handle that exact source too.
source = source.replace('const planesActualizados = this.editarPlanesComponent\r\n      ? await this.editarPlanesComponent.obtenerPlanesParaGuardarConstruidos()',
  'const editorPlanes = this.editarPlanesComponent();\n    const planesActualizados = editorPlanes\n      ? await editorPlanes.obtenerPlanesParaGuardarConstruidos()');
source = source.replace('    this.grupoCopia.setPlanesCompartidos(planesActualizados ?? []);',
  '    if (this.esGrupoActivo(grupo)) this.grupoCopia.setPlanesCompartidos(planesActualizados ?? []);');
source = source.replace('    const grupoEntradaClonado = this.gruposFacade.crearCopiaGrupo(grupoEntrada);',
  `    if (grupoActual && this.esMismoGrupo(grupoActual, grupoEntrada)
      && (this.estaGrabando() || this.guardadoNoConfirmado() || this.consultandoGuardado())) return;
    const grupoEntradaClonado = this.gruposFacade.crearCopiaGrupo(grupoEntrada);`);
source = source.replace('    if (!grupoActual || !this.esMismoGrupo(grupoActual, grupoEntrada)) {',
  `    if (!grupoActual || !this.esMismoGrupo(grupoActual, grupoEntrada)) {
      this.guardadoNoConfirmado.set(false);
      this.grupoConsultado.set(null);`);
fs.writeFileSync(file, source.replace(/\r?\n/g, '\r\n'), 'utf8');
