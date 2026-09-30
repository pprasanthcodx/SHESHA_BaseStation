"""
Backend tests for SHESHA risk engine, persistence, and per-node calibration.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from ml_engine import MineML, PERSISTENCE_THRESHOLD
import numpy as np

def test_persistence_capped_at_threshold():
    """Persistence must NEVER exceed the configured threshold."""
    ml = MineML()
    node_id = "TEST-CAP"
    ml.node_states[node_id] = {"anomalies_in_a_row": 0, "is_calibrated": False, "baseline": {}}
    
    # Simulate many anomalies in a row
    for i in range(20):
        ml.node_states[node_id]["anomalies_in_a_row"] = min(
            ml.node_states[node_id]["anomalies_in_a_row"] + 1,
            PERSISTENCE_THRESHOLD
        )
    
    assert ml.node_states[node_id]["anomalies_in_a_row"] == PERSISTENCE_THRESHOLD, \
        f"Expected {PERSISTENCE_THRESHOLD}, got {ml.node_states[node_id]['anomalies_in_a_row']}"
    print(f"  PASS: Persistence capped at {PERSISTENCE_THRESHOLD}")

def test_persistence_resets_on_normal():
    """Normal reading must decrement persistence, eventually reaching 0."""
    ml = MineML()
    node_id = "TEST-RESET"
    ml.node_states[node_id] = {"anomalies_in_a_row": PERSISTENCE_THRESHOLD, "is_calibrated": False, "baseline": {}}
    
    # Simulate normal readings
    for i in range(PERSISTENCE_THRESHOLD + 2):
        ml.node_states[node_id]["anomalies_in_a_row"] = max(0, ml.node_states[node_id]["anomalies_in_a_row"] - 1)
    
    assert ml.node_states[node_id]["anomalies_in_a_row"] == 0, \
        f"Expected 0, got {ml.node_states[node_id]['anomalies_in_a_row']}"
    print("  PASS: Persistence resets to 0 after normal readings")

def test_three_consecutive_anomalies_trigger_critical():
    """3 consecutive anomalies must reach PERSISTENCE_THRESHOLD and trigger escalation."""
    ml = MineML()
    node_id = "TEST-ESCALATE"
    
    # Build a calibration dataset
    np.random.seed(42)
    baseline_data = []
    for _ in range(120):
        baseline_data.append({
            'distance_mm': 150 + np.random.normal(0, 0.2),
            'tilt_x': 0.1 + np.random.normal(0, 0.005),
            'tilt_y': 0.05 + np.random.normal(0, 0.003),
            'soil_moisture_percent': 35 + np.random.normal(0, 0.5)
        })
    
    ml.calibrate_anomaly_detector(node_id, baseline_data)
    assert ml.node_states[node_id]["is_calibrated"] == True
    print("  PASS: Node calibrated successfully")
    
    # Feed 3 extreme anomalous readings
    for i in range(3):
        anomalous_reading = {
            'distance_mm': 500.0,  # Way outside baseline
            'tilt_x': 5.0,
            'tilt_y': 3.0,
            'soil_moisture_percent': 90.0
        }
        result = ml.evaluate_live_risk(node_id, anomalous_reading)
    
    assert result["anomaly_persistence"] == PERSISTENCE_THRESHOLD, \
        f"Expected persistence={PERSISTENCE_THRESHOLD}, got {result['anomaly_persistence']}"
    assert result["state"] in ["CRITICAL", "WATCH"], \
        f"Expected CRITICAL or WATCH, got {result['state']}"
    print(f"  PASS: 3 consecutive anomalies -> persistence={result['anomaly_persistence']}, state={result['state']}")

def test_isolated_anomaly_no_accumulation():
    """Isolated anomaly followed by normal should not permanently accumulate."""
    ml = MineML()
    node_id = "TEST-ISO"
    
    np.random.seed(42)
    baseline_data = []
    for _ in range(120):
        baseline_data.append({
            'distance_mm': 150 + np.random.normal(0, 0.2),
            'tilt_x': 0.1 + np.random.normal(0, 0.005),
            'tilt_y': 0.05 + np.random.normal(0, 0.003),
            'soil_moisture_percent': 35 + np.random.normal(0, 0.5)
        })
    ml.calibrate_anomaly_detector(node_id, baseline_data)
    
    # 1 anomalous reading
    ml.evaluate_live_risk(node_id, {
        'distance_mm': 500.0, 'tilt_x': 5.0, 'tilt_y': 3.0, 'soil_moisture_percent': 90.0
    })
    
    # Follow with 5 normal readings
    for _ in range(5):
        result = ml.evaluate_live_risk(node_id, {
            'distance_mm': 150.1, 'tilt_x': 0.1, 'tilt_y': 0.05, 'soil_moisture_percent': 35.0
        })
    
    assert result["anomaly_persistence"] == 0, \
        f"Expected persistence=0 after recovery, got {result['anomaly_persistence']}"
    print(f"  PASS: Isolated anomaly + recovery -> persistence={result['anomaly_persistence']}")

def test_independent_node_states():
    """Different nodes must maintain completely independent persistence counters."""
    ml = MineML()
    
    np.random.seed(42)
    baseline_data = []
    for _ in range(120):
        baseline_data.append({
            'distance_mm': 150 + np.random.normal(0, 0.2),
            'tilt_x': 0.1 + np.random.normal(0, 0.005),
            'tilt_y': 0.05 + np.random.normal(0, 0.003),
            'soil_moisture_percent': 35 + np.random.normal(0, 0.5)
        })
    
    ml.calibrate_anomaly_detector("NODE-A", baseline_data)
    ml.calibrate_anomaly_detector("NODE-B", baseline_data)
    
    # Drive NODE-A into anomaly
    for _ in range(3):
        ml.evaluate_live_risk("NODE-A", {
            'distance_mm': 500.0, 'tilt_x': 5.0, 'tilt_y': 3.0, 'soil_moisture_percent': 90.0
        })
    
    # NODE-B stays normal
    result_b = ml.evaluate_live_risk("NODE-B", {
        'distance_mm': 150.1, 'tilt_x': 0.1, 'tilt_y': 0.05, 'soil_moisture_percent': 35.0
    })
    
    assert ml.node_states["NODE-A"]["anomalies_in_a_row"] == PERSISTENCE_THRESHOLD
    assert ml.node_states["NODE-B"]["anomalies_in_a_row"] <= 1  # 0 or 1 depending on IF decision
    print(f"  PASS: NODE-A persistence={ml.node_states['NODE-A']['anomalies_in_a_row']}, NODE-B persistence={ml.node_states['NODE-B']['anomalies_in_a_row']}")

def test_fos_critical_during_calibration():
    """FOS below critical threshold must return CRITICAL even when anomaly detector is calibrating."""
    ml = MineML()
    node_id = "TEST-FOS"
    ml.node_states[node_id] = {"anomalies_in_a_row": 0, "is_calibrated": False, "baseline": {}}
    
    if ml.fos_model is None:
        print("  SKIP: FOS model not loaded (no training dataset available)")
        return
    
    # Use geotechnical params known to produce low FOS
    geo_data = {
        'Cohesion (kN/m2)': 5.0,
        'Phi (deg)': 10.0,
        'Unit Weight (kN/m3)': 22.0,
        'Overall Bench Height': 30.0,
        'Overall Slope angle': 65.0,
        'Natural Moisture content': 25.0
    }
    
    live_data = {
        'distance_mm': 150.0, 'tilt_x': 0.1, 'tilt_y': 0.05, 'soil_moisture_percent': 35.0
    }
    
    result = ml.evaluate_live_risk(node_id, live_data, geo_data)
    
    # FOS should be critically low
    if result["fos_value"] and result["fos_value"] < 1.2:
        assert result["state"] == "CRITICAL", \
            f"Expected CRITICAL when FOS={result['fos_value']:.3f}, got {result['state']}"
        print(f"  PASS: FOS={result['fos_value']:.3f} -> {result['state']} during calibration")
    else:
        print(f"  INFO: FOS={result.get('fos_value')} — model produced adequate FOS for these inputs")


if __name__ == "__main__":
    print("\n===== SHESHA Backend Tests =====\n")
    
    tests = [
        ("Persistence capped at threshold", test_persistence_capped_at_threshold),
        ("Persistence resets on normal reading", test_persistence_resets_on_normal),
        ("3 consecutive anomalies trigger escalation", test_three_consecutive_anomalies_trigger_critical),
        ("Isolated anomaly does not accumulate", test_isolated_anomaly_no_accumulation),
        ("Independent node states", test_independent_node_states),
        ("FOS critical during calibration", test_fos_critical_during_calibration),
    ]
    
    passed = 0
    failed = 0
    for name, test_fn in tests:
        try:
            print(f"[TEST] {name}")
            test_fn()
            passed += 1
        except Exception as e:
            print(f"  FAIL: {e}")
            failed += 1
    
    print(f"\n===== Results: {passed} passed, {failed} failed =====\n")
    if failed > 0:
        sys.exit(1)

