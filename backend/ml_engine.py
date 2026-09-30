import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor, IsolationForest
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import joblib
import os

PERSISTENCE_THRESHOLD = 3  # Configurable anomaly persistence threshold

class MineML:
    def __init__(self):
        self.fos_model = None
        # Per-node anomaly detectors — each node gets its own IsolationForest
        self.anomaly_detectors = {}  # node_id -> IsolationForest instance
        # Per-node hysteresis state
        self.node_states = {}  # node_id -> {"anomalies_in_a_row": 0, "is_calibrated": False, "baseline": {...}}
        self.model_path = os.path.join(os.path.dirname(__file__), 'fos_model.joblib')
        self._load_model_if_exists()
        
    def _load_model_if_exists(self):
        if os.path.exists(self.model_path):
            try:
                self.fos_model = joblib.load(self.model_path)
            except Exception as e:
                print(f"Error loading model: {e}")

    def train_fos_model(self, xlsx_path):
        if not os.path.exists(xlsx_path):
            raise FileNotFoundError(f"Dataset {xlsx_path} not found.")
            
        print(f"Loading dataset from {xlsx_path}...")
        df = pd.read_excel(xlsx_path)
        
        df.columns = df.columns.str.strip()
        
        expected_features = [
            'Cohesion (kN/m2)', 
            'Phi (deg)', 
            'Unit Weight (kN/m3)', 
            'Overall Bench Height', 
            'Overall Slope angle', 
            'Natural Moisture content'
        ]
        
        if 'FOS' not in df.columns:
            raise ValueError("Target column 'FOS' not found in dataset.")
            
        for f in expected_features:
            if f not in df.columns:
                raise ValueError(f"Expected feature column '{f}' not found in dataset.")
                
        X = df[expected_features]
        y = df['FOS']
        
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        
        print("Training Random Forest Regressor for FOS...")
        self.fos_model = RandomForestRegressor(n_estimators=100, random_state=42)
        self.fos_model.fit(X_train, y_train)
        
        y_pred = self.fos_model.predict(X_test)
        mae = mean_absolute_error(y_test, y_pred)
        rmse = np.sqrt(mean_squared_error(y_test, y_pred))
        r2 = r2_score(y_test, y_pred)
        
        print(f"\n--- Training Validation Metrics ---")
        print(f"MAE:  {mae:.4f}")
        print(f"RMSE: {rmse:.4f}")
        print(f"R²:   {r2:.4f}")
        print("-----------------------------------\n")
        
        joblib.dump(self.fos_model, self.model_path)
        print(f"Model saved to {self.model_path}")
        
        return {"mae": mae, "rmse": rmse, "r2": r2}
        
    def calibrate_anomaly_detector(self, node_id, telemetry_history):
        """Calibrate a per-node IsolationForest from baseline telemetry."""
        df = pd.DataFrame(telemetry_history)
        if len(df) < 100:
            return False
            
        features = ['distance_mm', 'tilt_x', 'tilt_y', 'soil_moisture_percent']
        X = df[features]
        
        # Create a dedicated IsolationForest for THIS node
        detector = IsolationForest(contamination=0.02, random_state=42)
        detector.fit(X)
        self.anomaly_detectors[node_id] = detector
        
        # Compute baseline statistics for this node
        baseline = {}
        for col in features:
            baseline[col] = {
                "mean": float(X[col].mean()),
                "std": float(X[col].std()),
                "min": float(X[col].min()),
                "max": float(X[col].max()),
            }
        
        if node_id not in self.node_states:
            self.node_states[node_id] = {"anomalies_in_a_row": 0, "is_calibrated": False}
        self.node_states[node_id]["is_calibrated"] = True
        self.node_states[node_id]["baseline"] = baseline
        return True
        
    def evaluate_live_risk(self, node_id, current_telemetry, geotechnical_data=None):
        if node_id not in self.node_states:
            self.node_states[node_id] = {"anomalies_in_a_row": 0, "is_calibrated": False, "baseline": {}}
            
        state = self.node_states[node_id]
        
        fos_risk = "STABLE"
        fos_reason = ""
        current_fos = None
        affected_params = []
        
        # 1. Evaluate Geotechnical FOS
        if self.fos_model and geotechnical_data:
            try:
                X_geo = pd.DataFrame([geotechnical_data])
                current_fos = float(self.fos_model.predict(X_geo)[0])
                
                if current_fos < 1.2:
                    fos_risk = "CRITICAL"
                    fos_reason = f"Predicted stability margin (FOS {current_fos:.2f}) is below the configured critical threshold (1.2)."
                elif current_fos < 1.5:
                    fos_risk = "WATCH"
                    fos_reason = f"Predicted stability margin (FOS {current_fos:.2f}) is in the warning range (1.2–1.5)."
                else:
                    fos_reason = f"Predicted stability margin (FOS {current_fos:.2f}) is adequate."
            except Exception as e:
                fos_reason = f"Error evaluating FOS: {e}"
                
        # 2. Evaluate Live Telemetry Anomaly (per-node detector)
        anomaly_risk = "CALIBRATING"
        anomaly_reason = "Collecting baseline telemetry to calibrate anomaly detector."
        is_anomaly = False
        
        if state["is_calibrated"] and node_id in self.anomaly_detectors:
            try:
                X_live = pd.DataFrame([[
                    current_telemetry['distance_mm'],
                    current_telemetry['tilt_x'],
                    current_telemetry['tilt_y'],
                    current_telemetry['soil_moisture_percent']
                ]], columns=['distance_mm', 'tilt_x', 'tilt_y', 'soil_moisture_percent'])
                
                pred = self.anomaly_detectors[node_id].predict(X_live)[0]
                is_anomaly = bool(pred == -1)
                
                # Compute baseline deviations for affected parameter detection
                baseline = state.get("baseline", {})
                for param_key, param_label in [
                    ('distance_mm', 'Distance'), ('tilt_x', 'Tilt'),
                    ('soil_moisture_percent', 'Soil Moisture')
                ]:
                    if param_key in baseline:
                        bl = baseline[param_key]
                        current_val = current_telemetry[param_key]
                        if bl["std"] > 0:
                            z_score = abs(current_val - bl["mean"]) / bl["std"]
                            if z_score > 2.5:
                                affected_params.append({
                                    "parameter": param_label,
                                    "current": round(current_val, 2),
                                    "baseline_mean": round(bl["mean"], 2),
                                    "deviation": round(current_val - bl["mean"], 2),
                                    "z_score": round(z_score, 2)
                                })
                
                # Apply persistence/hysteresis with CAPPED counter
                if is_anomaly:
                    state["anomalies_in_a_row"] = min(
                        state["anomalies_in_a_row"] + 1,
                        PERSISTENCE_THRESHOLD  # NEVER exceed threshold
                    )
                else:
                    # Decrement by 1 on normal reading, floor at 0
                    state["anomalies_in_a_row"] = max(0, state["anomalies_in_a_row"] - 1)
                    
                if state["anomalies_in_a_row"] >= PERSISTENCE_THRESHOLD:
                    anomaly_risk = "CRITICAL"
                    anomaly_reason = f"Persistent abnormal sensor readings detected ({state['anomalies_in_a_row']}/{PERSISTENCE_THRESHOLD} consecutive anomalies)."
                elif state["anomalies_in_a_row"] >= 1:
                    anomaly_risk = "WATCH"
                    anomaly_reason = f"Transient abnormal sensor reading detected ({state['anomalies_in_a_row']}/{PERSISTENCE_THRESHOLD}). Monitoring for persistence."
                else:
                    anomaly_risk = "STABLE"
                    anomaly_reason = "Live telemetry aligns with historical stable baseline."
            except Exception as e:
                anomaly_risk = "STABLE"
                anomaly_reason = f"Anomaly detection error: {e}"

        # 3. Fuse Risks — highest severity wins
        if fos_risk == "CRITICAL" or anomaly_risk == "CRITICAL":
            final_state = "CRITICAL"
        elif fos_risk == "WATCH" or anomaly_risk == "WATCH":
            final_state = "WATCH"
        elif anomaly_risk == "CALIBRATING":
            final_state = "CALIBRATING"
        else:
            final_state = "STABLE"
            
        reasons = [r for r in [fos_reason, anomaly_reason] if r]
        
        return {
            "state": final_state,
            "reasons": reasons,
            "fos_value": current_fos,
            "is_telemetry_anomalous": is_anomaly,
            "anomaly_persistence": int(state["anomalies_in_a_row"]),
            "persistence_threshold": PERSISTENCE_THRESHOLD,
            "affected_params": affected_params,
            "baseline": state.get("baseline", {})
        }

    def generate_forecast(self, telemetry_history, parameter_key, horizon=10):
        if len(telemetry_history) < 30:
            return {"error": "INSUFFICIENT HISTORY FOR FORECAST"}
            
        df = pd.DataFrame(telemetry_history)
        if parameter_key not in df.columns or 'timestamp' not in df.columns:
            return {"error": "INVALID PARAMETER"}
            
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df = df.sort_values('timestamp')
        
        y = df[parameter_key].values.astype(float)
        
        # Create lag features (AR-3)
        lags = 3
        if len(y) <= lags:
            return {"error": "INSUFFICIENT HISTORY FOR FORECAST"}
            
        X_train, y_train = [], []
        for i in range(lags, len(y)):
            X_train.append(y[i-lags:i])
            y_train.append(y[i])
            
        X_train = np.array(X_train)
        y_train = np.array(y_train)
        
        from sklearn.linear_model import Ridge
        model = Ridge()
        model.fit(X_train, y_train)
        
        preds = model.predict(X_train)
        rmse = float(np.sqrt(mean_squared_error(y_train, preds)))
        
        # Determine trend from last N values
        recent = y[-min(20, len(y)):]
        if len(recent) > 1:
            trend_slope = float(np.polyfit(range(len(recent)), recent, 1)[0])
        else:
            trend_slope = 0.0
        
        # Autoregressive forecasting
        forecasts = []
        current_lag = list(y[-lags:])
        last_time = df['timestamp'].iloc[-1]
        
        if len(df) > 1:
            avg_dt = (df['timestamp'].iloc[-1] - df['timestamp'].iloc[0]) / (len(df) - 1)
        else:
            avg_dt = pd.Timedelta(seconds=60)
            
        for i in range(horizon):
            pred_y = float(model.predict([current_lag])[0])
            current_time = last_time + avg_dt * (i + 1)
            
            forecasts.append({
                "timestamp": current_time.isoformat(),
                "forecast_value": pred_y,
                "lower_bound": float(pred_y - 1.96 * rmse),
                "upper_bound": float(pred_y + 1.96 * rmse)
            })
            
            current_lag.pop(0)
            current_lag.append(pred_y)
            
        return {
            "model": "Ridge Regression (AR-3)",
            "history_length": len(telemetry_history),
            "horizon": horizon,
            "rmse": rmse,
            "trend_direction": "rising" if trend_slope > 0.01 else "falling" if trend_slope < -0.01 else "stable",
            "trend_slope": float(trend_slope),
            "forecast": forecasts
        }

if __name__ == "__main__":
    ml = MineML()
    metrics = ml.train_fos_model(r"d:\SHESHA\indian_mine_data.xlsx")

