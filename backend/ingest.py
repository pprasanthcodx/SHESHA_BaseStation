import pandas as pd
import argparse
import requests

API_URL = "http://127.0.0.1:8001"

def ingest_csv(file_path: str):
    print(f"Reading CSV from {file_path}...")
    try:
        df = pd.read_csv(file_path)
    except Exception as e:
        print(f"Error reading CSV: {e}")
        return

    # Ensure timestamp is parsed correctly and sorted
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.sort_values('timestamp').reset_index(drop=True)

    # Extract unique nodes and ensure they exist via API
    if 'node_id' in df.columns:
        unique_nodes = df['node_id'].unique()
        for node_id in unique_nodes:
            payload = {
                "id": str(node_id),
                "name": f"Node {node_id}",
                "location": "Unknown"
            }
            res = requests.post(f"{API_URL}/nodes/", json=payload)
            if res.status_code == 200:
                print(f"Verified/Created node: {node_id}")

    print(f"Bulk loading {len(df)} records instantly...")
    
    session = requests.Session()
    
    added = 0
    for _, row in df.iterrows():
        payload = {
            "distance_mm": float(row['distance_mm']),
            "tilt_x": float(row['tilt_x']),
            "tilt_y": float(row['tilt_y']),
            "accel_z": float(row['accel_z']),
            "soil_moisture_percent": float(row['soil_moisture_percent']),
            "battery_v": float(row['battery_v']),
            "lora_rssi": float(row['lora_rssi']),
            "node_id": str(row['node_id']),
            "timestamp": row['timestamp'].isoformat()
        }
        try:
            res = session.post(f"{API_URL}/telemetry/", json=payload)
            if res.status_code == 200:
                added += 1
        except Exception as e:
            print(f"Error posting row: {e}")

    print(f"Successfully bulk ingested {added} telemetry records. Exiting.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Instantly ingest a small telemetry CSV via FastAPI")
    parser.add_argument("csv_file", help="Path to the CSV file")
    args = parser.parse_args()
    
    ingest_csv(args.csv_file)
