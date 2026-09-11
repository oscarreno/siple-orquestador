import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { EditarGrupoComponent } from './editar-grupo.component';
import { GruposFacadeService } from '../../services/grupos-facade.service';
import { GruposDataService } from '../../services/grupos-data.service';
import { UsuariosService } from '../../services/usuarios.service';
import { EventoGenericoService } from '../../services/evento-generico.service';
import { LogService } from '../../services/log.service';
import { crearGrupoGuardado } from '../../testing/grupo-guardado.fixture';

describe('EditarGrupo: recuperación de guardado no confirmado', () => {
  let fixture: ComponentFixture<EditarGrupoComponent>;
  let component: EditarGrupoComponent;
  let grupos: jasmine.SpyObj<GruposFacadeService>;
  let mensajes: jasmine.SpyObj<MessageService>;
  let eventos: jasmine.SpyObj<EventoGenericoService>;
  let log: jasmine.SpyObj<LogService>;
  const cambios = [{ grupo: 'G1', cambio: 'cupoGrupo', campo: 'Gral', numeroAnterior: 30, numeroNuevo: 35 }];

  beforeEach(async () => {
    grupos = jasmine.createSpyObj<GruposFacadeService>('Grupos', ['guardarGrupo', 'crearCopiaGrupo', 'obtenerPlanesCompartidos', 'obtenerGrupo']);
    grupos.crearCopiaGrupo.and.callFake(grupo => GruposDataService.prototype.getGrupoCopia(grupo));
    grupos.obtenerPlanesCompartidos.and.returnValue(Promise.resolve([]));
    mensajes = jasmine.createSpyObj<MessageService>('Mensajes', ['add']);
    eventos = jasmine.createSpyObj<EventoGenericoService>('Eventos', ['dispararEvento']);
    log = jasmine.createSpyObj<LogService>('Log', ['guardarLog']);
    log.guardarLog.and.returnValue(Promise.resolve());
    await TestBed.configureTestingModule({ declarations: [EditarGrupoComponent], schemas: [NO_ERRORS_SCHEMA],
      providers: [{ provide: GruposFacadeService, useValue: grupos }, { provide: MessageService, useValue: mensajes },
        { provide: EventoGenericoService, useValue: eventos }, { provide: LogService, useValue: log },
        { provide: UsuariosService, useValue: { tienePermiso: async () => true } }] }).compileComponents();
    fixture = TestBed.createComponent(EditarGrupoComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('grupo', crearGrupoGuardado());
    fixture.detectChanges();
    await fixture.whenStable();
    component.cuposModificados(cambios);
  });

  async function fallarGuardado(): Promise<void> {
    grupos.guardarGrupo.and.callFake(async () => { throw new Error('Respuesta GraphQL sin datos'); });
    await component.guardar();
    fixture.detectChanges();
  }

  it('conserva el borrador, libera carga y bloquea un segundo envío', async () => {
    const emit = spyOn(component.grupoGuardado, 'emit');
    await fallarGuardado();
    expect(component.cuposModificadosArray()).toEqual(cambios);
    expect(component.estaGrabando()).toBeFalse();
    expect(component.guardadoNoConfirmado()).toBeTrue();
    expect(emit).not.toHaveBeenCalled();
    expect(eventos.dispararEvento.calls.allArgs().some(([e]) => e.evento === 'grupoGuardado')).toBeFalse();
    expect(mensajes.add.calls.allArgs().some(([m]) => m.severity === 'success')).toBeFalse();
    await component.guardar();
    expect(grupos.guardarGrupo).toHaveBeenCalledTimes(1);
    const boton: HTMLButtonElement = fixture.nativeElement.querySelector('.editor-footer__save');
    expect(boton.disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Guardado no confirmado');
  });

  it('una lectura fallida no libera el guardado ni pierde cambios', async () => {
    await fallarGuardado();
    grupos.obtenerGrupo.and.callFake(async () => { throw new Error('Sin conexión'); });
    await component.consultarEstadoGuardado();
    expect(component.guardadoNoConfirmado()).toBeTrue();
    expect(component.consultandoGuardado()).toBeFalse();
    expect(component.grupoConsultado()).toBeNull();
    expect(component.cuposModificadosArray()).toEqual(cambios);
  });

  it('requiere adoptar explícitamente la lectura antes de nuevas ediciones', async () => {
    await fallarGuardado();
    const actual = crearGrupoGuardado();
    actual.cupoGeneral = 35;
    grupos.obtenerGrupo.and.returnValue(Promise.resolve(actual));
    await component.consultarEstadoGuardado();
    expect(grupos.obtenerGrupo).toHaveBeenCalledWith(actual.origen, actual.periodo, actual.clave, true, true);
    expect(component.guardadoNoConfirmado()).toBeTrue();
    expect(component.cuposModificadosArray()).toEqual(cambios);
    component.usarEstadoConsultado();
    expect(component.guardadoNoConfirmado()).toBeFalse();
    expect(component.huboCambios()).toBeFalse();
    expect(component.grupoActual()?.cupoGeneral).toBe(35);
    expect(grupos.guardarGrupo).toHaveBeenCalledTimes(1);
  });

  it('una actualización de entrada no borra una edición incierta', async () => {
    await fallarGuardado();
    const externo = crearGrupoGuardado();
    externo.fechaModificacion = '999';
    fixture.componentRef.setInput('grupo', externo);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.guardadoNoConfirmado()).toBeTrue();
    expect(component.cuposModificadosArray()).toEqual(cambios);
  });

  it('publica el estado canónico confirmado y limpia pendientes', async () => {
    const canonico = crearGrupoGuardado();
    canonico.cupoGeneral = 34;
    grupos.guardarGrupo.and.returnValue(Promise.resolve(canonico));
    const emit = spyOn(component.grupoGuardado, 'emit');
    await component.guardar();
    expect(component.grupoActual()?.cupoGeneral).toBe(34);
    expect(component.huboCambios()).toBeFalse();
    expect(component.guardadoNoConfirmado()).toBeFalse();
    expect(emit).toHaveBeenCalledWith(canonico);
  });

  it('un error al preparar planes no se considera una escritura incierta', async () => {
    grupos.obtenerPlanesCompartidos.and.callFake(async () => { throw new Error('Catálogo no disponible'); });
    await component.guardar();
    expect(grupos.guardarGrupo).not.toHaveBeenCalled();
    expect(component.guardadoNoConfirmado()).toBeFalse();
    expect(component.cuposModificadosArray()).toEqual(cambios);
    expect(component.estaGrabando()).toBeFalse();
  });
});
