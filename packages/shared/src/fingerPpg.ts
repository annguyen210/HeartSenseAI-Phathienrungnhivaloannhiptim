import type { MeasurementInput, MeasurementResult } from "./types";

// ─── Utilities ────────────────────────────────────────────────────────────────
function avg(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

function stdv(a: number[]): number {
  if (a.length < 2) return 0;
  const m = avg(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
}

// ─── Butterworth 2nd-order zero-phase bandpass ────────────────────────────────
function applyBiquad(
  signal: number[],
  b: [number, number, number],
  a: [number, number, number],
): number[] {
  const y = new Array(signal.length).fill(0);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const x0 = signal[i];
    const y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    y[i] = y0; x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return y;
}

function butter2HP(cutHz: number, fps: number): [[number, number, number], [number, number, number]] {
  const w = Math.tan(Math.PI * cutHz / fps);
  const k = 1 + Math.SQRT2 * w + w * w;
  const b: [number, number, number] = [1 / k, -2 / k, 1 / k];
  const a: [number, number, number] = [1, 2 * (w * w - 1) / k, (1 - Math.SQRT2 * w + w * w) / k];
  return [b, a];
}

function butter2LP(cutHz: number, fps: number): [[number, number, number], [number, number, number]] {
  const w = Math.tan(Math.PI * cutHz / fps);
  const k = 1 + Math.SQRT2 * w + w * w;
  const w2 = w * w;
  const b: [number, number, number] = [w2 / k, 2 * w2 / k, w2 / k];
  const a: [number, number, number] = [1, 2 * (w2 - 1) / k, (1 - Math.SQRT2 * w + w2) / k];
  return [b, a];
}

function butterworthBandpass(signal: number[], fps: number): number[] {
  const [hpB, hpA] = butter2HP(0.65, fps);
  const [lpB, lpA] = butter2LP(Math.min(3.5, fps * 0.44), fps);
  const fwd = applyBiquad(applyBiquad(signal, hpB, hpA), lpB, lpA);
  const rev = [...fwd].reverse();
  const bwd = applyBiquad(applyBiquad(rev, hpB, hpA), lpB, lpA).reverse();
  return bwd;
}

// ─── Hann window ──────────────────────────────────────────────────────────────
function hannWindow(signal: number[]): number[] {
  const N = signal.length;
  return signal.map((v, i) => v * 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1))));
}

// ─── FFT BPM (4× zero-padding, parabolic interpolation) ──────────────────────
function fftBpm(signal: number[], fps: number): number | null {
  if (signal.length < 60) return null;
  const N = signal.length;
  const P = N * 4;
  const m = avg(signal);
  const windowed = hannWindow(signal.map(v => v - m));
  const freqStep = fps / P;
  const kMin = Math.max(1, Math.floor(40 / 60 / freqStep));
  const kMax = Math.min(Math.floor(P / 2), Math.ceil(185 / 60 / freqStep));
  let bestPower = 0;
  let bestK = kMin;
  const powers: number[] = [];
  for (let k = kMin; k <= kMax; k++) {
    let re = 0, im = 0;
    const w = 2 * Math.PI * k / P;
    for (let n = 0; n < N; n++) { re += windowed[n] * Math.cos(w * n); im -= windowed[n] * Math.sin(w * n); }
    const power = re * re + im * im;
    powers.push(power);
    if (power > bestPower) { bestPower = power; bestK = k; }
  }
  const idx = bestK - kMin;
  let refined = bestK;
  if (idx > 0 && idx < powers.length - 1) {
    const p0 = powers[idx - 1], p1 = powers[idx], p2 = powers[idx + 1];
    const d = p0 - 2 * p1 + p2;
    if (d !== 0) refined = bestK + 0.5 * (p0 - p2) / d;
  }
  const bpm = Math.round(refined * freqStep * 60);
  return bpm >= 40 && bpm <= 185 ? bpm : null;
}

