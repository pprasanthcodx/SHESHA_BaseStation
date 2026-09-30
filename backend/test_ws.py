import asyncio
import websockets
import json

async def listen():
    uri = "ws://127.0.0.1:8001/ws/live"
    try:
        async with websockets.connect(uri) as websocket:
            print(f"Connected to {uri}")
            print("Waiting for telemetry packet...")
            response = await websocket.recv()
            data = json.loads(response)
            print("\n--- RECEIVED LIVE TELEMETRY PACKET ---")
            print(json.dumps(data, indent=2))
            print("--------------------------------------\n")
            print("Test successful. Exiting.")
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    asyncio.run(listen())

