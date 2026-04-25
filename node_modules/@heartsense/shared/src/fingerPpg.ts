import type { MeasurementInput, MeasurementResult } from "./types";

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function normalize(values: number[]): number[] {
  const mean = average(values);
  const centered = values.map((value) => value - mean);
  const maxAbs = Math.max(1, ...centered.map((value) => Math.abs(value)));
  return centered.map((value) => value / maxAbs);
}

function movingAverage(values: number[], windowSize: number): number[] {
  return values.map((_, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1);
    return average(slice);
  });
}

function bandpassLike(values: number[]): number[] {
  const detrended = values.map((value, index, arr) => value - (arr[index - 1] ?? value));
  const smooth = movingAverage(detrended, 4);
  return normalize(smooth);
}

function findPeaks(values: number[], timestampsMs: number[]): number[] {
  const peaks: number[] = [];
  for (let index = 1; index < values.length - 1; index += 1) {
    const prev = values[index - 1];
    const current = values[index];
    const next = values[index + 1];
    const enoughGap = !peaks.length || timestampsMs[index] - peaks[peaks.length - 1] > 320;
    if (current > prev && current > next && current > 0.25 && enoughGap) {
      peaks.push(timestampsMs[index]);
    }
  }
  return peaks;
}

function computeRmssd(rrIntervals: number[]): number {
  if (rrIntervals.length < 2) {
    return 0;
  }
  const deltas = rrIntervals.slice(1).map((value, index) => value - rrIntervals[index]);
  const squared = deltas.map((value) => value * value);
  return Math.sqrt(average(squared));
}

export function analyzeFingerPpg(input: MeasurementInput): MeasurementResult {
  const signal = input.greenSignal && input.greenSignal.length ? input.greenSignal : input.rgbSignal || [];
  const timestamps = input.timestampsMs && input.timestampsMs.length === signal.length
    ? input.timestampsMs
    : signal.map((_, index) => index * 33);

  const filtered = bandpassLike(signal);
  const peaks = findPeaks(filtered, timestamps);
  const rrIntervals = peaks.slice(1).map((value, index) => value - peaks[index]);
  const durationSeconds = Math.max(1, (timestamps[timestamps.length - 1] - timestamps[0]) / 1000);
  const bpm = Math.round((peaks.length / durationSeconds) * 60);
  const rmssd = computeRmssd(rrIntervals);
  const irregularityIndex = Math.round(Math.min(100, rmssd / 8));
  const signalQuality = Math.round(Math.max(20, Math.min(98, 82 - irregularityIndex * 0.4)));
  const confidence = Math.round(Math.max(40, Math.min(97, signalQuality * 0.85)));
  const strokeRiskScore = Math.round(
    Math.max(
      8,
      Math.min(
        99,
        (input.age || 60) * 0.5 +
          ((input.systolic || 128) - 110) * 0.35 +
          irregularityIndex * 0.7 +
          ((input.conditions || []).includes("dot quy") ? 18 : 0),
      ),
    ),
  );

  const classification =
    irregularityIndex >= 58 || strokeRiskScore >= 76
      ? "afib"
      : strokeRiskScore >= 42 || bpm < 50 || bpm > 110
        ? "elevated"
        : "normal";

  return {
    bpm,
    hrvScore: Math.round(Math.max(12, Math.min(95, 90 - rmssd * 0.25))),
    strokeRiskScore,
    irregularityIndex,
    signalQuality,
    confidence,
    classification,
    waveform: filtered.slice(-120).map((value) => Number((value * 48 + 50).toFixed(2))),
  };
}