// ─── Autocorrelation BPM (first-peak, guards sub-harmonic) ───────────────────
function autocorrBpm(signal: number[], fps: number): number | null {
  const minLag = Math.max(2, Math.floor(fps * 60 / 185));
  const maxLag = Math.min(Math.floor(signal.length * 0.5), Math.floor(fps * 60 / 40));
  if (maxLag <= minLag || signal.length < 30) return null;
  const n = signal.length;
  const m = avg(signal);
  const c = signal.map(v => v - m);
  const ac0 = c.reduce((s, v) => s + v * v, 0) / n;
  if (!ac0) return null;
  // Find first peak above threshold
  const acf: number[] = new Array(maxLag + 1).fill(0);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += c[i] * c[i + lag];
    acf[lag] = sum / ((n - lag) * ac0);
  }
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (acf[lag] > acf[lag - 1] && acf[lag] > acf[lag + 1] && acf[lag] > 0.24) {
      const rawBpm = Math.round(60 * fps / lag);
      if (rawBpm < 52) {
        const halfLag = Math.round(lag / 2);
        if (halfLag >= minLag) {
          const doubled = Math.round(60 * fps / halfLag);
          if (acf[halfLag] > 0.08 || (doubled >= 52 && doubled <= 150)) {
            return doubled >= 40 && doubled <= 185 ? doubled : null;
          }
        }
        return null;
      }
      return rawBpm >= 40 && rawBpm <= 185 ? rawBpm : null;
    }
  }
  let best = 0.22, bestLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (acf[lag] > best) { best = acf[lag]; bestLag = lag; }
  }
  if (bestLag < 0) return null;
  const bpm = Math.round(60 * fps / bestLag);
  return bpm >= 40 && bpm <= 185 ? bpm : null;
}

// ─── Adaptive peak detection with sub-sample parabolic interpolation ─────────
function detectPeaks(signal: number[], fps: number): number[] {
  const minDist = Math.floor(fps * 0.33);
  const n = signal.length;
  const winHalf = Math.floor(fps * 2);
  const peaks: number[] = [];
  for (let i = 2; i < n - 2; i++) {
    const v = signal[i];
    if (v <= signal[i - 1] || v <= signal[i + 1] || v <= signal[i - 2] || v <= signal[i + 2]) continue;
    const s = Math.max(0, i - winHalf), e = Math.min(n, i + winHalf);
    const loc = signal.slice(s, e);
    const thresh = avg(loc) + stdv(loc) * 0.3;
    if (v < thresh) continue;
    let frac = i;
    const a = signal[i - 1], c2 = signal[i + 1], denom = a - 2 * v + c2;
    if (denom < 0) frac = i + 0.5 * (a - c2) / denom;
    if (peaks.length && frac - peaks[peaks.length - 1] < minDist) {
      if (v > signal[Math.round(peaks[peaks.length - 1])]) peaks[peaks.length - 1] = frac;
      continue;
    }
    peaks.push(frac);
  }
  return peaks;
}

// ─── Hampel filter + 200ms rule for ectopic detection ─────────────────────────
// sigma=2.5 (stricter than 3.0) + flags RR diff >200ms as ectopic
function hampelFilter(rrs: number[], halfWin = 3, sigma = 2.5): number[] {
  if (rrs.length < 2 * halfWin + 1) return [...rrs];
  const out = [...rrs];
  for (let i = 0; i < rrs.length; i++) {
    const lo = Math.max(0, i - halfWin);
    const hi = Math.min(rrs.length, i + halfWin + 1);
    const win = rrs.slice(lo, hi).sort((a, b) => a - b);
    const med = win[Math.floor(win.length / 2)];
    const mad = 1.4826 * avg(win.map(r => Math.abs(r - med)));
    const outlier = mad > 0 && Math.abs(rrs[i] - med) > sigma * mad;
    // 200ms rule: consecutive RR difference indicates ectopic beat
    const ectopic = i > 0 && Math.abs(rrs[i] - rrs[i - 1]) > 200 && Math.abs(rrs[i] - med) > 80;
    if (outlier || ectopic) out[i] = med;
  }
  return out;
}

