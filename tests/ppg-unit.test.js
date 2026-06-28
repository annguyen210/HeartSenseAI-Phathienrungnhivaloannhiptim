/**
 * HeartSense PPG/HRV Unit Tests
 * Run: node tests/ppg-unit.test.js
 * No external dependencies required.
 */

let passed = 0, failed = 0;

function assert(condition, name) {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else           { console.error(`  ❌ FAIL: ${name}`); failed++; }
}
function assertClose(a, b, tol, name) {
  assert(Math.abs(a - b) <= tol, `${name} (got ${a}, expected ~${b} ±${tol})`);
}

// ─── Inline pure helpers (no DOM/state dependencies) ─────────────────────────
function average(arr) { return arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0; }
function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = average(arr);
  return Math.sqrt(arr.map(v=>(v-m)**2).reduce((a,b)=>a+b,0)/arr.length);
}

// ── Wiesel IRR ────────────────────────────────────────────────────────────────
function wieselIrr(rrs) {
  if (rrs.length < 4) return 0;
  const meanRR = average(rrs);
  if (meanRR < 1) return 0;
  let sum = 0;
  for (let i = 1; i < rrs.length; i++) sum += Math.abs(rrs[i] - rrs[i-1]);
  return Math.round(sum / (rrs.length - 1) / meanRR * 1000) / 1000;
}

// ── Wald-Wolfowitz Z ──────────────────────────────────────────────────────────
function waldWolkowitzZ(rrs) {
  const n = rrs.length;
  if (n < 10) return null;
  const sorted = [...rrs].sort((a,b)=>a-b);
  const med = sorted[Math.floor(n/2)];
  let n1=0, n2=0, R=1;
  let prevAbove = rrs[0] >= med;
  for (let i=0;i<n;i++) { if(rrs[i]>=med) n1++; else n2++; }
  for (let i=1;i<n;i++) { const a=rrs[i]>=med; if(a!==prevAbove){R++;prevAbove=a;} }
  if(n1===0||n2===0) return null;
  const N=n1+n2, muR=(2*n1*n2)/N+1;
  const varR=(2*n1*n2*(2*n1*n2-N))/(N*N*(N-1));
  return varR>0 ? Math.round((R-muR)/Math.sqrt(varR)*1000)/1000 : null;
}

// ── naturalCubicSpline (simplified test version) ─────────────────────────────
function naturalCubicSpline(xs, ys, xQuery) {
  const n = xs.length;
  if (n < 2) return xQuery.map(()=>ys[0]||0);
  if (n === 2) return xQuery.map(x=>{
    const t=(xs[1]-xs[0])>0?(x-xs[0])/(xs[1]-xs[0]):0;
    return ys[0]+Math.max(0,Math.min(1,t))*(ys[1]-ys[0]);
  });
  const h=new Float64Array(n-1);
  for(let i=0;i<n-1;i++) h[i]=xs[i+1]-xs[i];
  const alpha=new Float64Array(n);
  for(let i=1;i<n-1;i++) if(h[i]>0&&h[i-1]>0) alpha[i]=3/h[i]*(ys[i+1]-ys[i])-3/h[i-1]*(ys[i]-ys[i-1]);
  const l=new Float64Array(n).fill(1), mu=new Float64Array(n), z=new Float64Array(n);
  for(let i=1;i<n-1;i++){l[i]=2*(xs[i+1]-xs[i-1])-h[i-1]*mu[i-1];if(l[i]===0)continue;mu[i]=h[i]/l[i];z[i]=(alpha[i]-h[i-1]*z[i-1])/l[i];}
  const c=new Float64Array(n),b=new Float64Array(n-1),d=new Float64Array(n-1);
  for(let j=n-2;j>=0;j--){c[j]=z[j]-mu[j]*c[j+1];if(h[j]===0)continue;b[j]=(ys[j+1]-ys[j])/h[j]-h[j]*(c[j+1]+2*c[j])/3;d[j]=(c[j+1]-c[j])/(3*h[j]);}
  return xQuery.map(x=>{
    if(x<=xs[0])return ys[0]; if(x>=xs[n-1])return ys[n-1];
    let lo=0,hi=n-2;while(lo<hi){const mid=(lo+hi+1)>>1;if(xs[mid]<=x)lo=mid;else hi=mid-1;}
    const dx=x-xs[lo];return ys[lo]+b[lo]*dx+c[lo]*dx*dx+d[lo]*dx*dx*dx;
  });
}

