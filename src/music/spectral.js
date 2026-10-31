// Independent FFT/chroma implementation. Profile correlation follows the
// Krumhansl-Schmuckler method; profile values are published research data.
// Background worker only: no spectral computation on the playback event loop.
export const SPECTRAL_RATE=11025, FRAME_SIZE=8192, MAX_FRAMES=96;
export const KEY_CONFIDENCE=0.45;
const clamp=x=>Math.max(0,Math.min(1,x));
const profiles={major:[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],
  minor:[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17]};
const names=['Do','Do♯','Re','Mi♭','Mi','Fa','Fa♯','Sol','La♭','La','Si♭','Si'];

export function estimateKey(chroma,frames=4) {
  const unknown={key:null,tonalConfidence:0};
  if(frames<4||chroma.length!==12||chroma.some(v=>!Number.isFinite(v)||v<0))return unknown;
  const total=chroma.reduce((a,b)=>a+b,0),max=Math.max(...chroma);
  if(!total||max/total>0.7||chroma.filter(v=>v>max*0.12).length<3)return unknown;
  const mean=total/12,centered=chroma.map(v=>v-mean),norm=Math.hypot(...centered);
  if(norm<total*0.03)return unknown;
  const scores=[];
  for(const [mode,profile] of Object.entries(profiles)){
    const average=profile.reduce((a,b)=>a+b)/12,p=profile.map(v=>v-average),denom=norm*Math.hypot(...p);
    for(let tonic=0;tonic<12;tonic++)scores.push({tonic,mode,score:centered.reduce((sum,v,i)=>sum+v*p[(i-tonic+12)%12],0)/denom});
  }
  scores.sort((a,b)=>b.score-a.score);
  const best=scores[0],margin=best.score-scores[1].score;
  const confidence=clamp((best.score-0.45)/0.45)*clamp(margin/0.12);
  const tonalConfidence=Math.round(confidence*100)/100;
  if(confidence<KEY_CONFIDENCE)return {...unknown,tonalConfidence};
  return {key:{tonic:best.tonic,mode:best.mode,label:names[best.tonic]+(best.mode==='major'?' mayor':' menor'),confidence:tonalConfidence},tonalConfidence};
}

function spectrum(frame) {
  const n=FRAME_SIZE,re=new Float64Array(n),im=new Float64Array(n);
  let mean=0;for(const v of frame)mean+=v;mean/=n;
  for(let i=0;i<n;i++)re[i]=(frame[i]-mean)*(0.5-0.5*Math.cos(2*Math.PI*i/(n-1)));
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
    if(i<j){const tmp=re[i];re[i]=re[j];re[j]=tmp;}
  }
  for(let size=2;size<=n;size*=2){
    const angle=-2*Math.PI/size,wr=Math.cos(angle),wi=Math.sin(angle);
    for(let base=0;base<n;base+=size){
      let r=1,i=0;
      for(let j=0;j<size/2;j++){
        const a=base+j,b=a+size/2,tr=r*re[b]-i*im[b],ti=r*im[b]+i*re[b];
        re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;
        const next=r*wr-i*wi;i=r*wi+i*wr;r=next;
      }
    }
  }
  const power=new Float64Array(n/2);
  for(let i=1;i<power.length;i++)power[i]=re[i]*re[i]+im[i]*im[i];
  return power;
}

export function describeSpectrum(frames,energy) {
  const chroma=Array(12).fill(0);let used=0,brightness=0;
  for(const frame of frames.slice(0,MAX_FRAMES)){
    if(frame.length!==FRAME_SIZE)continue;
    const power=spectrum(frame),max=power.reduce((a,b)=>Math.max(a,b),0);
    if(max<1e-5)continue;
    const local=Array(12).fill(0);let total=0,high=0;
    for(let bin=1;bin<power.length-1;bin++){
      const frequency=bin*SPECTRAL_RATE/FRAME_SIZE,value=power[bin];
      total+=value;if(frequency>=1500)high+=value;
      if(frequency<65||frequency>3500||value<max*0.0025||value<=power[bin-1]||value<power[bin+1])continue;
      // Parabolic log-magnitude interpolation reduces low-frequency bin errors.
      const left=Math.log(power[bin-1]+1e-20),middle=Math.log(value+1e-20),right=Math.log(power[bin+1]+1e-20);
      const offset=Math.max(-0.5,Math.min(0.5,0.5*(left-right)/(left-2*middle+right || 1)));
      const midi=69+12*Math.log2((bin+offset)*SPECTRAL_RATE/FRAME_SIZE/440),note=Math.round(midi),error=Math.abs(midi-note);
      if(error>0.45)continue;
      local[((note%12)+12)%12]+=Math.pow(value/max,0.4)*Math.cos(error*Math.PI)**2;
    }
    const norm=local.reduce((a,b)=>a+b,0);
    if(norm>0){for(let i=0;i<12;i++)chroma[i]+=local[i]/norm;used++;}
    if(total>0)brightness+=high/total;
  }
  const active=energy.filter(v=>Number.isFinite(v)&&v>0.00015).sort((a,b)=>a-b);
  let intensity=null;
  if(active.length>=86){
    let positive=0,sum=0;for(let i=0;i<energy.length;i++){sum+=energy[i];if(i)positive+=Math.max(0,energy[i]-energy[i-1]);}
    const density=clamp(positive/Math.max(sum,1e-10)*8),compression=clamp(active[Math.floor(active.length*0.5)]/active[Math.floor(active.length*0.95)]);
    intensity=Math.round(clamp(0.45*clamp(Math.sqrt(brightness/Math.max(1,frames.length))*1.5)+0.35*density+0.2*compression)*100)/100;
  }
  return {...estimateKey(chroma,used),energy:intensity,spectralFrames:frames.length};
}

export function harmonicRelation(a,b) {
  const valid=key=>key&&Number.isInteger(key.tonic)&&key.tonic>=0&&key.tonic<12&&['major','minor'].includes(key.mode)&&key.confidence>=KEY_CONFIDENCE;
  if(!valid(a)||!valid(b))return {kind:'unknown',cost:0.05};
  if(a.tonic===b.tonic&&a.mode===b.mode)return {kind:'same',cost:0};
  const majorA=(a.tonic+(a.mode==='minor'?3:0))%12,majorB=(b.tonic+(b.mode==='minor'?3:0))%12;
  if(majorA===majorB)return {kind:'relative',cost:0.01};
  const distance=(majorA-majorB+12)%12;
  if(a.mode===b.mode&&[5,7].includes(distance))return {kind:'neighbor',cost:0.025};
  return {kind:'distant',cost:0.12};
}
export function energyDifference(a,b) {
  return Number.isFinite(a)&&Number.isFinite(b)&&a>=0&&a<=1&&b>=0&&b<=1?Math.abs(a-b):null;
}
export function analysisDescription(analysis) {
  if(!analysis)return 'Preparando análisis…';
  return [analysis.bpm&&analysis.confidence>=0.3?Math.round(analysis.bpm)+' BPM':'Ritmo poco claro',
    analysis.key?.label?analysis.key.label+' (estimada)':'Tonalidad incierta',
    Number.isFinite(analysis.energy)?'Energía '+Math.round(analysis.energy*100)+'/100':null].filter(Boolean).join(' · ');
}