// ─── Sample entropy ───────────────────────────────────────────────────────────
function sampleEntropy(rrs: number[], m = 2, r = 0.2): number {
  const n = rrs.length;
  if (n < m + 2) return 0;
  const m2 = avg(rrs);
  const s = stdv(rrs);
  const tol = r * (s || m2 * 0.1);
  const count = (len: number): number => {
    let c = 0;
    for (let i = 0; i < n - len; i++) {
      for (let j = i + 1; j < n - len; j++) {
        let match = true;
        for (let k = 0; k < len; k++) {
          if (Math.abs(rrs[i + k] - rrs[j + k]) > tol) { match = false; break; }
        }
        if (match) c++;
      }
    }
    return c;
  };
  const Cm = count(m), Cm1 = count(m + 1);
  if (!Cm || !Cm1) return 0;
  return Math.round(-Math.log(Cm1 / Cm) * 1000) / 1000;
}

// ─── DFA Alpha1 ───────────────────────────────────────────────────────────────
function dfaAlpha1(rrs: number[]): number | null {
  const N = rrs.length;
  if (N < 16) return null;
  const mean = avg(rrs);
  const profile: number[] = [];
  let cs = 0;
  for (const rr of rrs) { cs += rr - mean; profile.push(cs); }
  const scales: number[] = [];
  for (let n = 4; n <= Math.min(Math.floor(N / 4), 16); n += 2) scales.push(n);
  if (scales.length < 3) return null;
  const logS: number[] = [], logF: number[] = [];
  for (const n of scales) {
    const segs = Math.floor(N / n);
    let sumF2 = 0;
    for (let s2 = 0; s2 < segs; s2++) {
      const seg = profile.slice(s2 * n, s2 * n + n);
      const xm = (n - 1) / 2, ym = avg(seg);
      let sxy = 0, sxx = 0;
      for (let i = 0; i < n; i++) { sxy += (i - xm) * (seg[i] - ym); sxx += (i - xm) ** 2; }
      const slope = sxx > 0 ? sxy / sxx : 0;
      const intercept = ym - slope * xm;
      let f2 = 0;
      for (let i = 0; i < n; i++) f2 += (seg[i] - (slope * i + intercept)) ** 2;
      sumF2 += f2 / n;
    }
    logS.push(Math.log10(n));
    logF.push(Math.log10(Math.sqrt(sumF2 / Math.max(1, segs))));
  }
  const nP = logS.length;
  const mx = avg(logS), my = avg(logF);
  let num = 0, den = 0;
  for (let i = 0; i < nP; i++) { num += (logS[i] - mx) * (logF[i] - my); den += (logS[i] - mx) ** 2; }
  return den > 0 ? Math.round(num / den * 1000) / 1000 : null;
}

// ─── Permutation Entropy ──────────────────────────────────────────────────────
function permutationEntropy(rrs: number[], order = 3): number {
  if (rrs.length < order + 2) return 0;
  const patCount = new Map<string, number>();
  const total = rrs.length - order + 1;
  for (let i = 0; i <= rrs.length - order; i++) {
    const seg = rrs.slice(i, i + order);
    const idx = Array.from({ length: order }, (_, j) => j).sort((a, b) => seg[a] - seg[b]);
    const key = idx.join('');
    patCount.set(key, (patCount.get(key) ?? 0) + 1);
  }
  let entropy = 0;
  for (const c of patCount.values()) { const p = c / total; entropy -= p * Math.log2(p); }
  let fact = 1;
  for (let i = 2; i <= order; i++) fact *= i;
  const maxEnt = Math.log2(fact);
  return maxEnt > 0 ? Math.round(entropy / maxEnt * 1000) / 1000 : 0;
}

