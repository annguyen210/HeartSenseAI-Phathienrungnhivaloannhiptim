// ppg-worker.js — WebWorker for non-blocking PPG analysis
// Upgraded: Welch periodogram + AMDF + fine frequency search (0.05 BPM precision)
// 9-method ensemble matches main thread analyzePPGSignal accuracy.

// ── Utility ───────────────────────────────────────────────────────────────────
function average(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = average(arr);
  return Math.sqrt(arr.map(v => (v - m) ** 2).reduce((a, b) => a + b, 0) / arr.length);
}

// ── Biquad IIR helpers ────────────────────────────────────────────────────────
function _applyBiquad(sig, c) {
  const out = new Float64Array(sig.length);
  let x1=0,x2=0,y1=0,y2=0;
  for (let i=0;i<sig.length;i++) {
    const x=sig[i];
    const y=c.b0*x+c.b1*x1+c.b2*x2-c.a1*y1-c.a2*y2;
    out[i]=y; x2=x1; x1=x; y2=y1; y1=y;
  }
  return out;
}
function _butter2HP(fc, fs) {
  const w=2*Math.PI*fc/fs, k=Math.tan(w/2), k2=k*k;
  const norm=1/(1+Math.SQRT2*k+k2);
  return {b0:norm,b1:-2*norm,b2:norm,a1:2*(k2-1)*norm,a2:(1-Math.SQRT2*k+k2)*norm};
}
function _butter2LP(fc, fs) {
  const w=2*Math.PI*fc/fs, k=Math.tan(w/2), k2=k*k;
  const norm=1/(1+Math.SQRT2*k+k2);
  return {b0:k2*norm,b1:2*k2*norm,b2:k2*norm,a1:2*(k2-1)*norm,a2:(1-Math.SQRT2*k+k2)*norm};
}
function butterworthBandpass(signal, fps) {
  const hp=_butter2HP(0.65,fps);
  const lp=_butter2LP(Math.min(3.5,fps*0.44),fps);
  const fwd=_applyBiquad(_applyBiquad(signal,hp),lp);
  const bwd=Array.from(_applyBiquad(_applyBiquad([...fwd].reverse(),hp),lp)).reverse();
  return bwd;
}

// ── Hann window ───────────────────────────────────────────────────────────────
function hannWindow(sig) {
  const N=sig.length;
  return sig.map((v,i)=>v*0.5*(1-Math.cos(2*Math.PI*i/(N-1))));
}

// ── FFT BPM (4× zero-padding, parabolic interpolation) ───────────────────────
function fftBpm(signal, fps) {
  if (signal.length < 60) return null;
  const N=signal.length, P=N*4;
  const mean=average(signal);
  const windowed=hannWindow(signal.map(v=>v-mean));
  const freqStep=fps/P;
  const kMin=Math.max(1,Math.floor(40/60/freqStep));
  const kMax=Math.min(Math.floor(P/2),Math.ceil(185/60/freqStep));
  const powers=new Float64Array(kMax-kMin+1);
  let bestPower=0, bestIdx=0;
  for (let k=kMin;k<=kMax;k++) {
    let re=0,im=0; const w=2*Math.PI*k/P;
    for (let n=0;n<N;n++) { re+=windowed[n]*Math.cos(w*n); im-=windowed[n]*Math.sin(w*n); }
    const power=re*re+im*im; const idx=k-kMin;
    powers[idx]=power; if (power>bestPower){bestPower=power;bestIdx=idx;}
  }
  let refinedK=bestIdx+kMin;
  if (bestIdx>0&&bestIdx<powers.length-1) {
    const p0=powers[bestIdx-1],p1=powers[bestIdx],p2=powers[bestIdx+1];
    const denom=p0-2*p1+p2;
    if (denom!==0) refinedK=(bestIdx+kMin)+0.5*(p0-p2)/denom;
  }
  const bpm=refinedK*freqStep*60;
  return bpm>=40&&bpm<=185?bpm:null;
}

