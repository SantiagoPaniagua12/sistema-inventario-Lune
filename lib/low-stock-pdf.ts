import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { lowSupplies, unitLabel, type Supply } from './supplies';
function encodable(text: string, font: PDFFont): string {
  return [...text].map(c => { try { font.encodeText(c); return c; } catch { return '?'; } }).join('');
}
function wrap(text: string, width: number, font: PDFFont, size: number): string[] {
  const lines: string[] = []; let line = '';
  for (const character of encodable(text,font)) {
    if (font.widthOfTextAtSize(line+character,size) > width && line) {
      const space = line.lastIndexOf(' ');
      if (space > 0) { lines.push(line.slice(0,space).trim()); line=line.slice(space+1); }
      else { lines.push(line.trim()); line=''; }
    }
    line += character;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.length ? lines : [''];
}
export async function lowStockPdf(supplies: Supply[], options: { inclusive?: boolean; group?: string; at?: Date } = {}) {
  const all = supplies.filter(i => !options.group || i.group === options.group);
  const rows = lowSupplies(all, options.inclusive).sort((a,b) => a.group.localeCompare(b.group,'es') || a.name.localeCompare(b.name,'es'));
  const doc = await PDFDocument.create();
  doc.setTitle('Lune - Insumos para reposición'); doc.setAuthor('Lune Alta Pastelería');
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.16,.28,.21), muted = rgb(.39,.46,.41), pale = rgb(.94,.96,.93);
  const stamp = new Intl.DateTimeFormat('es-PE',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'}).format(options.at ?? new Date());
  let page = doc.addPage([595.28,841.89]), y = 0;
  const columns = [42,132,337,417,482], widths = [80,195,70,55,65];
  const draw = (text: string, x: number, baseline: number, size = 9, weight = false) => page.drawText(encodable(text,weight ? bold : font),{x,y:baseline,size,font:weight ? bold : font,color:weight ? ink : muted});
  function heading() {
    y = 800;
    draw('LUNE',42,y,12,true); draw('Inventario | Beta 0.2',413,y,9);
    y-=34; draw('Insumos para reposición',42,y,23,true);
    y-=22; draw(`Generado: ${stamp} (America/Lima)`,42,y,9);
    y-=17; draw(options.inclusive ? 'Criterio: stock menor o igual al mínimo, incluidos agotados.' : 'Criterio: stock por debajo del mínimo, incluidos agotados.',42,y,9);
    y-=17; draw(`${rows.length} por revisar | ${all.filter(i=>i.stock===null).length} sin conteo excluidos | ${all.filter(i=>i.minimum===null).length} sin mínimo definido`,42,y,9);
    if (options.group) { y-=17; draw(`Categoría: ${options.group}`,42,y,9); }
    y-=32;
    page.drawRectangle({x:42,y:y-9,width:511,height:25,color:pale});
    ['CATEGORÍA','INSUMO','DISPONIBLE','MÍNIMO','ESTADO'].forEach((t,i)=>draw(t,columns[i]+4,y,8,true));
    y-=27;
  }
  heading();
  if (!rows.length) {
    for (const line of wrap('No hay insumos que cumplan el criterio. Los productos sin conteo no se consideran agotados. Registra sus existencias y configura sus mínimos para completar el reporte.',490,font,11)) { draw(line,46,y,11); y-=18; }
  }
  for (const item of rows) {
    const cells = [item.group,item.name,`${item.estimated ? '~ ' : ''}${item.stock} ${unitLabel(item.unit)}`,item.minimum === null ? 'Sin definir' : `${item.minimum}`,item.stock===0 ? 'AGOTADO' : 'BAJO'];
    const lines = cells.map((text,i)=>wrap(text,widths[i],i===1?bold:font,8.5));
    const height = Math.max(...lines.map(l=>l.length))*12+18;
    if (y-height < 75) { page = doc.addPage([595.28,841.89]); heading(); }
    lines.forEach((cell,i)=>cell.forEach((line,n)=>draw(line,columns[i]+4,y-n*12,8.5,i===1)));
    page.drawLine({start:{x:42,y:y-height+9},end:{x:553,y:y-height+9},thickness:.5,color:rgb(.87,.9,.86)});
    y-=height;
  }
  const pages = doc.getPages();
  pages.forEach((p,index)=>{
    p.drawText('Las cantidades con ~ son estimadas. Sin sugerencia automática de compra.',{x:42,y:43,size:8,font,color:muted});
    p.drawText(`${index+1} / ${pages.length}`,{x:516,y:43,size:8,font,color:muted});
  });
  return doc.save();
}
