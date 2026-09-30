from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
import datetime

from database import Base

class Node(Base):
    __tablename__ = "nodes"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, index=True)
    location = Column(String)
    
    # Static geotechnical baseline
    cohesion = Column(Float, default=15.0)
    phi = Column(Float, default=20.0)
    unit_weight = Column(Float, default=18.0)
    bench_height = Column(Float, default=10.0)
    slope_angle = Column(Float, default=45.0)
    natural_moisture = Column(Float, default=10.0)
    
    telemetry = relationship("Telemetry", back_populates="node")
    risk_events = relationship("RiskEvent", back_populates="node")

class RiskEvent(Base):
    __tablename__ = "risk_events"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    node_id = Column(String, ForeignKey("nodes.id"))
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    state = Column(String) # STABLE, WATCH, CRITICAL, CALIBRATING
    reasons = Column(String)
    fos_value = Column(Float, nullable=True)
    
    node = relationship("Node", back_populates="risk_events")

class Telemetry(Base):
    __tablename__ = "telemetry"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    node_id = Column(String, ForeignKey("nodes.id"))
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    
    # Sensors
    distance_mm = Column(Float)
    tilt_x = Column(Float)
    tilt_y = Column(Float)
    accel_z = Column(Float)
    soil_moisture_percent = Column(Float)
    battery_v = Column(Float)
    lora_rssi = Column(Float)
    
    node = relationship("Node", back_populates="telemetry")
