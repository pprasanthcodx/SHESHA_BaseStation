import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Database, ShieldAlert, Cpu } from 'lucide-react';
 // Adjust imports as necessary

// We'll define the expected types here for self-containment if they differ from types.ts
interface LocalNodeStatus {
  id: string;
  name: string;
  risk_state: string;
  fos: number | null;
  last_seen: string;
}

interface LocalModelInfo {
  metrics: {
    mae: number;
    rmse: number;
    r2: number;
  };
  limitations: string[];
  fos_model?: {
    features: string[];
    target: string;
    description: string;
  };
}

export const AnalysisPage: React.FC = () => {
  const [nodes, setNodes] = useState<LocalNodeStatus[]>([]);
  const [modelInfo, setModelInfo] = useState<LocalModelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [nodesRes, modelRes] = await Promise.all([
          fetch('http://127.0.0.1:8001/nodes/status'),
          fetch('http://127.0.0.1:8001/model/info')
        ]);

        if (!nodesRes.ok || !modelRes.ok) {
          throw new Error('Failed to fetch intelligence data');
        }

        const nodesData = await nodesRes.json();
        const modelData = await modelRes.json();

        setNodes(nodesData);
        setModelInfo(modelData);
      } catch (err: any) {
        setError(err.message || 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const getRiskColor = (state: string) => {
    if (state === 'STABLE') return 'text-status-stable bg-status-stable/20 border-status-stable/30';
    if (state === 'WATCH') return 'text-status-watch bg-status-watch/20 border-status-watch/30';
    if (state === 'CRITICAL') return 'text-status-critical bg-status-critical/20 border-status-critical/30';
    return 'text-text-secondary bg-elevated border-text-secondary/30';
  };

  const activeRiskNodes = nodes.filter(n => n.risk_state !== 'STABLE' && n.risk_state !== 'OFFLINE');

  if (loading) {
    return (
      <div className="flex-1 p-6 animate-mount flex items-center justify-center">
        <div className="text-text-secondary">Loading intelligence data...</div>
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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text-main">Intelligence & Evidence</h1>
        <p className="text-text-secondary mt-1">System-wide model performance and risk analysis</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CURRENT RISK EXPLANATION */}
        <div className="bg-surface border border-gray-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-medium text-text-main flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-status-watch" />
            Current Risk Explanation
          </h2>
          {activeRiskNodes.length === 0 ? (
            <div className="p-4 bg-elevated border border-gray-800 rounded-md text-text-secondary text-sm">
              All active nodes are currently reporting stable conditions.
            </div>
          ) : (
            <div className="space-y-3">
              {activeRiskNodes.map(node => (
                <div key={node.id} className="p-4 bg-elevated border border-gray-800 rounded-md">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-text-main">{node.name || node.id}</div>
                    <div className={`px-2 py-0.5 rounded border text-xs font-bold ${getRiskColor(node.risk_state)}`}>
                      {node.risk_state}
                    </div>
                  </div>
                  <p className="text-sm text-text-secondary">
                    {node.risk_state === 'CRITICAL' 
                      ? `Node is exhibiting critical instability markers with an estimated FOS of ${node.fos?.toFixed(2) || 'unknown'}. Immediate attention is advised due to elevated modeled deviation from baseline stability.`
                      : `Node is under watch due to emerging deviations in telemetry parameters. Current estimated FOS is ${node.fos?.toFixed(2) || 'unknown'}, signaling reduced stability margin.`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* NODE RISK SUMMARY */}
        <div className="bg-surface border border-gray-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-medium text-text-main flex items-center gap-2">
            <Database className="w-5 h-5 text-telemetry-blue" />
            Node Risk Summary
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-800 text-xs uppercase tracking-wider text-text-secondary">
                  <th className="pb-3 pr-4 font-medium">Node</th>
                  <th className="pb-3 pr-4 font-medium">State</th>
                  <th className="pb-3 pr-4 font-medium text-right">FOS</th>
                  <th className="pb-3 font-medium text-right">Latest Reading</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {nodes.map(node => (
                  <tr key={node.id} className="border-b border-gray-800/50 hover:bg-elevated/50 transition-colors">
                    <td className="py-3 pr-4 text-text-main font-medium">{node.name || node.id}</td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold border ${getRiskColor(node.risk_state)}`}>
                        {node.risk_state}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-text-main">
                      {node.fos !== null ? node.fos.toFixed(2) : '--'}
                    </td>
                    <td className="py-3 text-right text-text-secondary text-xs">
                      {new Date(node.last_seen).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* MODEL PERFORMANCE */}
        <div className="bg-surface border border-gray-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-medium text-text-main flex items-center gap-2">
            <Activity className="w-5 h-5 text-status-stable" />
            Model Performance
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
          </div>
        </div>

        {/* MODEL PROVENANCE & LIMITATIONS */}
        <div className="bg-surface border border-gray-800 rounded-lg p-6 space-y-6">
          <div>
            <h2 className="text-lg font-medium text-text-main flex items-center gap-2 mb-4">
              <Cpu className="w-5 h-5 text-brand-gold" />
              Model Provenance
            </h2>
            <div className="bg-elevated p-4 rounded-md border border-gray-800 text-sm space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-text-secondary w-24 shrink-0">Dataset:</span>
                <span className="text-text-main">Historical geotechnical training dataset</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-text-secondary w-24 shrink-0">Inputs:</span>
                <span className="text-text-main">
                  {modelInfo?.fos_model?.features?.join(', ') || 'Cohesion, Friction Angle, Unit Weight, Bench Height, Slope Angle, Moisture, Tilt, Distance'}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-text-secondary w-24 shrink-0">Target:</span>
                <span className="text-text-main">{modelInfo?.fos_model?.target || 'Factor of Safety (FOS)'}</span>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-medium text-text-main flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-status-watch" />
              Limitations
            </h2>
            <div className="space-y-3">
              {modelInfo?.limitations?.map((limitation, i) => {
                // Heuristic to distinguish model type context if available in limitation text
                let contextLabel = "GENERAL";
                const lowerLimitation = limitation.toLowerCase();
                if (lowerLimitation.includes('anomaly')) contextLabel = "ANOMALY DETECTOR";
                else if (lowerLimitation.includes('forecast') || lowerLimitation.includes('time-series')) contextLabel = "TIME-SERIES FORECAST";
                else if (lowerLimitation.includes('fos')) contextLabel = "FOS MODEL";

                return (
                  <div key={i} className="bg-elevated p-3 rounded-md border border-gray-800">
                    <div className="text-[10px] font-bold text-brand-gold tracking-wider mb-1">{contextLabel}</div>
                    <div className="text-sm text-text-secondary">{limitation}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default AnalysisPage;
