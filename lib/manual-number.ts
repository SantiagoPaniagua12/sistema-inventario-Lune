export type ManualNumberRules={min?:number|string;max?:number|string;step?:number|string;decimalPlaces?:number};
export function normalizeManualNumber(value:string,decimalPlaces=0):string|null{
 const normalized=decimalPlaces?value.replace(/,/g,'.'):value;
 const pattern=decimalPlaces?new RegExp(`^\\d*(?:\\.\\d{0,${decimalPlaces}})?$`):/^\d*$/;
 return pattern.test(normalized)?normalized:null;
}
export function manualNumberMessage(value:string,{min,max,step,decimalPlaces=0}:ManualNumberRules={}):string{
 if(value==='')return '';
 const syntax=decimalPlaces?new RegExp(`^\\d+(?:\\.\\d{1,${decimalPlaces}})?$`):/^\d+$/;
 if(!syntax.test(value))return decimalPlaces?'Escribe un número válido.':'Escribe un número entero, incluido el cero.';
 const amount=Number(value);
 if(!Number.isFinite(amount)||(!decimalPlaces&&!Number.isSafeInteger(amount)))return 'La cantidad no es válida.';
 if(min!==undefined&&amount<Number(min))return `La cantidad mínima es ${min}.`;
 if(max!==undefined&&amount>Number(max))return `La cantidad máxima es ${max}.`;
 if(step!==undefined&&step!=='any'&&Number(step)>0){const units=(amount-Number(min??0))/Number(step);if(Math.abs(units-Math.round(units))>1e-7)return 'Revisa los decimales de la cantidad.';}
 return '';
}
