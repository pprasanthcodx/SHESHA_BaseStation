import React, { useState, useEffect } from 'react';
import { Settings, Save, AlertCircle, CheckCircle } from 'lucide-react';

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
  geotechnical: GeotechnicalParams;
}

export const ConfigPage: React.FC = () => {
  const [nodes, setNodes] = useState<NodeStatus[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [params, setParams] = useState<GeotechnicalParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    fetchNodes();
  }, []);

  const fetchNodes = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8001/nodes/status');
      if (!res.ok) throw new Error('Failed to load nodes');
      const data = await res.json();
      setNodes(data);
      if (data.length > 0 && !selectedNodeId) {
        setSelectedNodeId(data[0].id);
        setParams(data[0].geotechnical);
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleNodeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedNodeId(id);
    const node = nodes.find(n => n.id === id);
    if (node) {
      setParams({ ...node.geotechnical });
    }
    setMessage(null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!params) return;
    const { name, value } = e.target;
    setParams({ ...params, [name]: parseFloat(value) || 0 });
  };

  const handleSave = async () => {
    if (!selectedNodeId || !params) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`http://127.0.0.1:8001/nodes/${selectedNodeId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error('Failed to update configuration');
      setMessage({ type: 'success', text: 'Configuration updated successfully.' });
      setLastUpdated(new Date());
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-text-secondary">Loading configuration...</div>;

  return (
    <div className="p-6 animate-mount max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-text-main mb-6 flex items-center gap-2">
        <Settings className="w-6 h-6 text-brand-gold" />
        Geotechnical Configuration
      </h1>
      
      <p className="text-text-secondary mb-6 text-sm">
        These values define the baseline and thresholds used by the SHESHA risk engine.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-surface p-6 rounded-lg border border-elevated">
          <div className="mb-6">
            <label className="block text-sm font-medium text-text-secondary mb-2">Select Node</label>
            <select
              value={selectedNodeId}
              onChange={handleNodeChange}
              className="w-full bg-background border border-elevated text-text-main rounded-md p-2 focus:border-brand-gold outline-none"
            >
              {nodes.map(n => (
                <option key={n.id} value={n.id}>{n.name} ({n.id})</option>
              ))}
            </select>
          </div>

          {params && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-text-secondary mb-1">Cohesion (kN/m²)</label>
                <input type="number" name="cohesion" value={params.cohesion} onChange={handleChange} className="w-full bg-background border border-elevated text-text-main rounded-md p-2 font-mono" />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Friction Angle φ (°)</label>
                <input type="number" name="phi" value={params.phi} onChange={handleChange} className="w-full bg-background border border-elevated text-text-main rounded-md p-2 font-mono" />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Unit Weight (kN/m³)</label>
                <input type="number" name="unit_weight" value={params.unit_weight} onChange={handleChange} className="w-full bg-background border border-elevated text-text-main rounded-md p-2 font-mono" />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Bench Height (m)</label>
                <input type="number" name="bench_height" value={params.bench_height} onChange={handleChange} className="w-full bg-background border border-elevated text-text-main rounded-md p-2 font-mono" />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Slope Angle (°)</label>
                <input type="number" name="slope_angle" value={params.slope_angle} onChange={handleChange} className="w-full bg-background border border-elevated text-text-main rounded-md p-2 font-mono" />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Natural Moisture (%)</label>
                <input type="number" name="natural_moisture" value={params.natural_moisture} onChange={handleChange} className="w-full bg-background border border-elevated text-text-main rounded-md p-2 font-mono" />
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between border-t border-elevated pt-4">
            <div>
              {message && (
                <div className={`flex items-center gap-2 text-sm ${message.type === 'success' ? 'text-status-stable' : 'text-status-critical'}`}>
                  {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {message.text}
                </div>
              )}
              {lastUpdated && !message && (
                <div className="text-xs text-text-secondary">Last updated: {lastUpdated.toLocaleTimeString()}</div>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-brand-gold text-background px-4 py-2 rounded-md font-medium hover:opacity-90 flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>

        <div className="bg-surface p-6 rounded-lg border border-elevated h-fit">
          <h3 className="text-lg font-bold text-text-main mb-4">Risk Thresholds</h3>
          <div className="space-y-4">
            <div className="bg-elevated p-3 rounded-md">
              <div className="text-xs text-text-secondary">FOS Watch Threshold</div>
              <div className="font-mono text-status-watch text-lg">1.5</div>
            </div>
            <div className="bg-elevated p-3 rounded-md">
              <div className="text-xs text-text-secondary">FOS Critical Threshold</div>
              <div className="font-mono text-status-critical text-lg">1.2</div>
            </div>
            <div className="bg-elevated p-3 rounded-md">
              <div className="text-xs text-text-secondary">Anomaly Persistence Threshold</div>
              <div className="font-mono text-text-main text-lg">3</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default ConfigPage;