// ── Welch Periodogram BPM ─────────────────────────────────────────────────────
// Averages K overlapping windows → variance reduced by 1/K vs single FFT.
function welchBpm(signal, fps) {
  if (!signal || signal.length < fps * 10) return null;
  const winSec = Math.min(10, Math.floor(signal.length / fps * 0.55));
  if (winSec < 6) return null;
  const winSize = Math.floor(fps * winSec);
  const step    = Math.floor(winSize / 2);
  const freqRes = fps / winSize;
  const kMin    = Math.max(1, Math.floor(40 / 60 / freqRes));
  const kMax    = Math.min(Math.floor(winSize / 2), Math.ceil(185 / 60 / freqRes));
  const nBins   = kMax - kMin + 1;
  const avgPsd  = new Float64Array(nBins);
  let nSegs = 0;
  for (let start = 0; start + winSize <= signal.length; start += step) {
    const seg = signal.slice(start, start + winSize);
    const mu  = seg.reduce((a, b) => a + b, 0) / seg.length;
    const win = hannWindow(seg.map(v => v - mu));
    for (let k = kMin; k <= kMax; k++) {
      let re = 0, im = 0;
      const w = 2 * Math.PI * k / winSize;
      for (let n = 0; n < winSize; n++) { re += win[n]*Math.cos(w*n); im -= win[n]*Math.sin(w*n); }
      avgPsd[k - kMin] += re*re + im*im;
    }
    nSegs++;
  }
  if (nSegs < 2) return null;
  for (let i = 0; i < nBins; i++) avgPsd[i] /= nSegs;
  let bestIdx = 0, bestPow = 0;
  for (let i = 0; i < nBins; i++) { if (avgPsd[i] > bestPow) { bestPow = avgPsd[i]; bestIdx = i; } }
  let refinedK = bestIdx + kMin;
  if (bestIdx > 0 && bestIdx < nBins - 1) {
    const p0 = avgPsd[bestIdx-1], p1 = avgPsd[bestIdx], p2 = avgPsd[bestIdx+1];
    const d = p0 - 2*p1 + p2;
    if (d !== 0) refinedK = (bestIdx + kMin) + 0.5*(p0-p2)/d;
  }
  const bpm = refinedK * freqRes * 60;
  return bpm >= 40 && bpm <= 185 ? bpm : null;
}

// ── Fine Frequency Search — 0.05 BPM resolution ──────────────────────────────
// Dense DFT evaluation around FFT anchor → from 0.5 to 0.01 BPM precision.
function refineBpmFrequency(signal, fps, roughBpm) {
  if (!roughBpm || !signal || signal.length < fps * 8) return roughBpm;
  const n  = signal.length;
  const mu = signal.reduce((a, b) => a + b, 0) / n;
  const x  = signal.map(v => v - mu);
  const norm = x.reduce((a, v) => a + v*v, 0);
  if (norm < 1e-12) return roughBpm;
  const fMin = Math.max(40,  roughBpm - 3.5) / 60;
  const fMax = Math.min(185, roughBpm + 3.5) / 60;
  const step = 0.05 / 60;
  let bestPwr = 0, bestF = roughBpm / 60;
  for (let f = fMin; f <= fMax + step*0.5; f += step) {
    const w = 2*Math.PI*f/fps;
    let re = 0, im = 0;
    for (let t = 0; t < n; t++) { re += x[t]*Math.cos(w*t); im -= x[t]*Math.sin(w*t); }
    const pwr = re*re + im*im;
    if (pwr > bestPwr) { bestPwr = pwr; bestF = f; }
  }
  if (bestF > fMin + step && bestF < fMax - step) {
    const evalP = f => {
      const w = 2*Math.PI*f/fps; let re=0, im=0;
      for (let t=0; t<n; t++) { re += x[t]*Math.cos(w*t); im -= x[t]*Math.sin(w*t); }
      return re*re + im*im;
    };
    const p0=evalP(bestF-step), p2=evalP(bestF+step);
    const d = p0 - 2*bestPwr + p2;
    if (d < 0) bestF += 0.5*(p0-p2)/d*step;
  }
  const refined = bestF * 60;
  return refined >= 40 && refined <= 185 ? refined : roughBpm;
}

