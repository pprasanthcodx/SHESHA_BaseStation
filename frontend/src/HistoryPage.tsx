import { API_BASE_URL } from './config';
import React, { useState, useEffect } from 'react';
import { History, Download, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';

interface HistoryPageProps {
  nodes: string[];
}

interface TelemetryRecord {
  id: string;
  timestamp: string;
  distance_mm: number;
  tilt_x: number;
  tilt_y: number;
  accel_z: number;
  soil_moisture_percent: number;
  battery_v: number;
  lora_rssi: number;
}

interface HistoryResponse {
  total: number;
  offset: number;
  limit: number;
  records: TelemetryRecord[];
}

interface RiskEvent {
  id: string;
  timestamp: string;
  state: string;
  reasons: string[];
  fos_value: number;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ nodes }) => {
  const [selectedNode, setSelectedNode] = useState<string>(nodes[0] || '');
  const [hours, setHours] = useState<number>(24);
  const [limit, setLimit] = useState<number>(50);
  const [offset, setOffset] = useState<number>(0);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [riskEvents, setRiskEvents] = useState<RiskEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (nodes.length > 0 && !selectedNode) {
      setSelectedNode(nodes[0]);
    }
  }, [nodes, selectedNode]);

  useEffect(() => {
    if (!selectedNode) return;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [historyRes, eventsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/telemetry/${selectedNode}/history?hours=${hours}&limit=${limit}&offset=${offset}`),
          fetch(`${API_BASE_URL}/risk_events/${selectedNode}?limit=20`)
        ]);

        if (!historyRes.ok || !eventsRes.ok) throw new Error('Failed to fetch data');
        
        const historyData = await historyRes.json();
        const eventsData = await eventsRes.json();
        
        setData(historyData);
        setRiskEvents(eventsData);
      } catch (err: any) {
        console.error("History fetch failed, loading DEMO MODE fallback", err);
        import('./demoData').then(({ getDemoHistoryPage, getDemoRiskEvents }) => {
          setData(getDemoHistoryPage(selectedNode, limit, offset));
          setRiskEvents(getDemoRiskEvents(selectedNode));
          setError(null);
        }).catch(() => setError(err.message));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [selectedNode, hours, limit, offset]);

  const handleExport = () => {
    if (!data || data.records.length === 0) return;
    const headers = ['Timestamp', 'Distance (mm)', 'Tilt X (°)', 'Soil Moisture (%)', 'Battery (V)', 'RSSI (dBm)'];
    const rows = data.records.map(r => [
      new Date(r.timestamp).toISOString(),
      r.distance_mm,
      r.tilt_x,
      r.soil_moisture_percent,
      r.battery_v,
      r.lora_rssi
    ]);
    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shesha_history_${selectedNode}_${new Date().toISOString()}.csv`;
    a.click();
  };

  const formatStateColor = (state: string) => {
    switch(state) {
      case 'CRITICAL': return 'text-status-critical';
      case 'WATCH': return 'text-status-watch';
      case 'STABLE': return 'text-status-stable';
      default: return 'text-text-secondary';
    }
  };

  return (
    <div className="p-6 animate-mount flex flex-col h-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
          <History className="w-6 h-6 text-brand-gold" />
          Historical Telemetry
        </h1>
        <div className="flex items-center gap-4">
          <select
            value={selectedNode}
            onChange={(e) => { setSelectedNode(e.target.value); setOffset(0); }}
            className="bg-surface border border-elevated text-text-main rounded-md p-2 outline-none"
          >
            {nodes.length ? nodes.map(n => <option key={n} value={n}>{n}</option>) : <option>No nodes available</option>}
          </select>
          <select
            value={hours}
            onChange={(e) => { setHours(parseInt(e.target.value)); setOffset(0); }}
            className="bg-surface border border-elevated text-text-main rounded-md p-2 outline-none"
          >
            <option value={1}>Last 1 Hour</option>
            <option value={24}>Last 24 Hours</option>
            <option value={168}>Last 7 Days</option>
            <option value={720}>Last 30 Days</option>
          </select>
          <button
            onClick={handleExport}
            className="bg-surface hover:bg-elevated border border-elevated text-text-main px-3 py-2 rounded-md flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            CSV Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 bg-surface rounded-lg border border-elevated flex flex-col min-h-[500px]">
          {loading && !data ? (
            <div className="flex-1 flex items-center justify-center text-text-secondary">Loading...</div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center text-status-critical">{error}</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-elevated text-text-secondary text-xs uppercase border-b border-elevated">
                      <th className="p-3 font-medium">Timestamp</th>
                      <th className="p-3 font-medium">Distance (mm)</th>
                      <th className="p-3 font-medium">Tilt X</th>
                      <th className="p-3 font-medium">Soil (%)</th>
                      <th className="p-3 font-medium">Battery (V)</th>
                      <th className="p-3 font-medium">RSSI (dBm)</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {data?.records?.length ? data.records.map(row => (
                      <tr key={row.id} className="border-b border-elevated hover:bg-elevated/50 font-mono">
                        <td className="p-3 text-text-main">{new Date(row.timestamp).toLocaleString()}</td>
                        <td className="p-3 text-text-main">{Number(row.distance_mm || 0).toFixed(2)}</td>
                        <td className="p-3 text-text-main">{Number(row.tilt_x || 0).toFixed(2)}</td>
                        <td className="p-3 text-text-main">{Number(row.soil_moisture_percent || 0).toFixed(1)}</td>
                        <td className="p-3 text-text-main">{Number(row.battery_v || 0).toFixed(2)}</td>
                        <td className="p-3 text-text-main">{row.lora_rssi}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} className="p-8 text-center text-text-secondary">No data found for this period.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-auto p-4 border-t border-elevated flex items-center justify-between text-sm text-text-secondary">
                <div className="flex items-center gap-2">
                  <span>Rows per page:</span>
                  <select
                    value={limit}
                    onChange={(e) => { setLimit(parseInt(e.target.value)); setOffset(0); }}
                    className="bg-background border border-elevated rounded px-1 outline-none"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
                <div>
                  Showing {data?.total ? offset + 1 : 0}-{Math.min((data?.total || 0), offset + limit)} of {data?.total || 0}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                    disabled={offset === 0}
                    className="p-1 hover:bg-elevated rounded disabled:opacity-30"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setOffset(offset + limit)}
                    disabled={!data || offset + limit >= data.total}
                    className="p-1 hover:bg-elevated rounded disabled:opacity-30"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="bg-surface rounded-lg border border-elevated p-4 h-fit max-h-[500px] overflow-y-auto">
          <h3 className="text-lg font-bold text-text-main mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-status-watch" />
            Recent Risk Events
          </h3>
          <div className="space-y-4">
            {(riskEvents && riskEvents.length) ? riskEvents.map(event => {
              // DEFENSIVE NORMALIZATION: Handle string, null, or array gracefully
              const reasons = Array.isArray(event.reasons) 
                ? event.reasons 
                : event.reasons 
                  ? [String(event.reasons)] 
                  : [];

              return (
                <div key={event.id} className="border-l-2 border-elevated pl-3 py-1">
                  <div className="text-xs text-text-secondary mb-1">{new Date(event.timestamp).toLocaleString()}</div>
                  <div className={`font-bold text-sm ${formatStateColor(event.state)}`}>
                    State: {event.state} {event.fos_value && `(FOS: ${event.fos_value.toFixed(2)})`}
                  </div>
                  {reasons.length > 0 && (
                    <ul className="text-xs text-text-secondary mt-1 list-disc list-inside">
                      {reasons.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                </div>
              );
            }) : (
              <p className="text-sm text-text-secondary">No recent risk events.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-status-critical flex flex-col gap-4 animate-mount h-full">
          <h2 className="text-xl font-bold">Something went wrong in History.</h2>
          <pre className="bg-elevated p-4 rounded text-xs overflow-auto">{this.state.error?.toString()}</pre>
          <button onClick={() => this.setState({hasError: false})} className="bg-surface border border-elevated px-4 py-2 w-max rounded">Try Again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function HistoryPageWrapper(props: HistoryPageProps) {
  return <ErrorBoundary><HistoryPage {...props} /></ErrorBoundary>;
}




