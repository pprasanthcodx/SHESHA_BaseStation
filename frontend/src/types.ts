export interface TelemetryData {
  timestamp: string;
  node_id: string;
  distance: number;
  tilt: number;
  soil: number;
  battery: number;
  rssi: number;
  trigger: boolean;
}

export interface AffectedParam {
  parameter: string;
  current: number;
  baseline_mean: number;
  deviation: number;
  z_score: number;
}

export interface RiskData {
  level: "STABLE" | "WATCH" | "CRITICAL" | "CALIBRATING";
  fos: number | null;
  anomaly_persistence: number;
  persistence_threshold: number;
  is_anomalous: boolean;
  model_status: string;
  reasons: string[];
  affected_params: AffectedParam[];
}

export interface LiveTelemetryPayload {
  type: "LIVE_TELEMETRY";
  telemetry: TelemetryData;
  risk: RiskData;
}

export interface ForecastPoint {
  timestamp: string;
  forecast_value: number;
  lower_bound: number;
  upper_bound: number;
}

export interface ForecastResult {
  model?: string;
  history_length?: number;
  horizon?: number;
  rmse?: number;
  trend_direction?: string;
  trend_slope?: number;
  forecast?: ForecastPoint[];
  error?: string;
}