// ─── Lorenz Sector Analysis ───────────────────────────────────────────────────
function lorenzSectorAnalysis(rrs: number[]): { afibScore: number; diagRatio: number } {
  if (rrs.length < 8) return { afibScore: 0, diagRatio: 1 };
  const mean = avg(rrs);
  const thresh = mean * 0.065;
  let ll = 0, uu = 0, lu = 0, ul = 0;
  const total = rrs.length - 1;
  for (let i = 0; i < total; i++) {
    const x = rrs[i], y = rrs[i + 1];
    const xL = x < mean - thresh, xH = x > mean + thresh;
    const yL = y < mean - thresh, yH = y > mean + thresh;
    if (xL && yL) ll++; else if (xH && yH) uu++; else if (xL && yH) lu++; else if (xH && yL) ul++;
  }
  const diagRatio = (ll + uu) / Math.max(1, total);
  const offRatio = (lu + ul) / Math.max(1, total);
  const offSymm = (lu + ul) > 0 ? 1 - Math.abs(lu - ul) / (lu + ul) : 0;
  const afibScore = Math.round(((1 - diagRatio) * 0.45 + offRatio * 0.35 + offSymm * 0.20) * 1000) / 1000;
  return { afibScore, diagRatio: Math.round(diagRatio * 1000) / 1000 };
}

// ─── Normalized RMSSD ─────────────────────────────────────────────────────────
function normalizedRmssd(rrs: number[]): number {
  if (rrs.length < 4) return 0;
  const meanRR = avg(rrs);
  if (meanRR < 1) return 0;
  const diffs = rrs.slice(1).map((r, i) => Math.abs(r - rrs[i]));
  const rmssd = Math.sqrt(avg(diffs.map(d => d * d)));
  return Math.round(rmssd / meanRR * 1000) / 1000;
}

// ─── Kalman BPM smoother ──────────────────────────────────────────────────────
function kalmanBpmSmooth(series: (number | null)[]): number | null {
  const valid = series.filter((b): b is number => b !== null && b >= 40 && b <= 185);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  let x = valid[0], P = 15.0;
  for (let i = 1; i < valid.length; i++) {
    const z = valid[i];
    P += 2.0;
    const K = P / (P + 8.0);
    x = x + K * (z - x);
    P = (1 - K) * P;
    x = Math.max(z - 20, Math.min(z + 20, x));
  }
  return Math.round(x);
}

// ─── RR histogram entropy ─────────────────────────────────────────────────────
// AFib: histogram phẳng & rộng → entropy cao (>2.5)
// Nhịp xoang: histogram nhọn → entropy thấp (<1.5)
function rrHistogramEntropy(rrs: number[], bins = 8): number {
  if (rrs.length < 8) return 0;
  const mn = Math.min(...rrs), mx = Math.max(...rrs);
  if (mx - mn < 10) return 0;
  const hist = new Array(bins).fill(0);
  for (const rr of rrs) {
    const idx = Math.min(bins - 1, Math.floor((rr - mn) / (mx - mn) * bins));
    hist[idx]++;
  }
  let entropy = 0;
  for (const count of hist) {
    if (count > 0) { const p = count / rrs.length; entropy -= p * Math.log2(p); }
  }
  return Math.round(entropy * 1000) / 1000;
}

// ─── Turning Point Ratio (Tateno & Glass 2001) ───────────────────────────────
function computeTPR(rrs: number[]): number {
  if (rrs.length < 5) return 0;
  let turns = 0;
  for (let i = 1; i < rrs.length - 1; i++) {
    if ((rrs[i] > rrs[i - 1] && rrs[i] > rrs[i + 1]) ||
        (rrs[i] < rrs[i - 1] && rrs[i] < rrs[i + 1])) turns++;
  }
  return rrs.length > 2 ? turns / (rrs.length - 2) : 0;
}

