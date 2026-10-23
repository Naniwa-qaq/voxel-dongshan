/* Read-only geographic comparison. Works from file:// using the generated data script. */
(function () {
  'use strict';
  const data = window.DSGeographicAuditData;
  const dialog = document.getElementById('geographicAudit');
  if (!data || !dialog) return;
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => n.toLocaleString('zh-CN', {maximumFractionDigits:1});
  const coords = p => p.wgs84.map(n => n.toFixed(7)).join(', ');
  const link = (url, label) => '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">' + escape(label) + ' ↗</a>';
  const status = p => escape(p.status) + (p.sourceBoundaryCrossesFrame ? ' · 源边界跨图界' : '');
  let showOmitted = true;
  function svg(mode) {
    const source = mode === 'source', points = data.anchors.map(p => ({...p, point:source ? p.sourceLocal : p.design}));
    const extra = source && showOmitted ? data.priorityOmissions.map((p,i) => ({...p, point:p.sourceLocal, number:i+1})) : [];
    const all = points.concat(extra), width=540, height=330, left=45, top=38, right=65, bottom=47;
    const xs=all.map(p=>p.point[0]), zs=all.map(p=>p.point[1]);
    const minX=Math.min(...xs), maxX=Math.max(...xs), minZ=Math.min(...zs), maxZ=Math.max(...zs);
    const scale=Math.min((width-left-right)/(maxX-minX),(height-top-bottom)/(maxZ-minZ));
    const ox=left+((width-left-right)-(maxX-minX)*scale)/2, oz=top+((height-top-bottom)-(maxZ-minZ)*scale)/2;
    const project=p=>[ox+(p[0]-minX)*scale,oz+(p[1]-minZ)*scale];
    const pos = p => project(p.point);
    let out='<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-labelledby="audit-'+mode+'-title audit-'+mode+'-desc">';
    out+='<title id="audit-'+mode+'-title">'+(source?'现实源锚点相对位置':'当前场景锚点相对位置')+'</title>';
    out+='<desc id="audit-'+mode+'-desc">北向上，东西和南北等比例。'+(source?'实心点为4个已表示锚点，空心编号为5处尚未具名复原的场所。':'使用当前场景的中心坐标。两幅图比例尺分别标注。')+'</desc>';
    const grid=source?1000:250;
    for(let x=Math.ceil(minX/grid)*grid;x<=maxX;x+=grid){const p=project([x,minZ]);out+='<path class="audit-gridline" d="M '+p[0]+' 25 V '+(height-32)+'"/>';}
    for(let z=Math.ceil(minZ/grid)*grid;z<=maxZ;z+=grid){const p=project([minX,z]);out+='<path class="audit-gridline" d="M 25 '+p[1]+' H '+(width-25)+'"/>';}
    const route=['luxiang','dongshan-school','chunzailou-garden'].map(id=>pos(points.find(p=>p.id===id)).join(',')).join(' ');
    out+='<polyline class="audit-anchor-line" points="'+route+'"/>';
    const p0=pos(points.find(p=>p.id==='luxiang')), p1=pos(points.find(p=>p.id==='moli-peak'));
    out+='<path class="audit-peak-line" d="M '+p0.join(' ')+' L '+p1.join(' ')+'"/>';
    for(const p of extra){const [x,y]=pos(p);out+='<g class="audit-omission-point"><title>'+escape(p.label)+' · '+escape(p.status)+'</title><circle cx="'+x+'" cy="'+y+'" r="10"/><text x="'+x+'" y="'+(y+3.8)+'" text-anchor="middle">'+p.number+'</text></g>';}
    for(const p of points){const [x,y]=pos(p);const isPeak=p.id==='moli-peak', label=p.id==='chunzailou-garden'?'春在楼宅园':p.label;
      let dx=10,dy=-10,anchor='start';
      if(p.id==='dongshan-school'){dx=-12;dy=-12;anchor='end';}
      if(p.id==='chunzailou-garden'){dx=-12;dy=23;anchor='end';}
      if(isPeak){dx=10;dy=-13;}
      out+='<g class="audit-control-point"><title>'+escape(p.label)+' · WGS84 '+coords(p)+'</title>'+(isPeak?'<path d="M '+x+' '+(y-7)+' l 7 12 h -14 z"/>':'<circle cx="'+x+'" cy="'+y+'" r="5"/>')+'<text x="'+(x+dx)+'" y="'+(y+dy)+'" text-anchor="'+anchor+'">'+escape(label)+'</text></g>';
    }
    const bar=source?1000:250,bw=bar*scale;
    out+='<g class="audit-scale"><path d="M 30 '+(height-24)+' v -6 m 0 3 h '+bw+' m 0 -3 v 6"/><text x="30" y="'+(height-35)+'">'+fmt(bar)+(source?' m':' 模型米')+'</text></g>';
    out+='<g class="audit-north"><path d="M '+(width-26)+' 60 V 27 l -4 8 m 4 -8 l 4 8"/><text x="'+(width-26)+'" y="19" text-anchor="middle">北 N</text></g>';
    return out+'</svg>';
  }
  function renderPlots() {
    document.getElementById('auditSourcePlot').innerHTML=svg('source');
    document.getElementById('auditDesignPlot').innerHTML=svg('design');
  }
  function render() {
    document.getElementById('auditSummary').textContent=data.summary;
    document.getElementById('auditDistances').innerHTML=data.pairs.map(p=>'<tr><th scope="row">'+escape(p.label)+'</th><td>'+fmt(p.sourceMetres)+' m</td><td>'+fmt(p.designMetres)+'</td><td>'+Math.round(p.designToSourceRatio*100)+'%</td><td>'+(p.bearingDifferenceDegrees>0?'+':'')+p.bearingDifferenceDegrees.toFixed(1)+'°</td></tr>').join('');
    document.getElementById('auditCoordinates').innerHTML=data.anchors.map(p=>'<tr><th scope="row">'+escape(p.label)+'</th><td class="audit-coordinate">'+coords(p)+'</td><td>'+escape(p.role)+'<br>'+link(p.osmUrl,p.sourceId)+'</td></tr>').join('');
    document.getElementById('auditOmissions').innerHTML=data.priorityOmissions.map((p,i)=>'<li><span class="audit-item-number">'+(i+1)+'</span><div><strong>'+escape(p.label)+'</strong><span class="audit-place-status">'+status(p)+'</span><p>'+escape(p.detail)+'</p><small>WGS84 '+coords(p)+' · '+link(p.osmUrl,p.coordinateMethod)+(p.referenceUrl?' · '+link(p.referenceUrl,'交叉资料'):'')+'</small></div></li>').join('');
    const others=data.omittedPlaces.filter(p=>!p.priority);
    document.getElementById('auditOtherCount').textContent='其他 '+others.length+' 个命名场所 / 聚落';
    document.getElementById('auditOtherPlaces').innerHTML=others.map(p=>'<li><strong>'+escape(p.label)+'</strong><span>'+status(p)+'</span><small>'+link(p.osmUrl,p.sourceId)+' · WGS84 '+coords(p)+'</small></li>').join('');
    document.getElementById('auditUnlocated').innerHTML=data.unlocatedPlaces.map(p=>link(p.referenceUrls[0],p.label)).join('、');
    document.getElementById('auditOutside').innerHTML=data.outsideFramePlaces.map(p=>link(p.osmUrl,p.label)+'：'+escape(p.status)).join('；');
    document.getElementById('auditMethod').textContent=data.methods.distance+' '+data.methods.bearing+' '+data.methods.precision;
    document.getElementById('auditInventoryMethod').textContent=data.methods.inventory;
    renderPlots();
  }
  function open() { if(!dialog.open) dialog.showModal(); }
  document.getElementById('geographicToggle').addEventListener('click',open);
  document.getElementById('closeGeographicAudit').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  // Stop map shortcuts and camera controls while reviewing the modal.
  dialog.addEventListener('keydown',e=>{if(e.code!=='Escape')e.stopPropagation();});
  document.getElementById('auditShowOmitted').addEventListener('change',e=>{showOmitted=e.target.checked;renderPlots();});
  window.DSGeographicAudit={data,open,close:()=>dialog.close()};
  render();
})();
