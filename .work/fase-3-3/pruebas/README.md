# Pruebas ejecutables del Backend

Estos scripts son verificaciones aisladas del Backend. No forman parte del
arranque productivo y no se conectan a la base de datos cuando usan sus dobles
de persistencia.

Desde la raíz de `siple-backTS`:

```text
npm run validar:guardar-grupo
npm run validar:bitacora-publica
npm run validar:auditoria-servidor
npm run validar:todas
```

Las pruebas Angular del Front permanecen junto a los componentes y servicios
que validan, como requiere su descubrimiento normal por Angular CLI.
