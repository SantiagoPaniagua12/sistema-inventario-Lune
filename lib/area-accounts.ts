export const AREA_ACCOUNTS={
  cocina:{name:'Cocina',login:'cocina',email:'cocinalune@gmail.com'},
  mozo:{name:'Salón',login:'salon',email:'salonlune@gmail.com'},
} as const;
export type AreaRole=keyof typeof AREA_ACCOUNTS;
export function loginArea(value:string):AreaRole|undefined{
  const key=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  return key==='cocina'?'cocina':['salon','mozos'].includes(key)?'mozo':undefined;
}
