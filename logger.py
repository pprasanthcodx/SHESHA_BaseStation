#!/usr/bin/env python3
"""SHESHA Serial Logger — reads LoRa receiver packets over serial and logs them to CSV."""

from __future__ import annotations

import argparse
import csv
import logging
import sys
import time
from dataclasses import dataclass, fields
from datetime import datetime
from pathlib import Path
from typing import Optional

import serial

HEADERS = [
    "Timestamp", "Node_ID", "Trigger", "Distance", "Tilt",
    "Soil", "Battery", "Seq", "CRC", "RSSI",
]

log = logging.getLogger("shesha_logger")


@dataclass
class Packet:
    node_id: str
    trigger: str
    distance: str
    tilt: str
    soil: str
    battery: str
    seq: str
    crc: str
    rssi: str

    @classmethod
    def from_line(cls, line: str) -> Optional["Packet"]:
        parts = line.split(",")
        if len(parts) != len(fields(cls)):
            return None
        return cls(*parts)

    def as_row(self, timestamp: str) -> list[str]:
        return [timestamp, self.node_id, self.trigger, self.distance,
                self.tilt, self.soil, self.battery, self.seq, self.crc, self.rssi]


class CsvLogger:
    """Keeps the CSV file open and flushes after every write for durability."""

    def __init__(self, path: Path):
        self.path = path
        is_new = not path.exists()
        self._file = path.open("a", newline="", encoding="utf-8")
        self._writer = csv.writer(self._file)
        if is_new:
            self._writer.writerow(HEADERS)
            self._file.flush()
            log.info("Created new log file: %s", path)

    def log_row(self, row: list[str]) -> None:
        self._writer.writerow(row)
        self._file.flush()

    def close(self) -> None:
        self._file.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SHESHA Serial Logger")
    parser.add_argument("--port", required=True, help="COM port of the receiver (e.g. COM4, /dev/ttyUSB0)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate")
    parser.add_argument("--output", type=Path, default=Path("shesha_data.csv"), help="CSV output file")
    parser.add_argument("--reconnect-delay", type=float, default=3.0,
                         help="Seconds to wait before retrying a dropped connection")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    return parser.parse_args()


def read_loop(ser: serial.Serial, csv_logger: CsvLogger) -> None:
    log.info("Waiting for LoRa data...")
    while True:
        raw = ser.readline()
        if not raw:
            continue
        line = raw.decode("utf-8", errors="ignore").strip()
        if not line:
            continue

        if line.startswith("---") or "RX_WARNING" in line or "NODE_01" not in line:
            log.info("System: %s", line)
            continue

        packet = Packet.from_line(line)
        if packet is None:
            log.warning("Skipped malformed data: %s", line)
            continue

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        csv_logger.log_row(packet.as_row(timestamp))
        log.info("[%s] Logged -> %s", timestamp, line)


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )

    csv_logger = CsvLogger(args.output)

    try:
        while True:
            try:
                with serial.Serial(args.port, args.baud, timeout=1) as ser:
                    log.info("Connected to %s at %d baud.", args.port, args.baud)
                    read_loop(ser, csv_logger)
            except serial.SerialException as exc:
                log.error("Serial connection lost/unavailable on %s: %s", args.port, exc)
                log.info("Retrying in %.1fs (make sure no other program has the port open)...",
                         args.reconnect_delay)
                time.sleep(args.reconnect_delay)
    except KeyboardInterrupt:
        log.info("Logger stopped safely.")
    finally:
        csv_logger.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())