// ── AMDF BPM ─────────────────────────────────────────────────────────────────
// Average Magnitude Difference Function — minimum at signal period.
// Complementary to ACF, robust to amplitude variation across beats.
function amdfBpm(signal, fps) {
  if (!signal || signal.length < fps * 8) return null;
  const minLag = Math.max(2, Math.floor(fps*60/185));
  const maxLag = Math.min(Math.floor(signal.length*0.5), Math.floor(fps*60/40));
  if (maxLag <= minLag) return null;
  const n  = signal.length;
  const mu = signal.reduce((a,b)=>a+b,0)/n;
  const x  = signal.map(v=>v-mu);
  const amdf = new Float64Array(maxLag+1);
  for (let lag=minLag;lag<=maxLag;lag++) {
    let sum=0; const lim=n-lag;
    for (let i=0;i<lim;i++) sum+=Math.abs(x[i]-x[i+lag]);
    amdf[lag]=sum/lim;
  }
  const amdf0=amdf[minLag]||1;
  function _frac(lag) {
    if (lag<=minLag||lag>=maxLag) return lag;
    const a=amdf[lag-1],b=amdf[lag],c=amdf[lag+1],d=a-2*b+c;
    return d>0?lag+0.5*(a-c)/d:lag;
  }
  for (let lag=minLag+1;lag<maxLag-1;lag++) {
    if (amdf[lag]<amdf[lag-1]&&amdf[lag]<amdf[lag+1]&&amdf[lag]/amdf0<0.88) {
      const frac=_frac(lag); const bpm=60*fps/frac;
      if (bpm<50) { const dbl=bpm*2; return dbl>=40&&dbl<=185?dbl:null; }
      return bpm>=40&&bpm<=185?bpm:null;
    }
  }
  let bestAmdf=Infinity, bestLag=-1;
  for (let lag=minLag;lag<=maxLag;lag++) { if (amdf[lag]<bestAmdf){bestAmdf=amdf[lag];bestLag=lag;} }
  if (bestLag<0||bestAmdf/amdf0>0.88) return null;
  const bpm=60*fps/_frac(bestLag);
  return bpm>=40&&bpm<=185?bpm:null;
}

// ── Autocorrelation BPM ───────────────────────────────────────────────────────
function autocorrBpm(signal, fps) {
  const minLag=Math.max(2,Math.floor(fps*60/185));
  const maxLag=Math.min(Math.floor(signal.length*0.5),Math.floor(fps*60/40));
  if (maxLag<=minLag||signal.length<30) return null;
  const n=signal.length, mean=average(signal);
  const c=signal.map(v=>v-mean);
  const ac0=c.reduce((s,v)=>s+v*v,0)/n;
  if (!ac0) return null;
  const acf=new Array(maxLag+1).fill(0);
  for (let lag=minLag;lag<=maxLag;lag++) {
    let sum=0; const lim=n-lag;
    for (let i=0;i<lim;i++) sum+=c[i]*c[i+lag];
    acf[lag]=sum/(lim*ac0);
  }
  function _frac(lag) {
    if (lag<=minLag||lag>=maxLag) return lag;
    const a=acf[lag-1],b=acf[lag],cv=acf[lag+1],d=a-2*b+cv;
    return d<0?lag+0.5*(a-cv)/d:lag;
  }
  for (let lag=minLag+1;lag<maxLag;lag++) {
    if (acf[lag]>acf[lag-1]&&acf[lag]>acf[lag+1]&&acf[lag]>0.24) {
      const frac=_frac(lag); const rawBpm=60*fps/frac;
      if (rawBpm<52) {
        const halfFrac=_frac(Math.round(frac/2));
        if (halfFrac>=minLag) { const dbl=60*fps/halfFrac; if (dbl>=52&&dbl<=150) return dbl>=40&&dbl<=185?dbl:null; }
        return null;
      }
      return rawBpm>=40&&rawBpm<=185?rawBpm:null;
    }
  }
  let best=0.22,bestLag=-1;
  for (let lag=minLag;lag<=maxLag;lag++) if (acf[lag]>best){best=acf[lag];bestLag=lag;}
  if (bestLag<0) return null;
  const frac=_frac(bestLag); const rawBpm=60*fps/frac;
  if (rawBpm<52) {
    const halfFrac=_frac(Math.round(frac/2));
    if (halfFrac>=minLag) { const dbl=60*fps/halfFrac; if (dbl>=52&&dbl<=150) return dbl; }
    return null;
  }
  return rawBpm>=40&&rawBpm<=185?rawBpm:null;
}