// ─── Poincaré plot SD1/SD2 ────────────────────────────────────────────────────
function poincare(rrs: number[]): { sd1: number; sd2: number; ratio: number } {
  if (rrs.length < 4) return { sd1: 0, sd2: 0, ratio: 0 };
  const diffs = rrs.slice(1).map((r, i) => r - rrs[i]);
  const sd1 = Math.sqrt(diffs.map(d => d * d).reduce((a, b) => a + b, 0) / diffs.length) / Math.SQRT2;
  const m = avg(rrs);
  const sd2 = Math.sqrt(rrs.map(r => (r - m) ** 2).reduce((a, b) => a + b, 0) / rrs.length);
  const ratio = sd2 > 0 ? sd1 / sd2 : 0;
  return { sd1: Math.round(sd1 * 10) / 10, sd2: Math.round(sd2 * 10) / 10, ratio: Math.round(ratio * 1000) / 1000 };
}

// ─── Temporal consistency check ───────────────────────────────────────────────
// AFib thật phải loạn nhịp liên tục — không chỉ 1 đoạn
// Trả về tỉ lệ cửa sổ có CV > 0.15 (AFib ≥ 0.7)
function temporalConsistency(rrs: number[], windowSize = 8): number {
  if (rrs.length < windowSize * 2) return 0;
  const step = Math.floor(windowSize / 2);
  const scores: number[] = [];
  for (let i = 0; i + windowSize <= rrs.length; i += step) {
    const win = rrs.slice(i, i + windowSize);
    const m = avg(win);
    scores.push(m > 0 ? stdv(win) / m : 0);
  }
  return scores.length ? scores.filter(s => s > 0.15).length / scores.length : 0;
}

// ─── Best filtered window selection ──────────────────────────────────────────
// Chọn cửa sổ 20s có post-filter SNR cao nhất từ toàn bộ recording
function selectBestWindow(
  signal: number[],
  timestamps: number[],
  fps: number,
  windowSec = 20,
): { signal: number[]; timestamps: number[] } {
  const winSize = Math.floor(fps * windowSec);
  if (signal.length <= winSize) return { signal, timestamps };
  const step = Math.max(1, Math.floor(fps * 2));
  let bestScore = -Infinity, bestStart = 0;
  for (let start = 0; start + winSize <= signal.length; start += step) {
    const win = signal.slice(start, start + winSize);
    const s = stdv(win);
    // Penalize high-frequency jitter (motion artifact signature)
    const jitter = win.slice(1).reduce((acc, v, i) => acc + Math.abs(v - win[i]), 0) / win.length;
    const score = s > 0 ? s / (1 + jitter * 0.5) : 0;
    if (score > bestScore) { bestScore = score; bestStart = start; }
  }
  return {
    signal: signal.slice(bestStart, bestStart + winSize),
    timestamps: timestamps.slice(bestStart, bestStart + winSize),
  };
}

