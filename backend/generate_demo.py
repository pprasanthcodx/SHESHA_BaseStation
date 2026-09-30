"""
SHESHA Deterministic Demo Telemetry Generator

Generates realistic, independent sensor patterns for 3 mine monitoring nodes.
Each node has a distinct behavioral scenario for SIH demonstration.

NODE-01: Stable baseline — normal sensor behavior with minor fluctuations.
NODE-02: Developing displacement — gradual distance/tilt drift emerging into WATCH.
NODE-03: Active instability — significant anomaly period causing CRITICAL escalation.

Sensors are INDEPENDENT — they do NOT follow synchronized patterns.
Random seed is fixed for repeatable demo.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta

def generate_demo_dataset(filename="sample_data.csv"):
    np.random.seed(42)
    
    nodes = ['NODE-01', 'NODE-02', 'NODE-03']
    records = []
    num_readings = 400  # per node
    start_time = datetime(2026, 9, 29, 0, 0, 0)  # Fixed absolute start
    
    for node in nodes:
        # ----- NODE-01: Stable baseline -----
        if node == 'NODE-01':
            dist = 150.0
            tilt_x = 0.08
            tilt_y = 0.04
            soil = 32.0
            battery = 4.18
            rssi = -68.0
            
            for i in range(num_readings):
                # Small Gaussian noise — no trend
                dist += np.random.normal(0.0, 0.15)
                tilt_x += np.random.normal(0.0, 0.003)
                tilt_y += np.random.normal(0.0, 0.002)
                # Soil moisture: slow diurnal-like variation
                soil = 32.0 + 3.0 * np.sin(2 * np.pi * i / 200) + np.random.normal(0, 0.3)
                soil = np.clip(soil, 15, 50)
                # Battery: slow linear drain
                battery -= np.random.uniform(0.0002, 0.0005)
                # RSSI: independent noisy signal
                rssi = -68.0 + np.random.normal(0, 2.5)
                rssi = np.clip(rssi, -95, -55)
                
                trigger = False
                ts = start_time + timedelta(minutes=i * 1.8)  # ~108 sec intervals
                
                records.append(_make_record(ts, node, dist, tilt_x, tilt_y, soil, battery, rssi, trigger))
        
        # ----- NODE-02: Developing displacement -----
        elif node == 'NODE-02':
            dist = 195.0
            tilt_x = 0.15
            tilt_y = 0.08
            soil = 38.0
            battery = 4.05
            rssi = -75.0
            
            for i in range(num_readings):
                # Phase 1 (0-250): stable with slight upward drift
                if i < 250:
                    dist += np.random.normal(0.02, 0.12)
                    tilt_x += np.random.normal(0.0005, 0.003)
                # Phase 2 (250-350): gradual acceleration — emerging anomaly
                elif i < 350:
                    progress = (i - 250) / 100.0
                    dist += np.random.normal(0.15 + 0.3 * progress, 0.2)
                    tilt_x += np.random.normal(0.005 + 0.01 * progress, 0.005)
                # Phase 3 (350-400): stabilizing at elevated level
                else:
                    dist += np.random.normal(0.05, 0.15)
                    tilt_x += np.random.normal(0.001, 0.004)
                
                tilt_y += np.random.normal(0.0002, 0.002)
                soil = 38.0 + 2.0 * np.sin(2 * np.pi * i / 300 + 1.0) + np.random.normal(0, 0.4)
                soil = np.clip(soil, 15, 50)
                battery -= np.random.uniform(0.0003, 0.0006)
                rssi = -75.0 + np.random.normal(0, 3.0)
                rssi = np.clip(rssi, -98, -55)
                
                trigger = (250 <= i < 350)
                ts = start_time + timedelta(minutes=i * 1.8 + 0.3)  # slight offset
                
                records.append(_make_record(ts, node, dist, tilt_x, tilt_y, soil, battery, rssi, trigger))
        
        # ----- NODE-03: Active instability -----
        elif node == 'NODE-03':
            dist = 288.0
            tilt_x = 0.6
            tilt_y = 0.3
            soil = 42.0
            battery = 3.92
            rssi = -82.0
            
            for i in range(num_readings):
                # Phase 1 (0-150): baseline — slightly noisy
                if i < 150:
                    dist += np.random.normal(0.03, 0.18)
                    tilt_x += np.random.normal(0.001, 0.004)
                # Phase 2 (150-220): accelerating movement — clear anomaly
                elif i < 220:
                    progress = (i - 150) / 70.0
                    dist += np.random.normal(0.5 + 1.5 * progress, 0.5)
                    tilt_x += np.random.normal(0.02 + 0.04 * progress, 0.01)
                # Phase 3 (220-300): sustained high instability
                elif i < 300:
                    dist += np.random.normal(0.8, 0.6)
                    tilt_x += np.random.normal(0.03, 0.015)
                # Phase 4 (300-400): partial recovery / new equilibrium
                else:
                    dist += np.random.normal(0.1, 0.25)
                    tilt_x += np.random.normal(0.002, 0.005)
                
                tilt_y += np.random.normal(0.001, 0.003)
                # Soil moisture independent — rising during instability period
                if 150 <= i < 300:
                    soil += np.random.normal(0.05, 0.3)
                else:
                    soil += np.random.normal(-0.02, 0.3)
                soil = np.clip(soil, 20, 55)
                battery -= np.random.uniform(0.0004, 0.0008)
                rssi = -82.0 + np.random.normal(0, 3.5)
                rssi = np.clip(rssi, -99, -60)
                
                trigger = (150 <= i < 300)
                ts = start_time + timedelta(minutes=i * 1.8 + 0.6)  # different offset
                
                records.append(_make_record(ts, node, dist, tilt_x, tilt_y, soil, battery, rssi, trigger))
    
    df = pd.DataFrame(records)
    df = df.sort_values('timestamp')
    df.to_csv(filename, index=False)
    print(f"Generated {len(df)} records in {filename}")
    for n in nodes:
        count = len(df[df['node_id'] == n])
        print(f"  {n}: {count} readings")
    return df


def _make_record(ts, node, dist, tilt_x, tilt_y, soil, battery, rssi, trigger):
    """Create a single telemetry record with physically consistent accelerometer data."""
    import math
    # Ensure physical bounds
    dist = max(0, dist)
    battery = max(3.0, battery)
    
    # Compute accel_z from tilt angles (gravity projection)
    # tilt_x and tilt_y are in radians-like units
    accel_z = 9.81 * math.cos(math.sqrt(tilt_x**2 + tilt_y**2))
    
    return {
        'timestamp': ts.isoformat(),
        'node_id': node,
        'distance_mm': round(dist, 4),
        'tilt_x': round(tilt_x, 6),
        'tilt_y': round(tilt_y, 6),
        'accel_z': round(accel_z, 4),
        'soil_moisture_percent': round(soil, 2),
        'battery_v': round(battery, 4),
        'lora_rssi': round(rssi, 2),
        'trigger': trigger,
        'is_demo': True
    }


if __name__ == "__main__":
    generate_demo_dataset()