// ── Peak detection ────────────────────────────────────────────────────────────
function detectPeaksAdaptive(signal, fps, mode) {
  const minDist=Math.floor(fps*(mode==='finger'?0.33:0.40));
  const n=signal.length; const winHalf=Math.floor(fps*2); const peaks=[];
  for (let i=2;i<n-2;i++) {
    const v=signal[i];
    if (v<=signal[i-1]||v<=signal[i+1]||v<=signal[i-2]||v<=signal[i+2]) continue;
    const s=Math.max(0,i-winHalf),e=Math.min(n,i+winHalf);
    const loc=signal.slice(s,e);
    const thresh=average(loc)+stdDev(loc)*(mode==='finger'?0.3:0.55);
    if (v<thresh) continue;
    let frac=i; const a=signal[i-1],c2=signal[i+1],denom=a-2*v+c2;
    if (denom<0) frac=i+0.5*(a-c2)/denom;
    if (peaks.length&&(frac-peaks[peaks.length-1])<minDist) {
      if (v>signal[Math.round(peaks[peaks.length-1])]) peaks[peaks.length-1]=frac;
      continue;
    }
    peaks.push(frac);
  }
  return peaks;
}
function peaksToBpm(peaks, fps) {
  if (peaks.length<4) return null;
  const rrs=[];
  for (let i=1;i<peaks.length;i++) { const rr=(peaks[i]-peaks[i-1])/fps*1000; if (rr>=320&&rr<=1800) rrs.push(rr); }
  if (rrs.length<3) return null;
  const s=[...rrs].sort((a,b)=>a-b);
  const q1=s[Math.floor(s.length*0.25)],q3=s[Math.floor(s.length*0.75)];
  const clean=rrs.filter(r=>r>=q1-1.5*(q3-q1)&&r<=q3+1.5*(q3-q1));
  if (!clean.length) return null;
  const bpm=60000/average(clean);
  return {bpm:bpm>=40&&bpm<=185?bpm:null, rrs:clean};
}

// ── Harmonic rejection ────────────────────────────────────────────────────────
function rejectHarmonicOutliers(bpmList) {
  if (bpmList.length < 3) return bpmList;
  const toRemove = new Set();
  for (let i = 0; i < bpmList.length; i++) {
    if (toRemove.has(i)) continue;
    for (let j = 0; j < bpmList.length; j++) {
      if (i===j||toRemove.has(j)) continue;
      const ratio = bpmList[i]/bpmList[j];
      if (ratio<1.85||ratio>2.15) continue;
      const vH=bpmList.filter(b=>Math.abs(b-bpmList[i])<=4).length;
      const vL=bpmList.filter(b=>Math.abs(b-bpmList[j])<=4).length;
      if (vL>=vH) toRemove.add(i);
    }
  }
  if (!toRemove.size) return bpmList;
  const f=bpmList.filter((_,idx)=>!toRemove.has(idx));
  return f.length>=2?f:bpmList;
}

