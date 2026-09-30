import type { LiveTelemetryPayload } from './types';

export const generateDemoData = () => {
  const liveData: Record<string, LiveTelemetryPayload> = {};
  const historyData: Record<string, LiveTelemetryPayload[]> = {};
  
  const nodes = [
    { id: 'NODE-01', state: 'STABLE', fos: 1.6 },
    { id: 'NODE-02', state: 'WATCH', fos: 1.3 },
    { id: 'NODE-03', state: 'CRITICAL', fos: 0.8 },
  ];

  const now = Date.now();
  const points = 96; // 8 minutes at 1 point per 5 seconds
  
  for (const node of nodes) {
    const records: LiveTelemetryPayload[] = [];
    let baseDistance = node.id === 'NODE-01' ? 148.2 : node.id === 'NODE-02' ? 234.1 : 445.3;
    let baseTilt = node.id === 'NODE-01' ? 0.09 : node.id === 'NODE-02' ? 1.31 : 6.12;
    
    for (let i = 0; i < points; i++) {
      const timestamp = new Date(now - (points - 1 - i) * 5000).toISOString();
      const noise = (Math.random() - 0.5) * 2;
      
      if (node.id === 'NODE-02') {
        baseDistance += 0.2; // gradual rise
        baseTilt += 0.01;
      }
      if (node.id === 'NODE-03') {
        baseDistance += 1.5; // sharp rise
        baseTilt += 0.08;
      }
      
      const record: LiveTelemetryPayload = {
        type: "LIVE_TELEMETRY",
        telemetry: {
          timestamp,
          node_id: node.id,
          distance: baseDistance + noise,
          tilt: baseTilt + (noise * 0.05),
          soil: 32 + (noise * 2),
          battery: 4.1 - (i * 0.001),
          rssi: -70 + noise,
          trigger: false
        },
        risk: {
          level: node.state as any,
          fos: node.fos,
          anomaly_persistence: node.state === 'CRITICAL' ? 3 : node.state === 'WATCH' ? 1 : 0,
          persistence_threshold: 3,
          is_anomalous: node.state === 'CRITICAL' || (node.state === 'WATCH' && i % 3 === 0),
          model_status: "CALIBRATED",
          reasons: node.state === 'STABLE' ? ["Stable baseline"] : [`Predicted stability margin (FOS ${node.fos}) is abnormal.`],
          affected_params: node.state === 'STABLE' ? [] : [
            {
              parameter: "Distance",
              current: baseDistance + noise,
              baseline_mean: node.id === 'NODE-02' ? 230 : 430,
              deviation: (baseDistance + noise) - (node.id === 'NODE-02' ? 230 : 430),
              z_score: 3.1
            }
          ]
        }
      };
      records.push(record);
    }
    
    historyData[node.id] = records;
    liveData[node.id] = records[records.length - 1];
  }
  
  return { liveData, historyData };
};

export const getDemoHistoryPage = (nodeId: string, limit: number, offset: number) => {
  const { historyData } = generateDemoData();
  const records = historyData[nodeId] || [];
  
  return {
    total: records.length,
    offset,
    limit,
    records: records.slice(offset, offset + limit).map((r, i) => ({
      id: 'demo-' + i,
      timestamp: r.telemetry.timestamp,
      distance_mm: r.telemetry.distance,
      tilt_x: r.telemetry.tilt,
      tilt_y: 0,
      accel_z: 9.8,
      soil_moisture_percent: r.telemetry.soil,
      battery_v: r.telemetry.battery,
      lora_rssi: r.telemetry.rssi
    }))
  };
};

export const getDemoRiskEvents = (nodeId: string) => {
  const { historyData } = generateDemoData();
  const records = historyData[nodeId] || [];
  // return risk events for any record with is_anomalous
  const events = records.filter(r => r.risk.is_anomalous).map((r, i) => ({
    id: 'event-' + i,
    timestamp: r.telemetry.timestamp,
    state: r.risk.level,
    reasons: r.risk.reasons,
    fos_value: r.risk.fos || 1.5
  }));
  return events.reverse().slice(0, 20); // most recent
};


export const getDemoNodesStatus = () => {
  const { liveData } = generateDemoData();
  return Object.values(liveData).map(ld => ({
    id: ld.telemetry.node_id,
    name: ld.telemetry.node_id,
    location: "Surface Monitoring",
    battery: ld.telemetry.battery,
    rssi: ld.telemetry.rssi,
    distance: ld.telemetry.distance,
    tilt_x: ld.telemetry.tilt,
    soil: ld.telemetry.soil,
    last_seen: ld.telemetry.timestamp,
    risk_state: ld.risk.level,
    fos: ld.risk.fos,
    is_online: true,
    geotechnical: { cohesion: 50, phi: 30, unit_weight: 20, bench_height: 10, slope_angle: 45, natural_moisture: 10 }
  }));
};

export const getDemoModelInfo = () => ({
  metrics: { mae: 0.12, rmse: 0.15, r2: 0.89 },
  limitations: ["DEMO MODE: Simulated metrics", "FOS is a modeled estimate"],
  fos_model: {
    features: ["cohesion", "phi", "unit_weight", "bench_height", "slope_angle", "natural_moisture"],
    target: "fos",
    description: "Geotechnical Simulation"
  }
});



export const getDemoNodeDetail = (nodeId: string) => {
  const status = getDemoNodesStatus().find(n => n.id === nodeId);
  return status || null;
};

export const getDemoForecast = (nodeId: string, paramKey: string) => {
  const { liveData } = generateDemoData();
  const ld = liveData[nodeId];
  const currentVal = ld ? Number((ld.telemetry as any)[paramKey]) || 0 : 0;
  return {
    forecast: Array.from({length: 10}).map((_, i) => ({
      timestamp: new Date(Date.now() + (i + 1) * 5000).toISOString(),
      forecast_value: currentVal,
      lower_bound: currentVal - (Math.abs(currentVal) * 0.05),
      upper_bound: currentVal + (Math.abs(currentVal) * 0.05)
    })),
    trend_direction: "stable"
  };
};


