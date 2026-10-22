import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { seed, execute, type State, type Command } from './inventory';
import { validateBackup } from './backup';
import { getPostgresState, mutatePostgres } from './postgres-store';
import { initialSupplies } from './supplies';
import { assertInventoryWritable } from './maintenance';
import { AccessError, type Actor } from './access';
const directory = path.join(process.cwd(), 'data');
const file = path.join(directory, 'inventory.json');
const globalStore = globalThis as typeof globalThis & { inventoryQueue?: Promise<unknown> };
async function read(): Promise<State> {
  try { const state = JSON.parse(await readFile(file, 'utf8')) as State; return { ...state, supplies: state.supplies ?? initialSupplies(), supplyMovements: state.supplyMovements ?? [] }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return seed(); throw error; }
}
export async function getState() {
  if (['postgres','supabase'].includes(process.env.INVENTORY_STORAGE ?? '')) return getPostgresState();
  await globalStore.inventoryQueue?.catch(() => {}); return read();
}
export async function mutate(command: Command, actor?: Actor): Promise<State> {
  await assertInventoryWritable();
  if (['postgres','supabase'].includes(process.env.INVENTORY_STORAGE ?? '')) return mutatePostgres(command,actor);
  if(actor) throw new AccessError('El acceso con usuarios requiere la base de datos.',503);
  const task = (globalStore.inventoryQueue ?? Promise.resolve()).catch(() => {}).then(async () => {
    const current = await read();
    let state: State;
    if (command.type === 'restore') {
      if (command.revision !== current.revision) throw new Error('Los datos cambiaron. Actualiza la página y vuelve a intentar.');
      state = validateBackup(command.backup);
      state.revision = current.revision + 1;
    } else {
      state = execute(current, command);
    }
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `inventory-${crypto.randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
    await rename(temporary, file);
    return state;
  });
  globalStore.inventoryQueue = task;
  return task;
}