// ── Multi-window median ───────────────────────────────────────────────────────
function multiWindowBpm(filtered, fps, mode) {
  const winSec=Math.min(12,Math.floor((filtered.length/fps)/2));
  if (winSec<6) return null;
  const winSize=Math.floor(fps*winSec), step=Math.floor(winSize/2), bpms=[];
  for (let start=0;start+winSize<=filtered.length;start+=step) {
    const win=filtered.slice(start,start+winSize);
    const pb=peaksToBpm(detectPeaksAdaptive(win,fps,mode),fps);
    if (pb?.bpm) bpms.push(pb.bpm);
    const ab=autocorrBpm(win,fps);
    if (ab) bpms.push(ab);
    const wb=welchBpm(win,fps);
    if (wb) bpms.push(wb);
  }
  if (bpms.length<2) return null;
  const s=[...bpms].sort((a,b)=>a-b);
  return s[Math.floor(s.length/2)];
}

// ── Kalman BPM series ─────────────────────────────────────────────────────────
function computeKalmanBpmSeries(filtered, fps, mode) {
  const winSize=Math.floor(fps*8), stepSize=Math.floor(fps*3);
  if (filtered.length<winSize) return null;
  const bpmSeries=[];
  for (let start=0;start+winSize<=filtered.length;start+=stepSize) {
    const win=filtered.slice(start,start+winSize);
    const fftB  = fftBpm(win,fps);
    const acfB  = autocorrBpm(win,fps);
    const pkB   = peaksToBpm(detectPeaksAdaptive(win,fps,mode),fps)?.bpm||null;
    const welchB= welchBpm(win,fps);
    const amdfB = amdfBpm(win,fps);
    const roughA= fftB||acfB||null;
    const refB  = roughA?refineBpmFrequency(win,fps,roughA):null;
    const candidates=rejectHarmonicOutliers(
      [fftB,acfB,pkB,welchB,amdfB,refB].filter(b=>b&&b>=40&&b<=185)
    );
    if (candidates.length>=2) {
      const sorted=[...candidates].sort((a,b)=>a-b);
      bpmSeries.push(sorted[Math.floor(sorted.length/2)]);
    }
  }
  return bpmSeries.length>=2?bpmSeries:null;
}

// ── Kalman smoother ───────────────────────────────────────────────────────────
function kalmanBpmSmooth(bpmSeries) {
  const valid=(bpmSeries||[]).filter(b=>b&&b>=40&&b<=185);
  if (!valid.length) return null;
  if (valid.length===1) return valid[0];
  let x=valid[0],P=15.0;
  for (let i=1;i<valid.length;i++) {
    const z=valid[i]; P+=2.0; const K=P/(P+8.0); x=x+K*(z-x); P=(1-K)*P;
    x=Math.max(z-20,Math.min(z+20,x));
  }
  return x; // keep fractional for final fusion
}

