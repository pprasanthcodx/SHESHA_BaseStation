# SHESHA: AI-Enabled Mine Subsidence & Early Warning System

**Smart India Hackathon 2026 Submission** 
**Problem Statement ID:** SIH26025 | **Theme:** IoT based Technologies | **Category:** Hardware

SHESHA is a fully autonomous, battery-powered outdoor IoT mesh network designed to predict and detect ground subsidence and sinkholes in mining and civil sectors. By transmitting structural telemetry via LoRa to an offline AI Command Center, SHESHA replaces fragile wired systems and manual checks with a highly scalable, real-time predictive alert system that requires zero existing cellular or Wi-Fi infrastructure.

## Key Features

* **100% Offline AI Pipeline:** Runs a localized Scikit-Learn Isolation Forest machine learning model to detect multivariate anomalies across soil, tilt, and structural gap metrics.
* **Robust Hardware Override:** Features a built-in 5-second sustained impact threshold filter that instantly bypasses routine AI telemetry to trigger catastrophic evacuation alerts.
* **Advanced Anomaly Filtering:** Utilizes a 2-out-of-10 rolling window constraint and Median Absolute Deviation (MAD) dynamic thresholding to completely neutralize false positives from passing heavy machinery.
* **Proactive Rate-of-Closure Detection:** Tracks micro-gap compression in real-time (mm/hr), identifying slow structural drift before critical failure.
* **Guaranteed Data Integrity:** Calculates a CRC checksum at the edge on every ESP32 packet; the receiver instantly drops corrupted packets caused by environmental noise.
* **Hyper-Scalable & Cost-Effective:** Deploys off-the-shelf components bringing the cost to roughly ₹3,000–₹5,000 per node.

## Architecture & Technology Stack

### Hardware (Edge Nodes)
* **Microcontroller:** ESP32 (Dual-core, low power)
* **Structural Sensors:** MPU6050 (6-axis IMU for structural tilt/vibrations), VL53L0X (ToF laser sensor for micro-gap compression/surface cracks)
* **Environmental Sensors:** Analog soil moisture probes
* **Communication:** LoRa SX1278 transceiver module (433MHz band for deep terrain penetration)
* **Power Management:** Solar power integration with deep-sleep cycling

### Software (Gateway & Command Center)
* **Firmware:** C++ (Arduino Framework)
* **Data Ingestion:** Python 3, PySerial, Pandas (`logger.py` for CSV logging)
* **Dashboard & UI:** Streamlit (`app.py` for Enterprise Command Center)
* **Machine Learning:** Scikit-Learn (Isolation Forest, Linear Regression, StandardScaler)

## Repository Structure

```text
SHESHA_BaseStation/
│
├── app.py                                          # Main Streamlit AI Command Center dashboard
├── logger.py                                       # Python serial ingestion and CRC validation script
├── shesha_data.csv                                 # Local rolling database for live telemetry
├── assets/
│   └── logo.png                                    # Command center UI assets
├── sheshafinaltransmitter/
│   └── sheshafinaltransmitter.ino                  # ESP32 Edge Node C++ firmware
└── shesha_final_receivercode/
    └── shesha_final_receivercode.ino               # Gateway Receiver C++ firmware
