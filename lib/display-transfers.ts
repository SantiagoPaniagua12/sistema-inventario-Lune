import type {Product,Shift} from './inventory';

export function displayTransfers(date:string,shifts:Shift[],products:Product[],category:Product['category']|'Todos'='Postres') {
  const catalog=products.filter(product=>category==='Todos'||product.category===category);
  const periods=(['Mañana','Tarde'] as const).map(period=>({period,shift:shifts.find(shift=>shift.date===date&&shift.period===period)}));
  const items=catalog.map(product=>{
    const values=periods.map(({shift})=>shift?.rows.find(row=>row.productId===product.id)?.incoming??null);
    return {id:product.id,name:product.name,morning:values[0],afternoon:values[1],total:(values[0]??0)+(values[1]??0)};
  }).filter(item=>item.total>0).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,'es'));
  return {
    periods,items,
    morning:items.reduce((total,item)=>total+(item.morning??0),0),
    afternoon:items.reduce((total,item)=>total+(item.afternoon??0),0),
    total:items.reduce((total,item)=>total+item.total,0),
  };
}
