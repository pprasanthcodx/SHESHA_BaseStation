import { API_BASE_URL, DEMO_MODE } from './config';
import React, { useEffect, useState } from 'react';
import { Activity, Battery, BatteryWarning, Signal, } from 'lucide-react';

interface GeotechnicalParams {
  cohesion: number;
  phi: number;
  unit_weight: number;
  bench_height: number;
  slope_angle: number;
  natural_moisture: number;
}

interface NodeStatus {
  id: string;
  name: string;
  battery: number;
  rssi: number;
  distance: number;
  tilt_x: number;
  soil: number;
  last_seen: string;
  risk_state: "STABLE" | "WATCH" | "CRITICAL" | "CALIBRATING";
  fos: number | null;
  is_online: boolean;
  geotechnical: GeotechnicalParams;
}

export const NodesPage: React.FC = () => {
  const [nodes, setNodes] = useState<NodeStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchNodes = async () => {
      if (DEMO_MODE) {
        import('./demoData').then(({ getDemoNodesStatus }) => {
          setNodes(getDemoNodesStatus());
          setError(null);
        }).finally(() => setLoading(false));
        return;
      }
      try {
        const response = await fetch(`${API_BASE_URL}/nodes/status`);
        if (!response.ok) throw new Error('Failed to fetch nodes');
        const data = await response.json();
        setNodes(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchNodes();
    const interval = setInterval(fetchNodes, 10000);
    return () => clearInterval(interval);
  }, []);

  const getRiskColor = (state: string) => {
    switch (state) {
      case 'STABLE': return 'bg-status-stable text-white';
      case 'WATCH': return 'bg-status-watch text-white';
      case 'CRITICAL': return 'bg-status-critical text-white';
      case 'CALIBRATING': return 'bg-telemetry-blue text-white';
      default: return 'bg-surface text-text-secondary';
    }
  };

  if (loading) return <div className="p-6 text-text-secondary">Loading nodes...</div>;
  if (error) return <div className="p-6 text-status-critical">Error: {error}</div>;

  return (
    <div className="p-6 animate-mount">
      <h1 className="text-2xl font-bold text-text-main mb-6 flex items-center gap-2">
        <Activity className="w-6 h-6 text-brand-gold" />
        Node Status Overview
      </h1>
      
      {nodes.length === 0 ? (
        <div className="text-center p-12 bg-surface rounded-lg border border-elevated">
          <p className="text-text-secondary">No nodes detected.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {nodes.map(node => (
            <div key={node.id} className="bg-surface rounded-lg border border-elevated p-5 shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-text-main flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${node.is_online ? 'bg-status-stable' : 'bg-status-critical'}`} />
                    {node.name}
                    <span className="text-xs text-text-secondary font-mono">({node.id})</span>
                  </h3>
                  <p className="text-xs text-text-secondary mt-1">Last seen: {new Date(node.last_seen).toLocaleString()}</p>
                </div>
                <div className={`px-2 py-1 rounded text-xs font-bold ${getRiskColor(node.risk_state)}`}>
                  {node.risk_state}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-elevated p-3 rounded-md">
                  <div className="text-xs text-text-secondary mb-1">Distance</div>
                  <div className="font-mono text-text-main">{node.distance.toFixed(2)} mm</div>
                </div>
                <div className="bg-elevated p-3 rounded-md">
                  <div className="text-xs text-text-secondary mb-1">Tilt X</div>
                  <div className="font-mono text-text-main">{node.tilt_x.toFixed(2)}°</div>
                </div>
                <div className="bg-elevated p-3 rounded-md">
                  <div className="text-xs text-text-secondary mb-1">Soil Moisture</div>
                  <div className="font-mono text-text-main">{node.soil.toFixed(1)}%</div>
                </div>
                <div className="bg-elevated p-3 rounded-md">
                  <div className="text-xs text-text-secondary mb-1">FOS</div>
                  <div className="font-mono text-text-main">{node.fos !== null ? node.fos.toFixed(2) : 'N/A'}</div>
                </div>
              </div>

              <div className="flex justify-between items-center text-sm border-t border-elevated pt-4">
                <div className="flex items-center gap-2 text-text-secondary">
                  {node.battery < 3.5 ? <BatteryWarning className="w-4 h-4 text-status-critical" /> : <Battery className="w-4 h-4" />}
                  <span className={`font-mono ${node.battery < 3.5 ? 'text-status-critical' : ''}`}>{node.battery.toFixed(2)}V</span>
                </div>
                <div className="flex items-center gap-2 text-text-secondary">
                  <Signal className="w-4 h-4" />
                  <span className="font-mono">{node.rssi} dBm</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
export default NodesPage;



