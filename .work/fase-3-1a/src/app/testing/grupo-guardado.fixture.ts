import { Grupo } from '../models/Grupo.';
import { Materia } from '../models/Materia';
import { ORIGEN } from '../models/Origen';

export function crearGrupoGuardado(origen = ORIGEN.MSSQL): Grupo {
  const materia = new Materia(origen, '123', 'Materia de prueba', 'DEP', 6, 30, 'MAT', 'G', 3, 'Licenciatura', 0);
  return new Grupo(origen, origen + '|2026|G1', '2026', 'G1', materia,
    'REINGRESO', 'Español', 30, 10, 20, 0, 20, 40,
    true, true, false, false, false, false, false, '',
    { clave: '1', nombre: 'Normal' }, { clave: '1', nombre: 'Presencial' },
    [], [], '', '1', '1', [], [], '', [], [], '');
}