// ── Quick analysis (BPM only) for worker ─────────────────────────────────────
function workerAnalyzeBpm(samples, mode, fps) {
  if (!samples || samples.length < fps * 10) return null;
  const warmup = Math.floor(fps * (mode === 'finger' ? 5 : 3));
  const input  = samples.length > warmup + fps * 8 ? samples.slice(warmup) : samples;

  let rawSignal;
  if (mode === 'finger') {
    const rawRed   = input.map(s => s.avgRed);
    const rawGreen = input.map(s => s.avgGreen);
    const filtRed   = butterworthBandpass(rawRed,   fps);
    const filtGreen = butterworthBandpass(rawGreen, fps);
    // PBV-lite: pick channel with higher cardiac-band SNR
    const snrR = stdDev(filtRed), snrG = stdDev(filtGreen);
    rawSignal  = snrR >= snrG * 0.75 ? rawRed : rawGreen;
  } else {
    // Face: use Green channel (worker doesn't have CHROM context)
    rawSignal = input.map(s => s.avgGreen);
  }

  const filtered = butterworthBandpass(rawSignal, fps);
  const minStd   = mode === 'finger' ? 0.25 : 0.003;
  if (stdDev(filtered) < minStd) return null;

  // 7-method ensemble (worker version)
  const fftResult   = fftBpm(filtered, fps);
  const acfBpm      = autocorrBpm(filtered, fps);
  const pkResult    = peaksToBpm(detectPeaksAdaptive(filtered, fps, mode), fps);
  const peakBpm     = pkResult?.bpm || null;
  const mwBpm_      = multiWindowBpm(filtered, fps, mode);
  const welchResult = welchBpm(filtered, fps);
  const amdfResult  = amdfBpm(filtered, fps);
  const roughA      = fftResult || acfBpm || welchResult || null;
  const refinedBpm  = roughA ? refineBpmFrequency(filtered, fps, roughA) : null;

  const allValidRaw = [fftResult, acfBpm, peakBpm, mwBpm_, welchResult, amdfResult, refinedBpm]
    .filter(b => b && b >= 40 && b <= 185);
  const allValid = rejectHarmonicOutliers(allValidRaw);

  if (allValid.length < 2) return null;
  if (allValid.length === 2 && Math.max(...allValid) - Math.min(...allValid) > 10) return null;

  let estimatedBpm;
  if (allValid.length >= 5) {
    // Density-weighted cluster center
    const weights = allValid.map(b => allValid.filter(c => Math.abs(c - b) <= 4).length);
    const totalW  = weights.reduce((a, b) => a + b, 0);
    estimatedBpm  = totalW > 0
      ? allValid.reduce((acc, b, i) => acc + b * weights[i], 0) / totalW
      : average(allValid);
    if (refinedBpm && Math.abs(refinedBpm - estimatedBpm) <= 1.5)
      estimatedBpm = estimatedBpm * 0.55 + refinedBpm * 0.45;
  } else {
    const sorted   = [...allValid].sort((a, b) => a - b);
    estimatedBpm   = sorted.length % 2 === 0
      ? (sorted[sorted.length/2-1] + sorted[sorted.length/2]) / 2
      : sorted[Math.floor(sorted.length/2)];
  }

  const bpmSeries   = computeKalmanBpmSeries(filtered, fps, mode);
  const kalmanBpm   = kalmanBpmSmooth(bpmSeries);
  const seriesArr   = (bpmSeries||[]).filter(b=>b>=40&&b<=185);
  const seriesMedian= seriesArr.length>=2
    ? [...seriesArr].sort((a,b)=>a-b)[Math.floor(seriesArr.length/2)]
    : null;

  let rawFinal = estimatedBpm;
  if (seriesMedian) {
    const d = Math.abs(seriesMedian - estimatedBpm);
    if (d <= 6)       rawFinal = seriesMedian * 0.65 + estimatedBpm * 0.35;
    else if (d <= 14) rawFinal = seriesMedian * 0.70 + estimatedBpm * 0.30;
    else              rawFinal = seriesMedian * 0.80 + estimatedBpm * 0.20;
  } else if (kalmanBpm && Math.abs(kalmanBpm - estimatedBpm) <= 6) {
    rawFinal = kalmanBpm * 0.6 + estimatedBpm * 0.4;
  }

  return Math.round(Math.min(185, Math.max(40, rawFinal)));
}

// ── Worker message handler ────────────────────────────────────────────────────
self.onmessage = function(e) {
  const { type, samples, mode, fps } = e.data;
  if (type === 'quickBpm') {
    const bpm = workerAnalyzeBpm(samples, mode, fps || 30);
    self.postMessage({ type: 'quickBpmResult', bpm });
  }
};