// ─── Main analysis ────────────────────────────────────────────────────────────
export function analyzeFingerPpg(input: MeasurementInput): MeasurementResult {
  const rawSignal = (input.greenSignal?.length ? input.greenSignal : input.rgbSignal) ?? [];
  const rawTs = input.timestampsMs?.length === rawSignal.length
    ? input.timestampsMs
    : rawSignal.map((_, i) => i * 33);

  // Derive FPS from timestamps (clamped to realistic range)
  const dur = rawTs[rawTs.length - 1] - rawTs[0];
  const fps = Math.max(15, Math.min(60, rawSignal.length > 1 ? rawSignal.length / Math.max(1, dur / 1000) : 30));

  if (rawSignal.length < fps * 10) {
    return { bpm: 0, hrvScore: 0, strokeRiskScore: 0, irregularityIndex: 0, signalQuality: 0, confidence: 0, classification: "normal", waveform: [] };
  }

  // Bandpass filter full signal first, then select best window
  const filteredFull = butterworthBandpass(rawSignal, fps);
  const { signal: filtered, timestamps: winTs } = selectBestWindow(filteredFull, rawTs, fps, 20);

  const filteredStd = stdv(filtered);
  if (filteredStd < 0.15) {
    return { bpm: 0, hrvScore: 0, strokeRiskScore: 0, irregularityIndex: 0, signalQuality: 20, confidence: 0, classification: "normal", waveform: [] };
  }

  // ── BPM ensemble: 3 independent methods ──────────────────────────────────────
  const peaks = detectPeaks(filtered, fps);
  const fftResult = fftBpm(filtered, fps);
  const acfResult = autocorrBpm(filtered, fps);

  // RR intervals from peaks — NO IQR filter here (keep ectopics for HRV/AFib analysis)
  const rrRaw: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const rr = (peaks[i] - peaks[i - 1]) / fps * 1000;
    if (rr >= 300 && rr <= 2000) rrRaw.push(rr);
  }
  // Separate IQR-filtered RRs for BPM estimation only
  const rrForBpm = (() => {
    if (rrRaw.length < 4) return rrRaw;
    const s = [...rrRaw].sort((a, b) => a - b);
    const q1 = s[Math.floor(s.length * 0.25)], q3 = s[Math.floor(s.length * 0.75)];
    const iqr = q3 - q1;
    return rrRaw.filter(r => r >= q1 - 1.5 * iqr && r <= q3 + 1.5 * iqr);
  })();
  const peakBpm = rrForBpm.length >= 3 ? Math.round(60000 / avg(rrForBpm)) : null;

  const allValid = [peakBpm, fftResult, acfResult].filter((b): b is number => b !== null && b >= 40 && b <= 185);
  if (allValid.length === 0) {
    return { bpm: 0, hrvScore: 0, strokeRiskScore: 0, irregularityIndex: 0, signalQuality: 20, confidence: 0, classification: "normal", waveform: [] };
  }

  const sortedBpms = [...allValid].sort((a, b) => a - b);
  const bpm = sortedBpms.length % 2 === 0
    ? Math.round((sortedBpms[sortedBpms.length / 2 - 1] + sortedBpms[sortedBpms.length / 2]) / 2)
    : sortedBpms[Math.floor(sortedBpms.length / 2)];

  const methodsAgreeing = allValid.filter(b => Math.abs(b - bpm) <= 8).length;

  // ── HRV metrics on Hampel-cleaned RR (keeps ectopics, sigma=2.5+200ms rule) ─
  const rrIntervals = rrRaw.length >= 6 ? hampelFilter(rrRaw) : rrRaw;
  const n = rrIntervals.length;

  const sdnn = n >= 3 ? Math.round(stdv(rrIntervals)) : 0;
  const diffs = rrIntervals.slice(1).map((r, i) => Math.abs(r - rrIntervals[i]));
  const rmssd = diffs.length ? Math.round(Math.sqrt(avg(diffs.map(d => d * d)))) : 0;
  const pnn50 = diffs.length >= 3 ? Math.round(diffs.filter(d => d > 50).length / diffs.length * 100) : 0;
  const cv = n >= 4 ? stdv(rrIntervals) / avg(rrIntervals) : 0;

  const sampEn   = n >= 12 ? sampleEntropy(rrIntervals) : 0;
  const pc       = poincare(rrIntervals);
  const tpr      = computeTPR(rrIntervals);
  const histEnt  = rrHistogramEntropy(rrIntervals);
  const temporal = temporalConsistency(rrIntervals);
  const rmssdSdnnRatio = sdnn > 0 ? rmssd / sdnn : 0;
  // v4 new metrics
  const dfa1   = n >= 16 ? dfaAlpha1(rrIntervals) : null;
  const pe     = n >= 6  ? permutationEntropy(rrIntervals, 3) : 0;
  const lorenz = lorenzSectorAnalysis(rrIntervals);
  const nRmssd = normalizedRmssd(rrIntervals);

  // ── Kalman BPM: multi-window series + smooth ─────────────────────────────────
  const winSize2 = Math.floor(fps * 8);
  const stepSize2 = Math.floor(fps * 3);
  const bpmSeries: (number | null)[] = [];
  for (let start = 0; start + winSize2 <= filtered.length; start += stepSize2) {
    const win = filtered.slice(start, start + winSize2);
    const fb = fftBpm(win, fps);
    const ab = autocorrBpm(win, fps);
    const candidates = [fb, ab].filter((b): b is number => b !== null && b >= 40 && b <= 185);
    if (candidates.length >= 1) {
      bpmSeries.push(Math.round(candidates.reduce((a, b) => a + b, 0) / candidates.length));
    }
  }
  const kalmanBpm2 = kalmanBpmSmooth(bpmSeries);
  const finalBpm = kalmanBpm2 && Math.abs(kalmanBpm2 - bpm) <= 8
    ? Math.round(kalmanBpm2 * 0.6 + bpm * 0.4)
    : bpm;

  // ── Signal quality ────────────────────────────────────────────────────────────
  const rawStd = stdv(rawSignal.slice(0, filtered.length));
  const spectralBonus = rawStd > 0 ? Math.min(12, (filteredStd / rawStd) * 18) : 0;
  const expectedPeaks = (filtered.length / fps) * (finalBpm / 60);
  const signalQuality = Math.round(Math.min(95, Math.max(20,
    (peaks.length / Math.max(1, expectedPeaks)) * 46 +
    (methodsAgreeing >= 2 ? 10 : 0) + spectralBonus + 10 + (n >= 20 ? 4 : 0),
  )));

  // ── Physiological plausibility gates ─────────────────────────────────────────
  const cvPhysio   = cv >= 0.10 && cv <= 0.52;
  const sdnnPhysio = sdnn >= 15 && sdnn <= 185;
  const rmssdPhysio = rmssd >= 8 && rmssd <= 210;
  const bpmPhysio  = finalBpm >= 45 && finalBpm <= 160;
  const physiologicalGate = cvPhysio && sdnnPhysio && rmssdPhysio && bpmPhysio
    && fftResult !== null && methodsAgreeing >= 2;

  // ── AFib evidence scoring v4 (max 176 pts) ────────────────────────────────────
  let afibEvidence = 0;
  if (physiologicalGate && signalQuality >= 60 && n >= 14) {
    const cvCapped = Math.min(cv, 0.52);
    const cvThresh = signalQuality >= 82 ? 0.17 : signalQuality >= 72 ? 0.20 : 0.23;

    if (cvCapped > 0.30) afibEvidence += 35; else if (cvCapped > cvThresh) afibEvidence += 25; else if (cvCapped > 0.13) afibEvidence += 8;
    if (pnn50 > 45) afibEvidence += 18; else if (pnn50 > 28) afibEvidence += 10; else if (pnn50 > 18) afibEvidence += 4;
    if (sdnn > 65 && sdnn <= 185) afibEvidence += 12; else if (sdnn > 42) afibEvidence += 7;
    if (sampEn > 1.1) afibEvidence += 12; else if (sampEn > 0.85) afibEvidence += 7;
    if (tpr > 0.72) afibEvidence += 10; else if (tpr > 0.64) afibEvidence += 5;
    if (pc.ratio > 1.0 && pc.sd1 > 28) afibEvidence += 8; else if (pc.ratio > 0.85) afibEvidence += 3;
    if (rmssdSdnnRatio > 1.5) afibEvidence += 8; else if (rmssdSdnnRatio > 1.15) afibEvidence += 4;
    if (histEnt > 2.5) afibEvidence += 10; else if (histEnt > 1.8) afibEvidence += 6; else if (histEnt > 1.2) afibEvidence += 2;
    if (temporal >= 0.7) afibEvidence += 8; else if (temporal >= 0.5) afibEvidence += 4;

    // DFA alpha1 (15 pts)
    if (dfa1 !== null) {
      if (dfa1 < 0.60) afibEvidence += 15;
      else if (dfa1 < 0.75) afibEvidence += 9;
      else if (dfa1 < 0.90) afibEvidence += 3;
      if (dfa1 > 1.05) afibEvidence = Math.max(0, afibEvidence - 8);
    }
    // Permutation entropy (12 pts)
    if (pe > 0.92) afibEvidence += 12; else if (pe > 0.82) afibEvidence += 7; else if (pe > 0.70) afibEvidence += 3;
    if (pe < 0.55) afibEvidence = Math.max(0, afibEvidence - 5);
    // Lorenz sectors (10 pts)
    if (lorenz.afibScore > 0.58) afibEvidence += 10; else if (lorenz.afibScore > 0.44) afibEvidence += 5; else if (lorenz.afibScore > 0.32) afibEvidence += 2;
    if (lorenz.diagRatio > 0.65) afibEvidence = Math.max(0, afibEvidence - 6);
    // Normalized RMSSD (8 pts)
    if (nRmssd > 0.32) afibEvidence += 8; else if (nRmssd > 0.24) afibEvidence += 4; else if (nRmssd > 0.18) afibEvidence += 1;

    if (n >= 22 && signalQuality >= 78) afibEvidence += 5; else if (n >= 16) afibEvidence += 2;
    if (methodsAgreeing >= 3) afibEvidence += 3;
    // Multi-metric consensus bonus
    const strongMetrics = [cvCapped > 0.28, pnn50 > 38, dfa1 !== null && dfa1 < 0.70, pe > 0.85, lorenz.afibScore > 0.50, temporal >= 0.60].filter(Boolean).length;
    if (strongMetrics >= 5) afibEvidence += 8; else if (strongMetrics >= 4) afibEvidence += 4;
  }

  const afibScore = Math.round(Math.min(95, afibEvidence * 0.54));
  const afibLikelihood = physiologicalGate && signalQuality >= 62 && n >= 14 && afibEvidence >= 75 && temporal >= 0.40;

  // ── HRV score ─────────────────────────────────────────────────────────────────
  const hrvScore = Math.round(Math.min(94, Math.max(14,
    (Math.min(sdnn || 28, 90) / 90 * 55) + (Math.min(rmssd || 18, 65) / 65 * 45),
  )));

  // ── Stroke risk score ─────────────────────────────────────────────────────────
  const age = input.age ?? 60;
  const systolic = input.systolic ?? 128;
  const conditions = input.conditions ?? [];
  const condRisk = (conditions.some(c => /cao huyet ap|tang huyet ap/.test(c)) ? 16 : 0) +
    (conditions.some(c => /tieu duong/.test(c)) ? 11 : 0) +
    (conditions.some(c => /dot quy/.test(c)) ? 20 : 0) +
    (conditions.some(c => /afib|rung nhi/.test(c)) ? 22 : 0);
  const strokeRiskScore = Math.round(Math.max(8, Math.min(99,
    condRisk + Math.max(0, age - 45) * 0.72 + Math.max(0, systolic - 120) * 0.42 +
    afibScore * 0.64,
  )));

  // ── Classification ────────────────────────────────────────────────────────────
  const classification: "normal" | "elevated" | "afib" =
    afibLikelihood ? "afib"
    : strokeRiskScore >= 68 || bpm < 46 || bpm > 118 ? "elevated"
    : "normal";

  const confidence = Math.round(Math.max(40, Math.min(97, signalQuality * 0.85)));

  // ── Waveform (last 90 samples normalized 25–135) ──────────────────────────────
  const wSlice = filtered.slice(-90);
  const wMin = Math.min(...wSlice), wMax = Math.max(...wSlice);
  const wSpan = Math.max(1, wMax - wMin);
  const waveform = wSlice.map(v => Math.round((25 + ((v - wMin) / wSpan) * 110) * 100) / 100);

  return { bpm: finalBpm, hrvScore, strokeRiskScore, irregularityIndex: afibScore, signalQuality, confidence, classification, waveform };
}
