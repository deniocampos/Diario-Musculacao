/* Diário Ciclo 3 — gerador de PDF local, sem biblioteca externa.
   Lê PLAN e state em memória; não altera nem grava cargas/sessões.
   Suporta PDF A4 de cinco páginas, 32 links e formato semelhante à ficha oficial.
*/
(function (global) {
  'use strict';
  const W = 595.28, H = 841.89;
  const colors = {
    navy: '#122733', teal: '#12878c', mint: '#a6e7e2', ink: '#182d3a',
    gray: '#637784', line: '#d5e2e5', pale: '#f3f7f8', white: '#ffffff'
  };
  const titles = {
    A: ['TREINO A - PEITO / TRÍCEPS / BÍCEPS', 'Peito + tríceps + bíceps | 12 séries de peito, 9 de tríceps e 5 de bíceps'],
    B: ['TREINO B - PERNAS / CORE', 'Quadríceps + panturrilha + core/lombar | preservado do Ciclo 2'],
    C: ['TREINO C - COSTAS / BÍCEPS / TRÍCEPS', 'Costas + bíceps + tríceps + antebraço | 9 séries de bíceps e 3 de tríceps'],
    D: ['TREINO D - POSTERIOR / OMBROS / CORE', 'Posterior/glúteos + ombros + core/lombar | preservado do Ciclo 2']
  };
  const footnotes = {
    A: 'A3: referência do SHUA Pectoral Fly. A6: 25 kg na unidade principal. Compare cargas somente em aparelhos equivalentes.',
    B: 'B4 (25 kg) e B5 (30 kg): cargas confirmadas em 21/11/2026. B7: abdominal deitado substituiu polia.',
    C: 'C8: rosca inversa Cross era substituição do antigo C7. O novo C7 (tríceps) começa sem carga-base.',
    D: 'Prancha lateral: referência anterior de 45 s por lado. Priorize estabilidade e execução controlada.'
  };

  function cp1252(ch) {
    const map = {'€':128,'‚':130,'ƒ':131,'„':132,'…':133,'†':134,'‡':135,'ˆ':136,'‰':137,'Š':138,'‹':139,'Œ':140,'Ž':142,'‘':145,'’':146,'“':147,'”':148,'•':149,'–':150,'—':151,'˜':152,'™':153,'š':154,'›':155,'œ':156,'ž':158,'Ÿ':159};
    const cp = ch.codePointAt(0);
    if (Object.prototype.hasOwnProperty.call(map, ch)) return map[ch];
    if (cp >= 32 && cp <= 255) return cp;
    if (cp === 9 || cp === 10 || cp === 13) return 32;
    return 63;
  }
  function hexStr(s) {
    return Array.from(String(s)).map(c => cp1252(c).toString(16).padStart(2,'0')).join('').toUpperCase();
  }
  function pdfMeasure(s, fontsize, bold=false) {
    let units=0;
    for (const c of String(s)) {
      if ('ijlI.,:;!|\'` '.includes(c)) units += .29;
      else if ('mwMW@%'.includes(c)) units += .86;
      else if ('-()[]'.includes(c)) units += .38;
      else units += bold ? .575 : .515;
    }
    return units * fontsize;
  }
  function clipText(s, width, fontsize, bold=false) {
    let t=String(s || '');
    if (pdfMeasure(t,fontsize,bold)<=width) return t;
    while (t.length>0 && pdfMeasure(t+'...',fontsize,bold)>width) t=t.slice(0,-1);
    return t+'...';
  }
  function wrapText(s, width, fontsize, bold=false) {
    const out=[];
    let line='';
    for(const word of String(s).split(/\s+/)) {
      if(!word) continue;
      const proposed=line?line+' '+word:word;
      if(pdfMeasure(proposed,fontsize,bold)>width && line){out.push(line);line=word;} else line=proposed;
    }
    if(line)out.push(line);
    return out;
  }
  function fmtNum(n){return String(n).replace('.',',');}
  function unitShort(u) {return u === 'principal' ? 'principal' : u === 'reduzida' ? 'reduzida' : 'não informada';}
  function validDate(s){const k=Date.parse(s||'');return Number.isFinite(k)?k:0;}
  function latestRecords(state) {
    const latest={};
    let order=0;
    function consider(record, fallback) {
      if(!record||!/^[ABCD][1-8]$/.test(record.code||''))return;
      if(record.kg===null && !record.body) return;
      const stamp=validDate(record.ts)||Number(fallback)||0;
      const candidate={r:record,stamp,order:++order};
      const prev=latest[record.code];
      if(!prev||candidate.stamp>prev.stamp||(candidate.stamp===prev.stamp&&candidate.order>prev.order)) latest[record.code]=candidate;
    }
    for(const a of state?.archive||[])for(const r of Object.values(a?.records||{}))consider(r,a.closed||a.created||0);
    for(const r of Object.values(state?.records||{}))consider(r,state.created||Date.now());
    return Object.fromEntries(Object.entries(latest).map(([k,v])=>[k,v.r]));
  }
  function lastFor(ex,record,useSaved) {
    if(useSaved&&record) {
      const reps=String(record.reps||'').trim();
      const kg=record.body?'Peso corporal':typeof record.kg==='number'?fmtNum(record.kg)+' kg':'Sem carga';
      return {
        summary:'Último: '+kg+' / '+reps+(ex.time?' s':' rep.')+' (Ciclo 3'+(record.complete?'':', parcial')+')',
        origin:'Pegada: '+ex.pegada+' | Unidade '+unitShort(record.gym)+(record.sub?' | Subst.: '+record.sub:''),
        updated: true
      };
    }
    if(ex.last!==null&&ex.last!==undefined) {
      return {
        summary:'Última: '+fmtNum(ex.last)+' kg / '+String(ex.lastReps??'-')+(ex.time?' s':' rep.')+' (referência Ciclo 2)',
        origin:'Pegada: '+ex.pegada+(ex.unit?' | Unidade '+unitShort(ex.unit):''),
        updated:false
      };
    }
    if(ex.lastReps!==null&&ex.lastReps!==undefined) {
      return {summary:'Último resultado: '+ex.lastReps+(ex.time?' s':' rep.')+' (peso corporal)',origin:'Pegada: '+ex.pegada,updated:false};
    }
    return {summary:'Última referência: sem carga registrada (novo exercício)',origin:'Pegada: '+ex.pegada,updated:false};
  }
  function toRgb(hex){const c=hex.replace('#','');return [0,2,4].map(i=>(parseInt(c.slice(i,i+2),16)/255).toFixed(3)).join(' ');}
  function createCanvas(){
    const content=[];const links=[];
    function rect(x,top,w,h,fill,stroke){
      const y=H-top-h;
      if(fill)content.push(toRgb(fill)+' rg');
      if(stroke)content.push(toRgb(stroke)+' RG 0.65 w');
      content.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fill&&stroke?'B':fill?'f':'S'}`);
    }
    function line(x1,t1,x2,t2,color=colors.line,width=.7){
      content.push(toRgb(color)+` RG ${width} w ${x1} ${(H-t1).toFixed(2)} m ${x2} ${(H-t2).toFixed(2)} l S`);
    }
    function text(x,top,s,size=10,color=colors.ink,bold=false,maxWidth){
      const val=maxWidth?clipText(s,maxWidth,size,bold):String(s);
      content.push('BT '+(bold?'/F2':'/F1')+' '+size.toFixed(2)+' Tf '+toRgb(color)+' rg 1 0 0 1 '+x.toFixed(2)+' '+(H-top).toFixed(2)+' Tm <'+hexStr(val)+'> Tj ET');
    }
    function textLines(x,top,s,width,fontSize=9,color=colors.gray,lineHeight=13,bold=false,maxLines=3){
      const ls=wrapText(s,width,fontSize,bold);
      for(let i=0;i<Math.min(maxLines,ls.length);i++)text(x,top+i*lineHeight,i===maxLines-1?clipText(ls[i],width,fontSize,bold):ls[i],fontSize,color,bold,width);
    }
    function link(x,top,w,h,url){if(url&&/^https:\/\//.test(url))links.push({x,top,w,h,url});}
    return {rect,line,text,textLines,link,content,links};
  }
  function header(cv,page,title,subtitle,dateStr){
    cv.rect(0,0,W,104,colors.navy);
    cv.text(34,29,'FICHA OFICIAL DE HIPERTROFIA',18,colors.white,true);
    cv.text(34,47,'CICLO 3  •  A/B/C/D  •  GERADA PELO DIÁRIO',10.3,colors.mint,true);
    cv.text(34,77,title,12.5,colors.white,true,510);
    cv.text(546,48,page+'/5',9,colors.white,false);
    cv.text(34,125,subtitle,9.5,colors.gray,false,520);
    cv.line(34,802,561,802,colors.line,.8);
    cv.text(34,817,'Cargas do diário e referências históricas; séries sinalizadas não são verificação física.',8,colors.gray);
    cv.text(535,817,page+'/5',8,colors.gray);
  }
  function drawSummary(cv,records,useSaved,dateStr){
    header(cv,1,'RESUMO DE ESTRUTURA, PROGRESSÃO E HISTÓRICO','Ficha atualizada automaticamente a partir dos exercícios cadastrados no aplicativo.');
    cv.text(34,156,'Gerado em '+dateStr,9.5,colors.teal,true);
    const descriptions=[
      ['A','Peito + tríceps + bíceps','12 séries de peito, 9 de tríceps e 5 de bíceps.'],
      ['B','Quadríceps + panturrilha + core/lombar','Treino preservado do Ciclo 2.'],
      ['C','Costas + bíceps + tríceps + antebraço','9 séries de bíceps e 3 de tríceps.'],
      ['D','Posterior + ombros + core/lombar','Treino preservado do Ciclo 2.']
    ];
    for(let i=0;i<descriptions.length;i++){
      const [code,title,desc]=descriptions[i];const y=181+i*87;
      cv.rect(34,y,527,76,i%2===0?colors.pale:colors.white,colors.line);
      cv.rect(47,y+15,43,44,colors.teal);
      cv.text(60,y+43,code,20,colors.white,true);
      cv.text(102,y+27,title,12.5,colors.ink,true,434);
      cv.text(102,y+45,desc,9.1,colors.gray,false,434);
      cv.text(102,y+60,'8 exercícios · treino em dias alternados',8.7,colors.gray,false);
    }
    cv.text(34,558,'DIRETRIZES DE USO',12,colors.ink,true);
    const guidelines=[
      'Bíceps: 14 séries diretas por ciclo (A + C). Tríceps: 12 séries por ciclo (A + C).',
      useSaved?'Cargas do Ciclo 3 vêm dos registros locais mais recentes, inclusive sessões arquivadas.':'Mostrando cargas-base históricas do Ciclo 2, sem usar registros do Ciclo 3.',
      'Quando faltar registro do Ciclo 3, a referência histórica do Ciclo 2 permanece identificada.',
      'Mantenha nome do aparelho, unidade e eventuais substituições ao comparar cargas.',
      'Descansos, séries, repetições, pegadas e vídeos seguem o plano aprovado.',
      'Em caso de dor lombar, interrompa e reavalie; não adicione automaticamente stiff ou terra.'
    ];
    let y=584;
    guidelines.forEach((s)=>{cv.rect(35,y-8,4,4,colors.teal);cv.textLines(47,y,s,505,9.1,colors.gray,12.5,false,2);y+=27;});
    const total=Object.keys(records).length;
    cv.rect(34,749,527,36,colors.pale,colors.line);
    cv.text(47,772,'Registros do Ciclo 3 encontrados neste dispositivo: '+total+' de 32 exercícios.',10,colors.ink,true);
  }
  function drawTraining(cv,key,arr,records,useSaved){
    header(cv,'ABCD'.indexOf(key)+2,titles[key][0],titles[key][1]);
    let updatedCount=0;
    for(let i=0;i<8;i++){
      const ex=arr[i];
      const rowTop=155+i*73.2;
      const info=lastFor(ex,records[ex.code],useSaved);
      if(info.updated)updatedCount++;
      cv.rect(34,rowTop,527,70,i%2===0?colors.pale:colors.white,colors.line);
      cv.rect(46,rowTop+13,41,27,colors.teal);
      cv.text(53,rowTop+31,ex.code,12,colors.white,true);
      cv.text(98,rowTop+21,ex.name,11.2,colors.ink,true,265);
      cv.text(98,rowTop+42,info.summary,8.7,colors.gray,false,287);
      cv.text(98,rowTop+59,info.origin,8,colors.gray,false,302);
      cv.text(396,rowTop+21,ex.series+' × '+String(ex.reps).replace(/-/g,'–'),10.5,colors.ink,true,150);
      cv.text(396,rowTop+40,'Descanso: '+ex.rest+' s',9,colors.gray,false);
      cv.text(476,rowTop+59,'VER VÍDEO',9.3,colors.teal,true);
      cv.line(477,rowTop+61,530,rowTop+61,colors.teal,.7);
      cv.link(466,rowTop+41,82,23,ex.video);
    }
    cv.textLines(34,762,'OBSERVAÇÃO: '+footnotes[key],527,8.8,colors.gray,13,false,2);
    return updatedCount;
  }
  function build(PLAN,state,{useSaved=true,date=new Date()}={}){
    if(!PLAN||!['A','B','C','D'].every(x=>Array.isArray(PLAN[x])&&PLAN[x].length===8))throw new Error('Ficha de exercícios inválida.');
    const records=latestRecords(state||{});
    const dateStr=date.toLocaleDateString('pt-BR');
    const canvases=[];
    const summary=createCanvas();drawSummary(summary,records,useSaved,dateStr);canvases.push(summary);
    for(const key of ['A','B','C','D']){
      const cv=createCanvas();drawTraining(cv,key,PLAN[key],records,useSaved);canvases.push(cv);
    }
    const objects=[null];
    const add=obj=>{objects.push(obj);return objects.length-1;};
    const catalogId=add('');const pagesId=add('');
    const fontId=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontBoldId=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pageIds=[];
    for(const cv of canvases){
      const stream=cv.content.join('\n')+'\n';
      const streamId=add('<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream');
      const annotationIds=cv.links.map(l=>{
        const uri=l.url.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
        const y1=H-l.top-l.h,y2=H-l.top;
        return add(`<< /Type /Annot /Subtype /Link /Rect [${l.x} ${y1.toFixed(2)} ${(l.x+l.w).toFixed(2)} ${y2.toFixed(2)}] /Border [0 0 0] /A << /S /URI /URI (${uri}) >> >>`);
      });
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${streamId} 0 R /Annots [${annotationIds.map(i=>i+' 0 R').join(' ')}] >>`));
    }
    objects[pagesId]=`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(x=>x+' 0 R').join(' ')}] >>`;
    objects[catalogId]=`<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    let doc='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets=[0];
    for(let i=1;i<objects.length;i++){
      offsets.push(doc.length);
      doc+=`${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefPos=doc.length;
    doc+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for(let i=1;i<objects.length;i++)doc+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
    doc+=`trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    const bytes=new Uint8Array(doc.length);
    for(let i=0;i<doc.length;i++)bytes[i]=doc.charCodeAt(i)&255;
    return new Blob([bytes],{type:'application/pdf'});
  }
  global.Ciclo3Pdf={build,latestRecords};
})(typeof window !== 'undefined' ? window : globalThis);

(function initUi(){
 'use strict';
 if(typeof document==='undefined')return;
 const $=id=>document.getElementById(id);
 const btn=$('generate-pdf'),shareBtn=$('share-pdf'),useStored=$('pdf-use-logs'),status=$('pdf-status');
 if(!btn||!shareBtn||!useStored)return;
 function snapshot(){
   const selected=$('pdf-use-logs').checked;
   return window.Ciclo3Pdf.build(PLAN,state,{useSaved:selected});
 }
 function name(){return 'FICHA_HIPERTROFIA_CICLO_3_ATUALIZADA_'+new Date().toISOString().slice(0,10)+'.pdf';}
 function download(){
   try{
     const blob=snapshot();const url=URL.createObjectURL(blob),a=document.createElement('a');
     a.href=url;a.download=name();a.style.display='none';document.body.appendChild(a);a.click();a.remove();
     setTimeout(()=>URL.revokeObjectURL(url),60000);
     status.textContent='PDF gerado com os dados atuais. Se o arquivo abrir em vez de baixar, use Compartilhar > Salvar em Arquivos.';
   }catch(e){status.textContent='Falha ao gerar PDF: '+String(e.message||e);}
 }
 async function share(){
   try{
     const blob=snapshot(),file=new File([blob],name(),{type:'application/pdf'});
     if(navigator.canShare&&navigator.canShare({files:[file]})&&navigator.share){
       await navigator.share({files:[file],title:'Ficha oficial de hipertrofia — Ciclo 3'});
       status.textContent='PDF gerado. Confira o destino escolhido no menu Compartilhar.';
     }else{
       download();status.textContent='Compartilhamento direto não disponível. Foi solicitado o download do PDF.';
     }
   }catch(e){if(e.name!=='AbortError')status.textContent='Não foi possível abrir o compartilhamento: '+String(e.message||e);}
 }
 btn.addEventListener('click',download);
 shareBtn.addEventListener('click',share);
})();
