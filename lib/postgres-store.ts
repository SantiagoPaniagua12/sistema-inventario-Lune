import type { PoolClient } from 'pg';
import { execute, sales, personKey, type State, type Command, type Movement } from './inventory';
import { databaseError, getPgPool, pgTransaction } from './postgres';
import { readSupplies, persistSupplyCommand } from './supplies-store';
import { readExcelImports, persistExcelImport } from './excel-store';
import { assertInventoryWritable } from './maintenance';
import { AccessError, authorizeCommand, type Actor } from './access';

const day = (value: Date | string) => typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
const timestamp = (value: Date | string) => new Date(value).toISOString();
const movementTypes: Record<string, string> = { produccion: 'Producción', reposicion: 'Retiro de producción', horneado: 'Horneado', merma: 'Ajuste histórico' };

async function readPg(client: PoolClient): Promise<State> {
  const control = await client.query('SELECT revision FROM inventario_control WHERE id = 1');
  if (!control.rowCount) throw new Error('Ejecuta npm run db:setup para preparar el inventario.');
  const products = await client.query(`SELECT p.*, c.nombre_categoria FROM productos p JOIN categorias c USING (id_categoria) ORDER BY p.id_producto`);
  const lots = await client.query(`SELECT l.id_lote,l.id_producto,l.fecha_produccion::text,l.observaciones,l.rendimiento,a.nombre_usuario, COALESCE((SELECT SUM(CASE WHEN m.sentido='entrada' THEN m.cantidad ELSE -m.cantidad END)
    FROM movimiento_inventario m JOIN ubicaciones u USING (id_ubicacion)
    WHERE m.id_lote=l.id_lote AND u.tipo='congelador'),0)::int AS cantidad FROM lotes l JOIN usuarios a ON a.id_usuario=l.creado_por ORDER BY l.id_lote`);
  const shifts = await client.query(`SELECT t.id_turno,t.fecha::text,t.periodo,t.estado,t.abierto_en,t.cerrado_en,u.nombre_usuario FROM turnos t JOIN usuarios u ON u.id_usuario=t.id_responsable ORDER BY t.fecha, CASE t.periodo WHEN 'manana' THEN 0 ELSE 1 END`);
  const details = await client.query(`SELECT d.*,
    COALESCE(SUM(m.cantidad) FILTER (WHERE m.sentido='entrada' AND m.tipo IN ('reposicion','horneado')),0)::int AS ingresos,
    COALESCE(SUM(m.cantidad) FILTER (WHERE m.sentido='salida' AND m.tipo='merma'),0)::int AS mermas
    FROM detalle_turno d LEFT JOIN movimiento_inventario m ON m.id_turno=d.id_turno AND m.id_producto=d.id_producto
      AND m.id_ubicacion IN (SELECT id_ubicacion FROM ubicaciones WHERE tipo='mostrador')
    GROUP BY d.id_detalle_turno ORDER BY d.id_detalle_turno`);
  const movements = await client.query(`SELECT m.*, u.nombre_usuario FROM movimiento_inventario m
    JOIN usuarios u USING (id_usuario) JOIN ubicaciones b USING (id_ubicacion)
    WHERE (m.tipo='produccion' AND m.sentido='entrada' AND b.tipo='congelador')
    OR (m.tipo IN ('reposicion','horneado') AND m.sentido='entrada' AND b.tipo='mostrador')
    OR (m.tipo='merma' AND m.sentido='salida' AND b.tipo='mostrador')
    ORDER BY m.creado_en DESC, m.id_movimiento_inventario DESC`);
  const unsupported = products.rows.find(p => !['Postres', 'Viennoiserie'].includes(p.nombre_categoria));
  if (unsupported) throw new Error('La beta admite las categorías Postres y Viennoiserie. Revisa el catálogo antes de continuar.');
  const supplyState = await readSupplies(client);
  return {
    ...supplyState,
    excelImports: await readExcelImports(client),
    revision: Number(control.rows[0].revision),
    products: products.rows.map(p => ({ id: String(p.id_producto), name: p.nombre_producto, category: p.nombre_categoria, yield: p.rendimiento, minimum: p.stock_minimo, ...(p.stock_minimo_reserva === undefined ? {} : { reserveMinimum:p.stock_minimo_reserva }) })),
    lots: lots.rows.map(l => ({ id: String(l.id_lote), productId: String(l.id_producto), quantity: l.cantidad, producedAt: day(l.fecha_produccion), note: l.observaciones ?? '', yield: l.rendimiento, responsible: l.nombre_usuario })),
    shifts: shifts.rows.map(s => ({ id: String(s.id_turno), date: day(s.fecha), period: s.periodo === 'manana' ? 'Mañana' : 'Tarde', responsible: s.nombre_usuario, status: s.estado === 'abierto' ? 'open' : 'closed', openedAt: timestamp(s.abierto_en), ...(s.cerrado_en ? { closedAt: timestamp(s.cerrado_en) } : {}), rows: details.rows.filter(d => d.id_turno === s.id_turno).map(d => ({ productId: String(d.id_producto), opening: d.entrada, incoming: d.ingresos, waste: d.mermas, closing: d.conteo_cierre })) })),
    movements: movements.rows.map(m => ({ id: String(m.id_operacion), at: timestamp(m.creado_en), productId: String(m.id_producto), type: movementTypes[m.tipo] ?? m.tipo, quantity: m.cantidad, note: m.motivo ?? '', responsible: m.nombre_usuario, ...(m.id_turno ? { shiftId: String(m.id_turno) } : {}) })),
  };
}

