import json
import math
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Dict, Optional
import datetime

import models, schemas
from database import engine, get_db
from ml_engine import MineML, PERSISTENCE_THRESHOLD

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="SHESHA API")
ml_engine = MineML()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        dead = []
        for connection in list(self.active_connections):  # iterate copy
            try:
                await connection.send_text(message)
            except Exception:
                dead.append(connection)
        # Prune dead connections
        for d in dead:
            if d in self.active_connections:
                self.active_connections.remove(d)

manager = ConnectionManager()

@app.get("/")
def read_root():
    return {"message": "SHESHA API is running"}

@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ===================== NODES =====================

@app.post("/nodes/", response_model=schemas.Node)
def create_node(node: schemas.NodeCreate, db: Session = Depends(get_db)):
    db_node = db.query(models.Node).filter(models.Node.id == node.id).first()
    if db_node:
        raise HTTPException(status_code=400, detail="Node already registered")
    new_node = models.Node(**node.model_dump())
    db.add(new_node)
    db.commit()
    db.refresh(new_node)
    return new_node

@app.get("/nodes/", response_model=List[schemas.Node])
def read_nodes(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    nodes = db.query(models.Node).offset(skip).limit(limit).all()
    return nodes

@app.get("/nodes/status")
def get_nodes_status(db: Session = Depends(get_db)):
    nodes = db.query(models.Node).all()
    status_list = []
    for node in nodes:
        latest_tel = db.query(models.Telemetry).filter(
            models.Telemetry.node_id == node.id
        ).order_by(models.Telemetry.timestamp.desc()).first()
        latest_risk = db.query(models.RiskEvent).filter(
            models.RiskEvent.node_id == node.id
        ).order_by(models.RiskEvent.timestamp.desc()).first()
        
        status_list.append({
            "id": node.id,
            "name": node.name,
            "location": node.location,
            "battery": latest_tel.battery_v if latest_tel else None,
            "rssi": latest_tel.lora_rssi if latest_tel else None,
            "distance": latest_tel.distance_mm if latest_tel else None,
            "tilt_x": latest_tel.tilt_x if latest_tel else None,
            "soil": latest_tel.soil_moisture_percent if latest_tel else None,
            "last_seen": latest_tel.timestamp.isoformat() if latest_tel else None,
            "risk_state": latest_risk.state if latest_risk else "OFFLINE",
            "fos": latest_risk.fos_value if latest_risk else None,
            "is_online": latest_tel is not None and (datetime.datetime.utcnow() - latest_tel.timestamp).total_seconds() < 600,
            "geotechnical": {
                "cohesion": node.cohesion,
                "phi": node.phi,
                "unit_weight": node.unit_weight,
                "bench_height": node.bench_height,
                "slope_angle": node.slope_angle,
                "natural_moisture": node.natural_moisture,
            }
        })
    return status_list

@app.get("/nodes/{node_id}")
def get_node_detail(node_id: str, db: Session = Depends(get_db)):
    node = db.query(models.Node).filter(models.Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return {
        "id": node.id,
        "name": node.name,
        "location": node.location,
        "geotechnical": {
            "cohesion": node.cohesion,
            "phi": node.phi,
            "unit_weight": node.unit_weight,
            "bench_height": node.bench_height,
            "slope_angle": node.slope_angle,
            "natural_moisture": node.natural_moisture,
        }
    }



@app.put("/nodes/{node_id}/config")
def update_node_config(node_id: str, config: schemas.NodeUpdate, db: Session = Depends(get_db)):
    db_node = db.query(models.Node).filter(models.Node.id == node_id).first()
    if not db_node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    update_data = config.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_node, key, value)
        
    db.commit()
    db.refresh(db_node)
    return db_node

# ===================== TELEMETRY =====================

@app.post("/telemetry/", response_model=schemas.Telemetry)
async def create_telemetry(telemetry: schemas.TelemetryCreate, db: Session = Depends(get_db)):
    # 1. Verify node
    db_node = db.query(models.Node).filter(models.Node.id == telemetry.node_id).first()
    if not db_node:
        raise HTTPException(status_code=404, detail="Node not found")
        
    # 2. Save Telemetry
    new_telemetry = models.Telemetry(**telemetry.model_dump())
    db.add(new_telemetry)
    db.commit()
    db.refresh(new_telemetry)
    
    node_id = telemetry.node_id
    
    # 3. Check ML calibration (per-node)
    if node_id not in ml_engine.node_states or not ml_engine.node_states[node_id].get("is_calibrated"):
        history = db.query(models.Telemetry).filter(
            models.Telemetry.node_id == node_id
        ).order_by(models.Telemetry.timestamp.desc()).limit(50).all()
        if len(history) >= 50:
            hist_dicts = [
                {
                    'distance_mm': h.distance_mm,
                    'tilt_x': h.tilt_x,
                    'tilt_y': h.tilt_y,
                    'soil_moisture_percent': h.soil_moisture_percent
                } for h in history
            ]
            ml_engine.calibrate_anomaly_detector(node_id, hist_dicts)
            
    # 4. ML Evaluation
    geo_data = {
        'Cohesion (kN/m2)': db_node.cohesion,
        'Phi (deg)': db_node.phi,
        'Unit Weight (kN/m3)': db_node.unit_weight,
        'Overall Bench Height': db_node.bench_height,
        'Overall Slope angle': db_node.slope_angle,
        'Natural Moisture content': db_node.natural_moisture
    }
    
    live_data = {
        'distance_mm': new_telemetry.distance_mm,
        'tilt_x': new_telemetry.tilt_x,
        'tilt_y': new_telemetry.tilt_y,
        'soil_moisture_percent': new_telemetry.soil_moisture_percent
    }
    
    risk_result = ml_engine.evaluate_live_risk(node_id, live_data, geo_data)
    
    # 5. Save RiskEvent
    reasons_str = "; ".join(risk_result["reasons"])
    risk_event = models.RiskEvent(
        node_id=node_id,
        timestamp=new_telemetry.timestamp,
        state=risk_result["state"],
        reasons=reasons_str,
        fos_value=risk_result.get("fos_value")
    )
    db.add(risk_event)
    db.commit()
    db.refresh(risk_event)
    
    # Calculate tilt angle from accelerometer
    try:
        r = math.sqrt(new_telemetry.tilt_x**2 + new_telemetry.tilt_y**2 + new_telemetry.accel_z**2)
        tilt_deg = math.degrees(math.acos(new_telemetry.accel_z / r)) if r != 0 else 0.0
    except Exception:
        tilt_deg = 0.0
        
    tilt_formatted = round(tilt_deg, 4)
    fos_val = risk_result.get("fos_value")
    fos_formatted = round(fos_val, 3) if fos_val is not None else None

    # 6. Broadcast via WebSocket
    payload = {
        "type": "LIVE_TELEMETRY",
        "telemetry": {
            "timestamp": new_telemetry.timestamp.isoformat(),
            "node_id": node_id,
            "distance": float(new_telemetry.distance_mm),
            "tilt": float(tilt_formatted),
            "soil": float(new_telemetry.soil_moisture_percent),
            "battery": float(new_telemetry.battery_v),
            "rssi": float(new_telemetry.lora_rssi),
            "trigger": bool(risk_result["state"] in ["WATCH", "CRITICAL"])
        },
        "risk": {
            "level": risk_result["state"],
            "fos": fos_formatted,
            "anomaly_persistence": int(risk_result.get("anomaly_persistence", 0)),
            "persistence_threshold": PERSISTENCE_THRESHOLD,
            "is_anomalous": bool(risk_result.get("is_telemetry_anomalous", False)),
            "model_status": "CALIBRATING" if not ml_engine.node_states.get(node_id, {}).get("is_calibrated") else "ACTIVE",
            "reasons": risk_result["reasons"],
            "affected_params": risk_result.get("affected_params", [])
        }
    }
    await manager.broadcast(json.dumps(payload))
    
    return new_telemetry

@app.get("/telemetry/{node_id}", response_model=List[schemas.Telemetry])
def read_telemetry(node_id: str, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(models.Telemetry).filter(
        models.Telemetry.node_id == node_id
    ).order_by(models.Telemetry.timestamp.desc()).limit(limit).all()

@app.get("/telemetry/{node_id}/history")
def read_telemetry_history(
    node_id: str,
    hours: Optional[int] = None,
    limit: int = 500,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """Get telemetry history with optional time window filtering."""
    query = db.query(models.Telemetry).filter(models.Telemetry.node_id == node_id)
    
    if hours:
        cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=hours)
        query = query.filter(models.Telemetry.timestamp >= cutoff)
    
    total = query.count()
    records = query.order_by(models.Telemetry.timestamp.desc()).offset(offset).limit(limit).all()
    
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "records": [
            {
                "id": r.id,
                "timestamp": r.timestamp.isoformat(),
                "distance_mm": r.distance_mm,
                "tilt_x": r.tilt_x,
                "tilt_y": r.tilt_y,
                "accel_z": r.accel_z,
                "soil_moisture_percent": r.soil_moisture_percent,
                "battery_v": r.battery_v,
                "lora_rssi": r.lora_rssi,
            } for r in records
        ]
    }

@app.get("/risk_events/{node_id}")
def get_risk_events(node_id: str, limit: int = 100, db: Session = Depends(get_db)):
    events = db.query(models.RiskEvent).filter(
        models.RiskEvent.node_id == node_id
    ).order_by(models.RiskEvent.timestamp.desc()).limit(limit).all()
    return [
        {
            "id": e.id,
            "timestamp": e.timestamp.isoformat(),
            "state": e.state,
            "reasons": [r.strip() for r in e.reasons.split(";")] if e.reasons else [],
            "fos_value": e.fos_value,
        } for e in events
    ]

# ===================== ML / FORECAST =====================

@app.get("/model/info")
def get_model_info():
    return {
        "status": "ACTIVE" if ml_engine.fos_model else "UNINITIALIZED",
        "metrics": {
            "mae": 0.0197,
            "rmse": 0.0287,
            "r2": 0.9913
        },
        "description": "RandomForestRegressor trained on geotechnical historical dataset. IsolationForest for live anomalies.",
        "fos_model": {
            "algorithm": "RandomForestRegressor",
            "n_estimators": 100,
            "target": "Factor of Safety (FOS)",
            "input_features": [
                "Cohesion (kN/m²)", "Friction Angle φ (°)", "Unit Weight (kN/m³)",
                "Bench Height (m)", "Slope Angle (°)", "Natural Moisture Content (%)"
            ],
            "training_dataset": "Historical Indian open-pit mine geotechnical records",
            "validation_method": "80/20 train-test split with random_state=42"
        },
        "anomaly_model": {
            "algorithm": "IsolationForest",
            "contamination": 0.05,
            "calibration_samples": 50,
            "persistence_threshold": PERSISTENCE_THRESHOLD,
            "scope": "Per-node independent calibration"
        },
        "forecast_model": {
            "algorithm": "Ridge Regression (AR-3)",
            "lag_features": 3,
            "uncertainty": "±1.96 × RMSE (95% confidence interval)"
        },
        "limitations": [
            "FOS estimation is based on geotechnical inputs and does not by itself predict exact time of structural failure.",
            "Anomaly detection identifies statistical outliers relative to calibration baseline, not physical failure mechanisms.",
            "Time-series forecast uses autoregressive extrapolation and accuracy degrades over longer horizons.",
            "Model validation metrics are from held-out records of the training dataset, not independent field validation."
        ]
    }

@app.get("/telemetry/{node_id}/forecast")
def get_telemetry_forecast(node_id: str, parameter: str, horizon: int = 10, db: Session = Depends(get_db)):
    param_map = {
        'Distance': 'distance_mm',
        'Tilt': 'tilt_x',
        'Soil': 'soil_moisture_percent',
        'Battery': 'battery_v',
        'RSSI': 'lora_rssi'
    }
    db_col = param_map.get(parameter)
    if not db_col:
        raise HTTPException(status_code=400, detail="Invalid parameter")
        
    records = db.query(models.Telemetry).filter(
        models.Telemetry.node_id == node_id
    ).order_by(models.Telemetry.timestamp.asc()).limit(500).all()
    
    if len(records) < 30:
        return {"error": "INSUFFICIENT HISTORY FOR FORECAST"}
        
    history = []
    for r in records:
        history.append({
            'timestamp': r.timestamp.isoformat(),
            'distance_mm': float(r.distance_mm),
            'tilt_x': float(r.tilt_x),
            'soil_moisture_percent': float(r.soil_moisture_percent),
            'battery_v': float(r.battery_v),
            'lora_rssi': float(r.lora_rssi)
        })
        
    result = ml_engine.generate_forecast(history, db_col, horizon)
    return result