// ─── TEST SUITES ──────────────────────────────────────────────────────────────

console.log("\n=== 1. Wiesel IRR ===");
{
  // Perfect sinus (all equal) → IRR = 0
  const sinusRR = Array(20).fill(800);
  assertClose(wieselIrr(sinusRR), 0, 0.001, "Perfect sinus → IRR = 0");

  // AFib-like (random variation ~15%)
  const afibRR = [820,680,910,720,860,690,940,710,880,730,850,670,920,700,860,740,800,650,950,720];
  const irr = wieselIrr(afibRR);
  assert(irr > 0.12, `AFib-like RRI → IRR > 0.12 (got ${irr})`);

  // Mild variation (sinus with RSA)
  const rsaRR = [780,800,820,810,790,780,800,820,810,790,780,800,820,810,790,780,800,820,810,790];
  const irrRsa = wieselIrr(rsaRR);
  assert(irrRsa < 0.07, `Sinus RSA → IRR < 0.07 (got ${irrRsa})`);

  // Edge: too short
  assert(wieselIrr([800,810,820]) === 0 || wieselIrr([800,810,820]) >= 0, "Short array doesn't crash");
}

console.log("\n=== 2. Wald-Wolfowitz Z-score ===");
{
  // Perfectly alternating (maximum runs) → very positive Z
  const altRR = Array.from({length:20},(_,i)=>i%2===0?800:850);
  const z1 = waldWolkowitzZ(altRR);
  assert(z1 !== null && z1 > 0, `Alternating → positive Z (got ${z1})`);

  // All same direction (too few runs) → negative Z
  const monoRR = [700,720,740,760,780,800,820,840,860,880,900,880,860,840,820,800,780,760,740,720];
  const z2 = waldWolkowitzZ(monoRR);
  assert(z2 !== null, "Monotone doesn't return null");

  // Too short → null
  assert(waldWolkowitzZ([800,810,820]) === null, "Short array → null");

  // All equal → null (n1 or n2 = 0)
  assert(waldWolkowitzZ(Array(15).fill(800)) === null, "All-equal → null (degenerate)");
}

console.log("\n=== 3. Natural Cubic Spline ===");
{
  // Interpolate known quadratic y = x²
  const xs = [0, 1, 2, 3, 4];
  const ys = xs.map(x => x * x);
  const xq = [0.5, 1.5, 2.5, 3.5];
  const result = naturalCubicSpline(xs, ys, xq);
  assertClose(result[0], 0.25, 0.1, "x=0.5 → y≈0.25");
  assertClose(result[1], 2.25, 0.1, "x=1.5 → y≈2.25");
  assertClose(result[2], 6.25, 0.1, "x=2.5 → y≈6.25");

  // Clamp at boundaries
  const r2 = naturalCubicSpline([0,1,2],[0,1,4],[-1, 3]);
  assert(r2[0] === 0, "Below lower bound → clamped to ys[0]");
  assert(r2[1] === 4, "Above upper bound → clamped to ys[last]");

  // 2-point (linear) fallback
  const r3 = naturalCubicSpline([0,10],[0,100],[5]);
  assertClose(r3[0], 50, 1, "2-point linear fallback: midpoint");
}

console.log("\n=== 4. average() and stdDev() ===");
{
  assertClose(average([1,2,3,4,5]), 3, 0.001, "average([1..5]) = 3");
  assert(average([]) === 0, "average([]) = 0");
  assertClose(stdDev([2,4,4,4,5,5,7,9]), 2, 0.001, "stdDev known dataset = 2");
  assert(stdDev([5]) === 0, "stdDev single element = 0");
}

