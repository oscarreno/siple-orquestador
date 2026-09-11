import { TestBed } from '@angular/core/testing';
import { GruposDataService } from './grupos-data.service';
import { DbService } from './db.service';
import { UsuariosService } from './usuarios.service';
import { AlmacenService } from './almacen.service';
import { MateriasService } from './materias.service';
import { LogService } from './log.service';
import { ORIGEN } from '../models/Origen';
import { crearGrupoGuardado } from '../testing/grupo-guardado.fixture';

describe('GruposDataService: una sola escritura de guardado', () => {
  let service: GruposDataService;
  let db: jasmine.SpyObj<DbService>;
  let log: jasmine.SpyObj<LogService>;
  beforeEach(() => {
    db = jasmine.createSpyObj<DbService>('DbService', ['mutation', 'query']);
    log = jasmine.createSpyObj<LogService>('LogService', ['guardarBitacora']);
    TestBed.configureTestingModule({ providers: [GruposDataService,
      { provide: DbService, useValue: db }, { provide: LogService, useValue: log },
      { provide: UsuariosService, useValue: {} }, { provide: AlmacenService, useValue: {} },
      { provide: MateriasService, useValue: {} }] });
    service = TestBed.inject(GruposDataService);
  });

  for (const origen of [ORIGEN.MSSQL, ORIGEN.ORACLE]) {
    it('devuelve el canónico con una mutación para ' + origen, async () => {
      const entrada = crearGrupoGuardado(origen);
      const canonico = crearGrupoGuardado(origen);
      canonico.cupoGeneral = 35;
      db.mutation.and.returnValue(Promise.resolve(canonico));
      expect(await service.guardarGrupoDBO(entrada)).toBe(canonico);
      expect(db.mutation).toHaveBeenCalledTimes(1);
      expect(db.query).not.toHaveBeenCalled();
      expect(log.guardarBitacora).not.toHaveBeenCalled();
    });
    for (const mensaje of ['Timeout', 'Respuesta GraphQL sin datos', 'Unknown type "GrupoInput"',
      'Cannot query field "guardarGrupo"', 'No autorizado']) {
      for (const cambios of [undefined, []]) {
        it('no activa legacy tras ' + mensaje + ' en ' + origen + (cambios ? ' con lista vacía' : ' sin lista'), async () => {
          const error = new Error(mensaje);
          db.mutation.and.callFake(async () => { throw error; });
          await expectAsync(service.guardarGrupoDBO(crearGrupoGuardado(origen), cambios)).toBeRejectedWith(error);
          expect(db.mutation).toHaveBeenCalledTimes(1);
          expect(db.query).not.toHaveBeenCalled();
          expect(log.guardarBitacora).not.toHaveBeenCalled();
        });
      }
    }
  }

  it('rechaza una raíz nula sin iniciar otra escritura', async () => {
    db.mutation.and.returnValue(Promise.resolve(null));
    await expectAsync(service.guardarGrupoDBO(crearGrupoGuardado())).toBeRejected();
    expect(db.mutation).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });
});
