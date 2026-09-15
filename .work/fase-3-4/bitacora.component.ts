import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IBitacora, LogService } from '../../../services/log.service';
import { Grupo } from 'src/app/models/Grupo.';
import { EventoGenericoService } from 'src/app/services/evento-generico.service';

/**
 * BitacoraComponent - Audit trail display
 * 
 * Shows the change history/audit log for a group, displaying all modifications
 * and status changes made to the group record.
 */
@Component({
  selector: 'app-bitacora',
  templateUrl: './bitacora.component.html',
  styleUrls: ['./bitacora.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class BitacoraComponent {
  readonly grupo = input<Grupo | null>(null);
  readonly bitacora = signal<IBitacora[]>([]);
  readonly filasVisibles = computed<FilaBitacoraVisual[]>(() => this.bitacora().reduce<FilaBitacoraVisual[]>(
    (filas, renglon) => filas.concat(this.expandirRenglon(renglon)),
    [],
  ));
  readonly yaLeyoBitacora = signal(false);
  readonly cargandoBitacora = signal(false);

  private readonly destroyRef = inject(DestroyRef);
  private readonly logService = inject(LogService);
  private readonly eventoGenerico = inject(EventoGenericoService);

  constructor() {
    this.eventoGenerico.eventoObserver()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((evento) => {
        const grupo = this.grupo();
        if (!grupo?.clave || evento.grupo !== grupo.clave) {
          return;
        }

        if (evento.evento === 'tabBitacoraClicked') {
          void this.leerDatos();
          return;
        }

        if (evento.evento === 'grupoGuardado' && this.yaLeyoBitacora()) {
          void this.leerDatos();
        }
      });
  }

  async leerDatos(): Promise<void> {
    const grupo = this.grupo();
    if (!grupo?.origen || !grupo?.clave || !grupo?.periodo) {
      this.bitacora.set([]);
      this.yaLeyoBitacora.set(false);
      return;
    }

    this.cargandoBitacora.set(true);
    this.yaLeyoBitacora.set(true);

    try {
      const bitacora = await this.logService.getBitacoraGrupo(grupo.origen, grupo.clave, grupo.periodo);
      this.bitacora.set(bitacora ?? []);
    } finally {
      this.cargandoBitacora.set(false);
    }
  }

  private expandirRenglon(renglon: IBitacora): FilaBitacoraVisual[] {
    const anterior = this.leerColeccion(renglon.valorAnterior);
    const nuevo = this.leerColeccion(renglon.valorNuevo);
    const total = Math.max(anterior?.length ?? 0, nuevo?.length ?? 0);

    if (total === 0) {
      return [{ ...renglon, esContinuacion: false }];
    }

    return Array.from({ length: total }, (_, indice) => ({
      ...renglon,
      campo: `${renglon.campo} (${indice + 1}/${total})`,
      valorAnterior: anterior && indice < anterior.length ? this.formatearElemento(anterior[indice]) : '',
      valorNuevo: nuevo && indice < nuevo.length ? this.formatearElemento(nuevo[indice]) : '',
      esContinuacion: indice > 0,
    }));
  }

  private leerColeccion(valor: string): unknown[] | null {
    try {
      const resultado = JSON.parse(valor);
      return Array.isArray(resultado) ? resultado : null;
    } catch {
      return null;
    }
  }

  private formatearElemento(valor: unknown): string {
    if (valor === null || valor === undefined) {
      return '';
    }

    return typeof valor === 'object' ? JSON.stringify(valor) ?? '' : `${valor}`;
  }
}

interface FilaBitacoraVisual extends IBitacora {
  esContinuacion: boolean;
}