console.log("\n=== 5. IRR/WW edge cases ===");
{
  // Very irregular (PVC-like: one very short followed by compensatory)
  const pvcRR = [800,800,800,450,1150,800,800,450,1150,800,800,800,800,800,800,800,800,800,800,800];
  const irrPvc = wieselIrr(pvcRR);
  // PVC with compensation: should be moderate IRR (not AFib level if regular base)
  assert(irrPvc < 0.20, `PVC pattern: IRR moderate (got ${irrPvc})`);

  // Gross noise (BPM < 40 equivalent) — should still not crash
  const noisy = Array.from({length:15},()=>Math.random()*2000+200);
  const irrN = wieselIrr(noisy);
  assert(typeof irrN === 'number' && !isNaN(irrN), "Noisy RRI doesn't crash wieselIrr");
  const zzN = waldWolkowitzZ(noisy);
  assert(zzN === null || typeof zzN === 'number', "Noisy RRI doesn't crash waldWolkowitzZ");
}

// ── rejectHarmonicOutliers ────────────────────────────────────────────────────
function rejectHarmonicOutliers(bpmList) {
  if (bpmList.length < 3) return bpmList;
  const toRemove = new Set();
  for (let i = 0; i < bpmList.length; i++) {
    if (toRemove.has(i)) continue;
    for (let j = 0; j < bpmList.length; j++) {
      if (i === j || toRemove.has(j)) continue;
      const ratio = bpmList[i] / bpmList[j];
      if (ratio < 1.85 || ratio > 2.15) continue;
      const votesHigh = bpmList.filter(b => Math.abs(b - bpmList[i]) <= 4).length;
      const votesLow  = bpmList.filter(b => Math.abs(b - bpmList[j]) <= 4).length;
      if (votesLow >= votesHigh) toRemove.add(i);
    }
  }
  if (!toRemove.size) return bpmList;
  const filtered = bpmList.filter((_, idx) => !toRemove.has(idx));
  return filtered.length >= 2 ? filtered : bpmList;
}

// ── crossChannelCoherence — Welch's method ───────────────────────────────────
function crossChannelCoherence(sig1, sig2, fps, freqHz) {
  const n = Math.min(sig1.length, sig2.length);
  if (n < 60 || !freqHz) return 0;
  const segLen = Math.max(16, Math.min(64, Math.floor(n / 4)));
  const overlap = Math.floor(segLen / 2);
  const step    = segLen - overlap;
  let sumPxy_re = 0, sumPxy_im = 0, sumPxx = 0, sumPyy = 0, nSeg = 0;
  for (let start = 0; start + segLen <= n; start += step) {
    const k = Math.round(freqHz * segLen / fps);
    if (k < 1 || k > segLen / 2) continue;
    const w = 2 * Math.PI * k / segLen;
    let re1 = 0, im1 = 0, re2 = 0, im2 = 0, m1 = 0, m2 = 0;
    for (let i = 0; i < segLen; i++) { m1 += sig1[start+i]; m2 += sig2[start+i]; }
    m1 /= segLen; m2 /= segLen;
    for (let i = 0; i < segLen; i++) {
      const v1 = sig1[start+i] - m1, v2 = sig2[start+i] - m2;
      re1 += v1*Math.cos(w*i); im1 -= v1*Math.sin(w*i);
      re2 += v2*Math.cos(w*i); im2 -= v2*Math.sin(w*i);
    }
    sumPxx += re1*re1+im1*im1; sumPyy += re2*re2+im2*im2;
    sumPxy_re += re1*re2+im1*im2; sumPxy_im += im1*re2-re1*im2;
    nSeg++;
  }
  if (nSeg < 3 || !sumPxx || !sumPyy) return 0;
  const aPxy_re = sumPxy_re/nSeg, aPxy_im = sumPxy_im/nSeg;
  return Math.min(1, (aPxy_re*aPxy_re+aPxy_im*aPxy_im) / ((sumPxx/nSeg)*(sumPyy/nSeg)));
}

