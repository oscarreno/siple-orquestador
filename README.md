# SIPLE Orquestador

Este repositorio coordina el trabajo que atraviesa los proyectos SIPLE. El código de la aplicación vive en los repositorios separados de Front y Back; aquí se mantienen los contratos compartidos, las especificaciones, los planes y los handoffs entre equipos.

## Organización

- `docs/contratos/`: contratos compartidos de API, permisos y políticas.
- `docs/cambioGrupos/`: historial de fases y decisiones del trabajo de cambios de grupos.
- `docs/proyectos/<proyecto>/`: documentación vigente por proyecto. Por ejemplo, [edición de espacios](docs/proyectos/edicion-espacios/README.md).
- `docs/plantillas.md`: plantillas disponibles para documentar el trabajo.
- `plan-de-trabajo-guardar-grupo-segmentado.md` y `orquestador-guardar-por-partes.md`: plan e implementación coordinada para el guardado segmentado de grupos.

## Flujo de trabajo

1. Acordar aquí los requisitos, contratos y decisiones que afectan a más de un repositorio.
2. Implementar los cambios en Front y Back, manteniendo sus responsabilidades y versiones del contrato alineadas.
3. Registrar en la documentación del proyecto los comandos ejecutados, sus resultados y las validaciones que queden pendientes.

## Validación

Este repositorio no contiene una aplicación ni una suite de pruebas propia. Para cambios de documentación, revisar enlaces y ejecutar:

```powershell
git diff --check
git status --short
rg --files -g '*.md'
```

Las validaciones de código deben ejecutarse en los repositorios Front o Back correspondientes y documentarse en el handoff del proyecto.
