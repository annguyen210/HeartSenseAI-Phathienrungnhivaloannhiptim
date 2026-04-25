export type MeasurementKind = "face" | "finger" | "breathing";

export type MeasurementInput = {
  kind: MeasurementKind;
  rgbSignal?: number[];
  greenSignal?: number[];
  timestampsMs?: number[];
  systolic?: number;
  age?: number;
  conditions?: string[];
  contextNote?: string;
};

export type MeasurementResult = {
  bpm: number;
  hrvScore: number;
  strokeRiskScore: number;
  irregularityIndex: number;
  signalQuality: number;
  confidence: number;
  classification: "normal" | "elevated" | "afib";
  waveform: number[];
};

export type GuardianChannel = "sms" | "zalo" | "email" | "push";

export type NotificationPayload = {
  title: string;
  body: string;
  phone?: string;
  email?: string;
  pushSubscription?: unknown;
};