console.log("\n=== 6. rejectHarmonicOutliers ===");
{
  // Normal case: no harmonics → unchanged
  const normal = [72, 73, 71, 72, 74, 73];
  const r1 = rejectHarmonicOutliers(normal);
  assert(r1.length === normal.length, "No harmonics → list unchanged");

  // 2nd harmonic: 4×72, 2×144 → remove 144
  const harmonic = [72, 72, 144, 72, 144, 72];
  const r2 = rejectHarmonicOutliers(harmonic);
  assert(r2.every(b => b <= 80), `2nd harmonic removed (got [${r2}])`);

  // Safety: don't empty list below 2
  const twoItems = [60, 120];
  const r3 = rejectHarmonicOutliers(twoItems);
  assert(r3.length >= 2, "Safety: don't drop below 2 items");

  // 120 dominates (4 votes) vs 60 (1 vote) → 60 is sub-harmonic of 120 → keep both
  // (votesLow=1 < votesHigh=4 → condition votesLow >= votesHigh fails → nothing removed)
  const subHarm = [120, 120, 120, 60, 120];
  const r4 = rejectHarmonicOutliers(subHarm);
  assert(r4.includes(120), `Higher-vote value kept when it dominates (got [${r4}])`);
  assert(r4.length >= 2, "List not emptied by sub-harmonic rule");
}

console.log("\n=== 7. crossChannelCoherence (Welch MSC) ===");
{
  const fps = 30;
  // Use n=600 (20s equivalent) for enough Welch segments to distinguish coherence
  const n = 600;
  const t = Array.from({length: n}, (_, i) => i);

  // Identical signals at 1.2Hz (72 BPM) → MSC ≈ 1.0
  const sig = t.map(i => Math.sin(2*Math.PI*1.2*i/fps));
  const coh1 = crossChannelCoherence(sig, sig, fps, 1.2);
  assertClose(coh1, 1.0, 0.05, `Identical signals → MSC ≈ 1.0 (got ${coh1.toFixed(3)})`);

  // Different frequency: sig1=1.2Hz, sig2=2.7Hz, query at 1.2Hz → low coherence
  // sig2 has no energy at 1.2Hz; phase of any leakage rotates across segments → averages out
  const sigA = t.map(i => Math.sin(2*Math.PI*1.2*i/fps));
  const sigB = t.map(i => Math.sin(2*Math.PI*2.7*i/fps));
  const coh2 = crossChannelCoherence(sigA, sigB, fps, 1.2);
  assert(coh2 < 0.40, `Different-freq signals → MSC low at 1.2Hz (got ${coh2.toFixed(3)})`);

  // R-channel: cardiac + small noise, G-channel: same cardiac + independent noise → moderate-high
  const cardiac = t.map(i => Math.sin(2*Math.PI*1.2*i/fps));
  // Deterministic pseudo-noise: sum of unrelated harmonics (not at 1.2Hz)
  const noise_r = t.map(i => 0.3*(Math.sin(2*Math.PI*0.41*i/fps)+Math.sin(2*Math.PI*2.17*i/fps)));
  const noise_g = t.map(i => 0.3*(Math.sin(2*Math.PI*0.67*i/fps)+Math.sin(2*Math.PI*1.89*i/fps)));
  const r_chan = t.map((_, i) => cardiac[i] + noise_r[i]);
  const g_chan = t.map((_, i) => cardiac[i] + noise_g[i]);
  const coh3 = crossChannelCoherence(r_chan, g_chan, fps, 1.2);
  assert(coh3 > 0.40, `R+G with shared cardiac signal → MSC > 0.40 (got ${coh3.toFixed(3)})`);

  // Coherence at correct freq > coherence at wrong freq (for same coherent pair)
  const cohRight = crossChannelCoherence(r_chan, g_chan, fps, 1.2);
  const cohWrong = crossChannelCoherence(r_chan, g_chan, fps, 2.5); // far from cardiac
  assert(cohRight > cohWrong, `Correct freq coherence > wrong freq coherence`);

  // Short signal → returns 0 (no crash)
  assert(crossChannelCoherence([1,2,3], [1,2,3], fps, 1.0) === 0, "Short signal → 0 (no crash)");
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(45)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(`\n⚠️  ${failed} test(s) FAILED`); process.exit(1); }
else { console.log(`\n✅ All tests passed`); }
