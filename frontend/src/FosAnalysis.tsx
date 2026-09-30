import { API_BASE_URL } from './config';
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Info, AlertTriangle, ShieldCheck, Database,  } from 'lucide-react';
import type { LiveTelemetryPayload } from './types';

interface FosAnalysisProps {
  currentData: LiveTelemetryPayload;
  onBack: () => void;
}

interface Geotechnical {
  cohesion: number;
  phi: number;
  unit_weight: number;
  bench_height: number;
  slope_angle: number;
  natural_moisture: number;
}

interface NodeData {
  id: string;
  name: string;
  geotechnical: Geotechnical;
}

interface ModelInfo {
  metrics: {
    mae: number;
    rmse: number;
    r2: number;
  };
  limitations: string[];
}

export const FosAnalysis: React.FC<FosAnalysisProps> = ({ currentData, onBack }) => {
  const [nodeData, setNodeData] = useState<NodeData | null>(null);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const nodeId = currentData.telemetry.node_id;
  const fos = currentData.risk.fos;
  const riskLevel = currentData.risk.level;

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [nodeRes, modelRes] = await Promise.all([
          fetch(`${API_BASE_URL}/nodes/${nodeId}`),
          fetch(`${API_BASE_URL}/model/info`)
        ]);

        if (!nodeRes.ok || !modelRes.ok) {
          throw new Error('Failed to fetch data');
        }

        const nodeJson = await nodeRes.json();
        const modelJson = await modelRes.json();

        setNodeData(nodeJson);
        setModelInfo(modelJson);
      } catch (err: any) {
        setError(err.message || 'An error occurred while fetching data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [nodeId]);

  const getRiskColor = (level: string) => {
    if (level === 'STABLE') return 'text-status-stable bg-status-stable/20 border-status-stable/30';
    if (level === 'WATCH') return 'text-status-watch bg-status-watch/20 border-status-watch/30';
    if (level === 'CRITICAL') return 'text-status-critical bg-status-critical/20 border-status-critical/30';
    return 'text-text-secondary bg-elevated border-text-secondary/30';
  };

  const getFosMarkerPosition = () => {
    if (fos === null) return 0;
    // Map 1.0 - 2.0 to 0 - 100%
    const min = 1.0;
    const max = 2.0;
    const clamped = Math.max(min, Math.min(max, fos));
    return ((clamped - min) / (max - min)) * 100;
  };

  if (loading) {
    return (
      <div className="flex-1 p-6 animate-mount flex items-center justify-center">
        <div className="text-text-secondary">Loading analysis data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 p-6 animate-mount flex items-center justify-center">
        <div className="text-status-critical">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 animate-mount space-y-6 overflow-y-auto">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="p-2 bg-surface hover:bg-elevated rounded-md border border-gray-800 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <h1 className="text-xl font-semibold text-text-main">
          Stability Intelligence - Node {nodeId}
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LARGE FOS GAUGE SECTION */}
        <div className="bg-surface border border-gray-800 rounded-lg p-6 space-y-6">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-lg font-medium text-text-main flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-brand-gold" />
                Predicted Factor of Safety (FOS)
              </h2>
            </div>
            <div className={`px-3 py-1 rounded border text-sm font-bold ${getRiskColor(riskLevel)}`}>
              {riskLevel}
            </div>
          </div>

          <div className="flex justify-center items-center py-4">
            <span className="text-6xl font-mono font-bold text-text-main">
              {fos !== null ? fos.toFixed(2) : '--'}
            </span>
          </div>

          <div className="relative pt-4 pb-2">
            <div className="h-4 flex rounded-full overflow-hidden bg-elevated">
              <div className="h-full bg-status-critical" style={{ width: '20%' }}></div> {/* < 1.2 */}
              <div className="h-full bg-status-watch" style={{ width: '30%' }}></div> {/* 1.2 - 1.5 */}
              <div className="h-full bg-status-stable" style={{ width: '50%' }}></div> {/* > 1.5 */}
            </div>
            
            {fos !== null && (
              <div 
                className="absolute top-2 w-0.5 h-8 bg-text-main -ml-[1px] transition-all duration-500"
                style={{ left: `${getFosMarkerPosition()}%` }}
              >
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-1 bg-elevated border border-gray-700 rounded text-xs font-mono">
                  {fos.toFixed(2)}
                </div>
              </div>
            )}
            
            <div className="flex justify-between text-xs text-text-secondary mt-2 font-mono">
              <span>1.0</span>
              <span className="ml-[10%]">1.2</span>
              <span className="mr-[35%]">1.5</span>
              <span>2.0+</span>
            </div>
          </div>

          <p className="text-sm text-text-secondary bg-elevated p-3 rounded-md border border-gray-800 flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-brand-gold" />
            <span>FOS is a theoretical stability margin estimated from the node's configured geotechnical conditions. Values below the configured critical threshold indicate insufficient modeled stability margin.</span>
          </p>
          
          <div className="text-sm font-medium text-text-main">
            {fos !== null && fos < 1.2 ? (
              <span className="text-status-critical">Lower FOS means less modeled resistance relative to driving forces. This node is currently below the configured critical threshold.</span>
            ) : fos !== null && fos < 1.5 ? (
              <span className="text-status-watch">Lower FOS means less modeled resistance relative to driving forces. This node is currently in the watch threshold.</span>
            ) : (
              <span className="text-status-stable">Lower FOS means less modeled resistance relative to driving forces. This node currently indicates a stable modeled margin.</span>
            )}
          </div>
        </div>

        {/* GEOTECHNICAL INPUTS */}
        <div className="bg-surface border border-gray-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-medium text-text-main flex items-center gap-2">
            <Database className="w-5 h-5 text-brand-gold" />
            Geotechnical Inputs
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-elevated p-4 rounded-md border border-gray-800">
              <div className="text-xs text-text-secondary uppercase tracking-wider mb-1">Cohesion</div>
              <div className="font-mono text-lg">{nodeData?.geotechnical?.cohesion ?? '--'} <span className="text-xs text-text-secondary">kN/m²</span></div>
            </div>
            <div className="bg-elevated p-4 rounded-md border border-gray-800">
              <div className="text-xs text-text-secondary uppercase tracking-wider mb-1">Friction Angle φ</div>
              <div className="font-mono text-lg">{nodeData?.geotechnical?.phi ?? '--'} <span className="text-xs text-text-secondary">°</span></div>
            </div>
            <div className="bg-elevated p-4 rounded-md border border-gray-800">
              <div className="text-xs text-text-secondary uppercase tracking-wider mb-1">Unit Weight</div>
              <div className="font-mono text-lg">{nodeData?.geotechnical?.unit_weight ?? '--'} <span className="text-xs text-text-secondary">kN/m³</span></div>
            </div>
            <div className="bg-elevated p-4 rounded-md border border-gray-800">
              <div className="text-xs text-text-secondary uppercase tracking-wider mb-1">Bench Height</div>
              <div className="font-mono text-lg">{nodeData?.geotechnical?.bench_height ?? '--'} <span className="text-xs text-text-secondary">m</span></div>
            </div>
            <div className="bg-elevated p-4 rounded-md border border-gray-800">
              <div className="text-xs text-text-secondary uppercase tracking-wider mb-1">Slope Angle</div>
              <div className="font-mono text-lg">{nodeData?.geotechnical?.slope_angle ?? '--'} <span className="text-xs text-text-secondary">°</span></div>
            </div>
            <div className="bg-elevated p-4 rounded-md border border-gray-800">
              <div className="text-xs text-text-secondary uppercase tracking-wider mb-1">Natural Moisture</div>
              <div className="font-mono text-lg">{nodeData?.geotechnical?.natural_moisture ?? '--'} <span className="text-xs text-text-secondary">%</span></div>
            </div>
          </div>
        </div>

        {/* MODEL EVIDENCE */}
        <div className="bg-surface border border-gray-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-medium text-text-main flex items-center gap-2">
            <Database className="w-5 h-5 text-brand-gold" />
            Model Evidence
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div>
                <div className="text-sm font-medium text-text-main">MAE (Mean Absolute Error)</div>
                <div className="text-xs text-text-secondary">Average absolute prediction error in FOS units</div>
              </div>
              <div className="font-mono text-brand-gold">{modelInfo?.metrics?.mae?.toFixed(4) ?? '--'}</div>
            </div>
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div>
                <div className="text-sm font-medium text-text-main">RMSE (Root Mean Squared Error)</div>
                <div className="text-xs text-text-secondary">Root mean squared error — larger errors penalized more</div>
              </div>
              <div className="font-mono text-brand-gold">{modelInfo?.metrics?.rmse?.toFixed(4) ?? '--'}</div>
            </div>
            <div className="flex items-center justify-between pb-3">
              <div>
                <div className="text-sm font-medium text-text-main">R² Score</div>
                <div className="text-xs text-text-secondary">Proportion of FOS variance explained by the model (not accuracy)</div>
              </div>
              <div className="font-mono text-brand-gold">{modelInfo?.metrics?.r2?.toFixed(4) ?? '--'}</div>
            </div>
            
            <div className="bg-elevated/50 p-3 rounded text-xs text-text-secondary flex items-start gap-2 border border-gray-800/50">
              <ShieldCheck className="w-4 h-4 shrink-0 text-status-stable" />
              <span>Validation performed on held-out records from the historical training dataset.</span>
            </div>
          </div>
        </div>

        {/* MODEL LIMITATION */}
        <div className="bg-surface border border-gray-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-medium text-text-main flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-status-watch" />
            Model Limitations
          </h2>
          <div className="space-y-3">
            <div className="text-sm text-text-main p-3 bg-status-watch/10 border border-status-watch/20 rounded-md">
              FOS estimation is based on geotechnical inputs and does not by itself determine the exact time of structural collapse.
            </div>
            {modelInfo?.limitations?.map((limitation, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-600 mt-2 shrink-0" />
                <span>{limitation}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FosAnalysis;