export async function getPostgresState(): Promise<State> {
  let client: PoolClient | undefined;
  try {
    client = await getPgPool().connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const state = await readPg(client);
    await client.query('COMMIT');
    return state;
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw databaseError(error);
  } finally { client?.release(); }
}

// Responsables de registro, sin acceso de inicio de sesión. Nunca son contraseñas.
async function responsibleId(client: PoolClient, name: string, role: 'cocina' | 'mostrador'): Promise<number> {
  if (name.length > 80) throw new Error('El nombre del responsable admite hasta 80 caracteres.');
  const people = await client.query('SELECT id_usuario,nombre_usuario,activo,rol FROM usuarios');
  const found = people.rows.filter(person => personKey(person.nombre_usuario) === personKey(name));
  if (found.length > 1) throw new Error('Hay responsables duplicados con ese nombre. Revisa usuarios.');
  if (found.length) {
    const person = found[0];
    if (!person.activo) throw new Error('El responsable está inactivo.');
    if (person.rol !== role && person.rol !== 'registro') throw new Error(role === 'cocina' ? 'Ese trabajador no pertenece a cocina. Ingresa el nombre del cocinero que preparó el lote.' : 'Ese trabajador no pertenece a mostrador. Ingresa el nombre de quien atiende el turno.');
    // Los registros de la beta anterior reciben su área al usarse de nuevo.
    if (person.rol === 'registro') await client.query('UPDATE usuarios SET rol=$1 WHERE id_usuario=$2', [role, person.id_usuario]);
    return person.id_usuario;
  }
  const inserted = await client.query(`INSERT INTO usuarios (nombre_usuario,password_hash,rol,activo) VALUES ($1,'!',$2,true) RETURNING id_usuario`, [name, role]);
  return inserted.rows[0].id_usuario;
}

