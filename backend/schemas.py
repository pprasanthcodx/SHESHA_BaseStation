from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional

class TelemetryBase(BaseModel):
    distance_mm: float
    tilt_x: float
    tilt_y: float
    accel_z: float
    soil_moisture_percent: float
    battery_v: float
    lora_rssi: float

class TelemetryCreate(TelemetryBase):
    node_id: str
    timestamp: Optional[datetime] = None

class Telemetry(TelemetryBase):
    id: int
    node_id: str
    timestamp: datetime

    class Config:
        from_attributes = True

class NodeBase(BaseModel):
    id: str
    name: str
    location: Optional[str] = None
    cohesion: float = 15.0
    phi: float = 20.0
    unit_weight: float = 18.0
    bench_height: float = 10.0
    slope_angle: float = 45.0
    natural_moisture: float = 10.0

class NodeCreate(NodeBase):
    pass

class NodeUpdate(BaseModel):
    cohesion: Optional[float] = None
    phi: Optional[float] = None
    unit_weight: Optional[float] = None
    bench_height: Optional[float] = None
    slope_angle: Optional[float] = None
    natural_moisture: Optional[float] = None

class Node(NodeBase):
    class Config:
        from_attributes = True

class RiskEventBase(BaseModel):
    state: str
    reasons: str
    fos_value: Optional[float]

class RiskEvent(RiskEventBase):
    id: int
    node_id: str
    timestamp: datetime

    class Config:
        from_attributes = True
