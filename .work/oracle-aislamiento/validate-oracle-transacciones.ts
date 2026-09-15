import * as assert from 'assert';
import Oracle from '../src/system/oracle';
import driver from '../src/system/oracledbCompat';
import Utils from '../src/system/utils';

async function main() {
  const originalCreatePool = driver.createPool;
  const originalLog = Utils.Mensaje;
  const conexiones: any[] = [];
  let pools = 0;
  let fallarPool = false;
  let fallarAdquisicion = false;
  const nuevoOracle = () => new (Oracle as any)() as Oracle;
  const envKeys = ['NODE_ORACLEDB_CONNECTIONSTRING', 'NODE_ORACLEDB_USER'];
  const originalEnv = envKeys.map(key => process.env[key]);
  envKeys.forEach(key => process.env[key] = 'simulado');
  Utils.Mensaje = (() => {}) as any;
  driver.createPool = async () => {
    pools++;
    if (fallarPool) throw new Error('pool');
    return { getConnection: async () => {
      if (fallarAdquisicion) throw new Error('adquisicion');
      const con = {
        eventos: [] as string[],
        failCommit: false, failRollback: false, failClose: false,
        execute: async () => ({ rows: [{ VALOR: 1 }] }),
        commit: async () => { con.eventos.push('commit'); if (con.failCommit) throw new Error('commit'); },
        rollback: async () => { con.eventos.push('rollback'); if (con.failRollback) throw new Error('rollback'); },
        close: async () => { con.eventos.push('close'); if (con.failClose) throw new Error('close'); },
      };
      conexiones.push(con);
      return con;
    } };
  };
  try {
    const oracle = nuevoOracle();
    let liberar!: () => void;
    const barrera = new Promise<void>(resolve => liberar = resolve);
    let participantes = 0;
    const entrar = async () => { if (++participantes === 2) liberar(); await barrera; };
    const vistas: any[] = [];
    const resultados = await Promise.allSettled([
      oracle.withTransaction(async con => { vistas[0] = con; await entrar(); return 'aplicado'; }),
      oracle.withTransaction(async con => { vistas[1] = con; await entrar(); throw new Error('hijo'); }),
    ]);
    assert.strictEqual(pools, 1, 'un pool ante arranque concurrente');
    assert.notStrictEqual(vistas[0], vistas[1]);
    assert.deepStrictEqual(vistas[0].eventos, ['commit', 'close']);
    assert.deepStrictEqual(vistas[1].eventos, ['rollback', 'close']);
    assert.deepStrictEqual(resultados[0], { status: 'fulfilled', value: 'aplicado' });
    assert.strictEqual(resultados[1].status, 'rejected');

    await Promise.all([oracle.query('simulado'), oracle.query('simulado')]);
    const legacy = (oracle as any).conn;
    assert.ok(legacy && !vistas.includes(legacy));
    assert.strictEqual(conexiones.length, 3, 'lecturas legacy comparten una adquisición');
    await oracle.withTransaction(async con => assert.notStrictEqual(con, legacy));
    assert.deepStrictEqual(legacy.eventos, [], 'no confirmar ni cerrar conexión legacy');

    await assert.rejects(oracle.withTransaction(async con => {
      con.failCommit = true;
    }), /commit/);
    assert.deepStrictEqual(conexiones[conexiones.length - 1].eventos, ['commit', 'rollback', 'close']);
    const falloOriginal = new Error('original');
    await assert.rejects(oracle.withTransaction(async con => {
      con.failRollback = true; con.failClose = true; throw falloOriginal;
    }), error => error === falloOriginal);
    assert.deepStrictEqual(conexiones[conexiones.length - 1].eventos, ['rollback', 'close']);
    assert.strictEqual(await oracle.withTransaction(async con => {
      con.failClose = true; return 'confirmado';
    }), 'confirmado');
    assert.deepStrictEqual(conexiones[conexiones.length - 1].eventos, ['commit', 'close']);

    let llamado = false;
    fallarAdquisicion = true;
    await assert.rejects(oracle.withTransaction(async () => { llamado = true; }), /adquisicion/);
    assert.strictEqual(llamado, false);
    fallarAdquisicion = false;
    const recuperable = nuevoOracle();
    fallarPool = true;
    await assert.rejects(recuperable.withTransaction(async () => 1), /pool/);
    fallarPool = false;
    assert.strictEqual(await recuperable.withTransaction(async () => 2), 2);
    console.log('OK: aislamiento concurrente, pool único, separación legacy, commit, rollback, liberación y recuperación. Sin BD.');
  } finally {
    driver.createPool = originalCreatePool;
    Utils.Mensaje = originalLog;
    envKeys.forEach((key, i) => {
      if (originalEnv[i] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[i];
    });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
