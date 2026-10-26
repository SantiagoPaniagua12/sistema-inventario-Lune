import type {Supply} from './supplies';
const definitions=[
 ['empaque-sorbetes-plastico','Sorbetes de plástico','Empaques','unidad'],
 ['empaque-vasos-frapp','Vasos de frapp descartables','Empaques','unidad'],
 ['empaque-vasos-cafe-grandes','Vasos de café grandes','Empaques','unidad'],
 ['empaque-vasos-cafe-pequenos','Vasos de café pequeños','Empaques','unidad'],
 ['empaque-bolsas-papel-grandes','Bolsas de papel grandes','Empaques','unidad'],
 ['empaque-bolsas-papel-medianas','Bolsas de papel medianas','Empaques','unidad'],
 ['empaque-bolsas-papel-pequenas','Bolsas de papel pequeñas','Empaques','unidad'],
 ['empaque-cucharitas','Cucharitas descartables','Empaques','unidad'],
 ['papeleria-boletas','Papel de impresión de boletas','Papelería','rollo'],
 ['papeleria-izipay','Papel de impresión de Izipay','Papelería','rollo'],
 ['papeleria-stickers-lune','Stickers logos de Lune','Papelería','unidad'],
 ['papeleria-tarjetas','Tarjetas de presentación','Papelería','unidad'],
] as const;
export const supplyNameKey=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim().replace(/\s+/g,' ');
export function salonSupplies():Supply[]{return definitions.map(([id,name,group,unit])=>({id,name,group,unit,stock:null,minimum:null,capacityMl:null,packSize:1,note:unit==='rollo'?'Control por rollos. Registra el conteo real.':'Control por unidades individuales. Registra el conteo real.',estimated:false}));}