export async function mutatePostgres(command: Command, actor?: Actor): Promise<State> {
  return pgTransaction(async client => {
    await assertInventoryWritable();
    const before = await readPg(client);
    if(actor) {
      const result=await client.query('SELECT * FROM perfiles_acceso WHERE auth_id=$1 FOR SHARE',[actor.id]);
      const profile=result.rows[0];
      if(!profile?.activo || profile.cambiar_password) throw new AccessError('La cuenta ya no tiene acceso.');
      if(actor.sessionId){
        if(profile.version_acceso!==actor.accessVersion||(await client.query('SELECT 1 FROM sesiones_revocadas WHERE session_id=$1',[actor.sessionId])).rowCount)throw new AccessError('La sesión fue cerrada.',401);
      }
      actor={...actor,name:profile.nombre,role:profile.rol,mustChangePassword:profile.cambiar_password};
      command=authorizeCommand(actor,command,before);
      // Same transaction as the mutation: failed commands never leave a success audit.
      await client.query('INSERT INTO auditoria_acceso(auth_id,accion,detalle) VALUES($1,$2,$3)',[actor.id,`inventory.${command.type}`,JSON.stringify({revision:before.revision,productId:command.productId,supplyId:command.supplyId,responsable:command.responsible})]);
    }
    if (command.type === 'restore') throw new Error('La restauración JSON solo está disponible en modo local. En PostgreSQL utiliza un respaldo de la base de datos.');
    const after = execute(before, command);
    if (command.type === 'excelImport') {
      await persistExcelImport(client, after.excelImports!.at(-1)!);
      await client.query('UPDATE inventario_control SET revision=revision+1 WHERE id=1');
      return readPg(client);
    }
    if (command.type.startsWith('supply')) {
      await persistSupplyCommand(client, before, after, command);
      await client.query('UPDATE inventario_control SET revision=revision+1 WHERE id=1');
      return readPg(client);
    }
    const active = before.shifts.find(s => s.status === 'open');
    const product = after.products.find(p => p.id === command.productId);
    const displayUnit = 'pieza';
    const frozenUnit = 'pieza';
    const operation = crypto.randomUUID();
    async function movement(options: { productId: string; lotId?: string; location: 'congelador' | 'mostrador'; shiftId?: string; type: string; direction: 'entrada' | 'salida'; quantity: number; unit: string; user: number; note?: string; at?: string }) {
      if (!options.quantity) return;
      const location = await client.query('SELECT id_ubicacion FROM ubicaciones WHERE tipo=$1 ORDER BY id_ubicacion', [options.location]);
      if (location.rowCount !== 1) throw new Error(`Debe existir exactamente una ubicación de tipo ${options.location} para esta beta.`);
      await client.query(`INSERT INTO movimiento_inventario (id_producto,id_lote,id_ubicacion,id_turno,tipo,sentido,cantidad,unidad,id_operacion,id_usuario,motivo,creado_en)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,CURRENT_TIMESTAMP))`,
      [options.productId, options.lotId ?? null, location.rows[0].id_ubicacion, options.shiftId ?? null, options.type, options.direction, options.quantity, options.unit, operation, options.user, options.note ?? null, options.at ?? null]);
    }
    const newLog: Movement | undefined = after.movements.length > before.movements.length ? after.movements[0] : undefined;
    if (command.type === 'product') {
      if (product!.name.length > 100) throw new Error('El nombre del producto admite hasta 100 caracteres.');
      await client.query('UPDATE productos SET nombre_producto=$1,rendimiento=$2,stock_minimo=$3 WHERE id_producto=$4', [product!.name, product!.yield, product!.minimum, product!.id]);
      if (command.reserveMinimum !== undefined) await client.query('UPDATE productos SET stock_minimo_reserva=$1 WHERE id_producto=$2',[product!.reserveMinimum ?? null,product!.id]);
    } else if (command.type === 'createProduct') {
      const added = after.products.at(-1)!;
      if (added.name.length > 100) throw new Error('El nombre del producto admite hasta 100 caracteres.');
      const category = await client.query('SELECT id_categoria FROM categorias WHERE nombre_categoria=$1', [added.category]);
      if (!category.rowCount) throw new Error('No se encontró la categoría del producto. Ejecuta npm run db:setup.');
      const inserted = await client.query('INSERT INTO productos (id_categoria,nombre_producto,rendimiento,stock_minimo,activo) VALUES ($1,$2,$3,$4,true) RETURNING id_producto', [category.rows[0].id_categoria, added.name, added.yield, added.minimum]);
      if (command.reserveMinimum !== undefined) await client.query('UPDATE productos SET stock_minimo_reserva=$1 WHERE id_producto=$2',[added.reserveMinimum ?? null,inserted.rows[0].id_producto]);
      if (active) await client.query('INSERT INTO detalle_turno (id_turno,id_producto,entrada) VALUES ($1,$2,0)', [active.id, inserted.rows[0].id_producto]);
    } else if (command.type === 'open') {
      const shift = after.shifts.at(-1)!;
      const user = await responsibleId(client, shift.responsible, 'mostrador');
      const inserted = await client.query(`INSERT INTO turnos (fecha,periodo,id_responsable,estado,abierto_en) VALUES ($1,$2,$3,'abierto',$4) RETURNING id_turno`, [shift.date, shift.period === 'Mañana' ? 'manana' : 'tarde', user, shift.openedAt]);
      const id = String(inserted.rows[0].id_turno);
      for (const row of shift.rows) {
        await client.query('INSERT INTO detalle_turno (id_turno,id_producto,entrada) VALUES ($1,$2,$3)', [id, row.productId, row.opening]);
        // Solo el primer turno establece el saldo inicial; los siguientes heredan stock.
        if (!before.shifts.length) await movement({ productId: row.productId, location: 'mostrador', shiftId: id, type: 'apertura_inicial', direction: 'entrada', quantity: row.opening, unit: 'pieza', user });
      }
    } else if (command.type === 'produce') {
      const user = await responsibleId(client, newLog!.responsible, 'cocina');
      const lot = after.lots.at(-1)!;
      const inserted = await client.query('INSERT INTO lotes (id_producto,codigo,fecha_produccion,rendimiento,creado_por,observaciones) VALUES ($1,$2,$3,1,$4,$5) RETURNING id_lote', [product!.id, lot.id, lot.producedAt, user, lot.note]);
      await movement({ productId: product!.id, lotId: String(inserted.rows[0].id_lote), location: 'congelador', shiftId: active?.id, type: 'produccion', direction: 'entrada', quantity: lot.quantity, unit: frozenUnit, user, note: lot.note, at: newLog!.at });
    } else if (command.type === 'replenish') {
      const user = await responsibleId(client, newLog!.responsible, 'mostrador');
      const lotId = String(command.lotId);
      const quantity = Number(command.quantity);
      const type = product!.category === 'Postres' ? 'reposicion' : 'horneado';
      const note = `${quantity} unidades retiradas de producción del lote ${lotId} e ingresadas al mostrador.`;
      await movement({ productId: product!.id, lotId, location: 'congelador', shiftId: active!.id, type, direction: 'salida', quantity, unit: frozenUnit, user, note });
      await movement({ productId: product!.id, lotId, location: 'mostrador', shiftId: active!.id, type, direction: 'entrada', quantity, unit: displayUnit, user, note });
    } else if (command.type === 'close') {
      const shift = after.shifts.find(s => s.id === active!.id)!;
      const user = await responsibleId(client, typeof command.responsible==='string'?command.responsible:shift.responsible, 'mostrador');
      for (const row of shift.rows) {
        await client.query('UPDATE detalle_turno SET conteo_cierre=$1 WHERE id_turno=$2 AND id_producto=$3', [row.closing, shift.id, row.productId]);
        await movement({ productId: row.productId, location: 'mostrador', shiftId: shift.id, type: 'venta_calculada', direction: 'salida', quantity: sales(row)!, unit: 'pieza', user, note: 'Salida calculada a partir del conteo físico, incluidas las unidades pagadas por trabajadores. No verificada con caja.' });
      }
      await client.query(`UPDATE turnos SET estado='cerrado',cerrado_en=$1 WHERE id_turno=$2`, [shift.closedAt, shift.id]);
    }
    await client.query('UPDATE inventario_control SET revision=revision+1 WHERE id=1');
    return readPg(client);
  });
}
