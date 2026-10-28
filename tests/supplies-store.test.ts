import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';
import { readSupplies } from '../lib/supplies-store';

test('lectura PostgreSQL conserva cantidades decimales, enteros y conteos pendientes', async () => {
  const base = { categoria: 'Insumos', unidad: 'bolsa', capacidad_ml: null, unidades_por_paquete: 1, observaciones: '', estimado: false, activo: true };
  const results = [
    { rows: [{ ready: true }] },
    { rows: [
      { ...base, id_insumo: 'infusion-0', nombre: 'Infusión Bella Durmiente', stock: '0.50', stock_minimo: '0.25' },
      { ...base, id_insumo: 'infusion-1', nombre: 'Infusión Herbalito', stock: null, stock_minimo: null },
      { ...base, id_insumo: 'insumo-0', nombre: 'Café', stock: '12', stock_minimo: '2' },
      { ...base, id_insumo: 'infusion-2', nombre: 'Infusión Taza de Amor', stock: 0, stock_minimo: 1 },
    ] },
    { rows: [
      { id_movimiento: 'm2', id_insumo: 'infusion-0', tipo: 'salida', cantidad: '0.05', stock_anterior: '0.55', stock_posterior: '0.50', responsable: 'Prueba', motivo: '', estimado: true, creado_en: '2026-10-28T12:00:00Z' },
      { id_movimiento: 'm1', id_insumo: 'infusion-0', tipo: 'conteo', cantidad: '0.55', stock_anterior: null, stock_posterior: '0.55', responsable: 'Prueba', motivo: '', estimado: true, creado_en: '2026-10-28T11:00:00Z' },
    ] },
  ];
  let calls = 0;
  const client = { query: async () => results[calls++] } as unknown as PoolClient;
  const state = await readSupplies(client);
  assert.deepEqual(state.supplies.map(item => [item.stock, item.minimum]), [[0.5, 0.25], [null, null], [12, 2], [0, 1]]);
  assert.deepEqual(state.supplyMovements.map(m => [m.quantity, m.before, m.after]), [[0.05, 0.55, 0.5], [0.55, null, 0.55]]);
  assert.equal(state.supplies[0].capacityMl, null);
  assert.equal(state.supplies[0].packSize, 1);
  assert.equal(state.supplyMovements[0].estimated, true);
  assert.equal(calls, 3);
});
