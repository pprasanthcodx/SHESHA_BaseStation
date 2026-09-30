import { API_BASE_URL } from './config';
import { useMemo, useState, useEffect } from 'react';
import { Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, BarChart, Bar } from 'recharts';
import type { LiveTelemetryPayload, ForecastResult } from './types';
import { ArrowLeft, Activity, Cpu, TrendingUp, TrendingDown, Minus, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';

interface ParameterAnalysisProps {
  param: string;
  currentData: LiveTelemetryPayload;
  historyData: LiveTelemetryPayload[];
  onBack: () => void;
}

const API_URL = API_BASE_URL;

const TIME_RANGES = [
  { label: '1H', hours: 1 },
  { label: '24H', hours: 24 },
  { label: '7D', hours: 168 },
  { label: '30D', hours: 720 },
];

const paramConfig: Record<string, { key: string; unit: string; color: string; fullKey: string }> = {
  'Distance': { key: 'distance', unit: 'mm', color: '#4DA3FF', fullKey: 'Distance' },
  'Tilt': { key: 'tilt', unit: '°', color: '#A78BFA', fullKey: 'Tilt' },
  'Soil': { key: 'soil', unit: '%', color: '#E5A93D', fullKey: 'Soil Moisture' },
  'Battery': { key: 'battery', unit: 'V', color: '#39B86A', fullKey: 'Battery' },
  'RSSI': { key: 'rssi', unit: 'dBm', color: '#6B7280', fullKey: 'RSSI' },
};

const ParameterAnalysis = ({ param, currentData, historyData, onBack }: ParameterAnalysisProps) => {
  const { telemetry, risk } = currentData;
  const config = paramConfig[param] || paramConfig['Distance'];
  
  // Find if this specific parameter is flagged
  const affectedParam = (risk.affected_params || []).find(p => p.parameter === config.fullKey);

  const [forecastResult, setForecastResult] = useState<ForecastResult | null>(null);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [selectedRange, setSelectedRange] = useState('24H');
  
  // Historical data from API
  const [apiHistory, setApiHistory] = useState<any[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  // Fetch forecast
  useEffect(() => {
    if (!telemetry.node_id) return;
    setLoadingForecast(true);
    fetch(`${API_URL}/telemetry/${telemetry.node_id}/forecast?parameter=${param}&horizon=10`)
      .then(res => {
        if (!res.ok) throw new Error("API Error");
        return res.json();
      })
      .then(data => setForecastResult(data))
      .catch(e => {
        console.error("Forecast fallback", e);
        const currentVal = Number((telemetry as any)[config.key]) || 0;
        setForecastResult({
          forecast: Array.from({length: 10}).map((_, i) => ({
            timestamp: new Date(Date.now() + (i + 1) * 5000).toISOString(),
            forecast_value: currentVal,
            lower_bound: currentVal - (currentVal * 0.05),
            upper_bound: currentVal + (currentVal * 0.05)
          })),
          trend_direction: "stable"
        });
      })
      .finally(() => setLoadingForecast(false));
  }, [telemetry.node_id, param, config.key, telemetry]);

  // Fetch historical table data
  useEffect(() => {
    if (!telemetry.node_id) return;
    const range = TIME_RANGES.find(r => r.label === selectedRange);
    if (!range) return;
    setHistoryLoading(true);
    fetch(`${API_URL}/telemetry/${telemetry.node_id}/history?hours=${range.hours}&limit=${rowsPerPage}&offset=${historyOffset}`)
      .then(res => {
        if (!res.ok) throw new Error("API Error");
        return res.json();
      })
      .then(data => {
        setApiHistory(data.records || []);
        setHistoryTotal(data.total || 0);
      })
      .catch(e => {
        console.error("History fallback", e);
        import('./demoData').then(({ getDemoHistoryPage }) => {
          const demoPage = getDemoHistoryPage(telemetry.node_id, rowsPerPage, historyOffset);
          setApiHistory(demoPage.records);
          setHistoryTotal(demoPage.total);
        });
      })
      .finally(() => setHistoryLoading(false));
  }, [telemetry.node_id, selectedRange, historyOffset, rowsPerPage]);

  // Reset offset when range changes
  useEffect(() => { setHistoryOffset(0); }, [selectedRange, rowsPerPage]);

  // Map API column names to frontend param keys
  const apiKeyMap: Record<string, string> = {
    'distance': 'distance_mm',
    'tilt': 'tilt_x',
    'soil': 'soil_moisture_percent',
    'battery': 'battery_v',
    'rssi': 'lora_rssi',
  };
  const apiCol = apiKeyMap[config.key] || config.key;

  // Stats from WS history
  const stats = useMemo(() => {
    if (historyData.length === 0) return null;
    const values = historyData.map(d => Number((d.telemetry as any)[config.key]) || 0);
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    const roc = values.length > 1 ? (values[values.length - 1] - values[0]) / values.length : 0;
    return { min, max, avg, median, std, roc, count: values.length };
  }, [historyData, config.key]);

  // Chart data combining measured + forecast
  const chartData = useMemo(() => {
    const data: any[] = historyData.map(d => {
      // Check if this specific point was an anomaly for THIS parameter
      const wasAffected = (d.risk.affected_params || []).some(p => p.parameter === config.fullKey);
      return {
        time: new Date(d.telemetry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        fullTime: d.telemetry.timestamp,
        measured: Number((d.telemetry as any)[config.key]) || 0,
        isForecast: false,
        isTrigger: d.telemetry.trigger,
        isAffected: wasAffected
      };
    });

    if (forecastResult && forecastResult.forecast) {
      forecastResult.forecast.forEach(f => {
        data.push({
          time: new Date(f.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          fullTime: f.timestamp,
          forecast_val: f.forecast_value,
          range: [f.lower_bound, f.upper_bound],
          isForecast: true,
          isAffected: false
        });
      });
    }
    return data;
  }, [historyData, config.key, forecastResult]);

  // Distribution histogram
  const histogramData = useMemo(() => {
    if (historyData.length < 5) return [];
    const values = historyData.map(d => Number((d.telemetry as any)[config.key]) || 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    if (range === 0) return [{ bin: min.toFixed(1), count: values.length }];
    const numBins = Math.min(15, Math.max(5, Math.ceil(Math.sqrt(values.length))));
    const binWidth = range / numBins;
    const bins: { bin: string; count: number }[] = [];
    for (let i = 0; i < numBins; i++) {
      const lo = min + i * binWidth;
      const hi = lo + binWidth;
      const count = values.filter(v => v >= lo && (i === numBins - 1 ? v <= hi : v < hi)).length;
      bins.push({ bin: lo.toFixed(1), count });
    }
    return bins;
  }, [historyData, config.key]);

  const currentNowTime = historyData.length > 0
    ? new Date(historyData[historyData.length - 1].telemetry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  const trendDir = forecastResult?.trend_direction || (stats && stats.roc > 0.01 ? 'rising' : stats && stats.roc < -0.01 ? 'falling' : 'stable');
  const TrendIcon = trendDir === 'rising' ? TrendingUp : trendDir === 'falling' ? TrendingDown : Minus;

  // CSV export
  const exportCSV = () => {
    if (apiHistory.length === 0) return;
    const headers = ['timestamp', apiCol];
    const rows = apiHistory.map(r => [r.timestamp, r[apiCol]]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${param}_${telemetry.node_id}_${selectedRange}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full space-y-4 animate-mount">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button onClick={onBack} className="p-1.5 rounded-lg bg-surface hover:bg-elevated transition-colors text-text-secondary hover:text-text-main">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-lg font-bold text-text-main tracking-tight flex items-center">
              {param} Analysis 
              {affectedParam && <span className="ml-3 px-2 py-0.5 rounded text-[10px] bg-status-critical/20 text-status-critical border border-status-critical/30 animate-pulse">ANOMALY DETECTED</span>}
            </h2>
            <p className="text-[10px] text-text-secondary font-mono uppercase tracking-wider">{telemetry.node_id}</p>
          </div>
        </div>
        
        {/* Forecast badge */}
        <div className="flex items-center space-x-3">
          {loadingForecast && <span className="text-[10px] font-mono text-text-secondary animate-pulse">GENERATING FORECAST...</span>}
          {forecastResult && !forecastResult.error && (
            <div className="flex items-center space-x-3 text-[10px] font-mono bg-surface/50 rounded-lg px-3 py-1.5 border border-border/30">
              <span className="text-telemetry-blue font-bold flex items-center"><Cpu className="w-3 h-3 mr-1" /> AI FORECAST</span>
              <span className="text-text-secondary">Model: <span className="text-text-main">{forecastResult.model}</span></span>
              <span className="text-text-secondary">RMSE: <span className="text-text-main">{forecastResult.rmse?.toFixed(3)}</span></span>
              <TrendIcon className={`w-3 h-3 ${trendDir === 'rising' ? 'text-status-watch' : trendDir === 'falling' ? 'text-telemetry-blue' : 'text-text-secondary'}`} />
            </div>
          )}
          {forecastResult?.error && (
            <div className="text-[10px] font-mono bg-status-watch/10 rounded-lg text-status-watch px-3 py-1.5 border border-status-watch/20">
              {forecastResult.error}
            </div>
          )}
        </div>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-7 gap-2">
          <StatCard label="Current" value={`${Number((telemetry as any)[config.key]).toFixed(2)} ${config.unit}`} color={config.color} highlight />
          <StatCard label="Min" value={`${stats.min.toFixed(2)} ${config.unit}`} />
          <StatCard label="Max" value={`${stats.max.toFixed(2)} ${config.unit}`} />
          <StatCard label="Mean" value={`${stats.avg.toFixed(2)} ${config.unit}`} />
          <StatCard label="Median" value={`${stats.median.toFixed(2)} ${config.unit}`} />
          <StatCard label="Std Dev" value={`${stats.std.toFixed(3)}`} />
          <StatCard label="Trend" value={`${stats.roc > 0 ? '+' : ''}${stats.roc.toFixed(3)}/t`} />
        </div>
      )}

      {/* Affected Anomaly Details */}
      {affectedParam && (
        <div className="bg-status-critical/10 border border-status-critical/30 rounded-lg p-3 flex items-center justify-between animate-mount">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="w-5 h-5 text-status-critical" />
            <div>
              <div className="text-xs font-bold text-status-critical uppercase tracking-wider">Parameter Exceeds Historical Baseline</div>
              <div className="text-[10px] text-text-secondary mt-0.5">This sensor reading has deviated significantly from its stable distribution.</div>
            </div>
          </div>
          <div className="flex items-center space-x-6 mr-4">
            <div className="flex flex-col">
              <span className="text-[10px] text-text-secondary uppercase">Baseline Mean</span>
              <span className="text-sm font-mono text-text-main">{affectedParam.baseline_mean.toFixed(2)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-text-secondary uppercase">Deviation</span>
              <span className="text-sm font-mono text-status-critical font-bold">{affectedParam.deviation > 0 ? '+' : ''}{affectedParam.deviation.toFixed(2)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-text-secondary uppercase">Z-Score</span>
              <span className="text-sm font-mono text-status-critical font-bold">{affectedParam.z_score.toFixed(1)}σ</span>
            </div>
          </div>
        </div>
      )}

      {/* Main chart + histogram side by side */}
      <div className="flex gap-3" style={{ minHeight: '280px', flex: '1 1 280px' }}>
        {/* Time-series chart */}
        <div className="flex-1 bg-surface/30 rounded-lg p-3 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-bold text-text-secondary uppercase tracking-wider flex items-center">
              <Activity className="w-3 h-3 mr-1.5 text-telemetry-blue" /> Time-Series & Forecast
            </h3>
            <div className="flex space-x-4 text-[9px] font-mono text-text-secondary">
              <span className="flex items-center"><span className="w-3 h-0.5 rounded-full mr-1" style={{ backgroundColor: config.color }} /> Measured</span>
              <span className="flex items-center"><span className="w-3 h-px mr-1 border-b border-dashed" style={{ borderColor: config.color }} /> Forecast</span>
              <span className="flex items-center"><span className="w-3 h-2 rounded-sm mr-1 opacity-20" style={{ backgroundColor: config.color }} /> Uncertainty</span>
            </div>
          </div>
          <div className="flex-1 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} opacity={0.5} />
                <XAxis dataKey="time" stroke="#6B7280" fontSize={10} tickMargin={8} minTickGap={50} tickLine={false} axisLine={false} />
                <YAxis domain={['auto', 'auto']} stroke="#6B7280" fontSize={10} tickLine={false} axisLine={false} width={55} tickFormatter={(v: number) => v.toFixed(1)} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #303941', borderRadius: '6px', fontSize: '11px', fontFamily: 'monospace', color: '#E8ECEF' }}
                  cursor={{ stroke: config.color, strokeWidth: 1, strokeDasharray: '4 4' }}
                />
                <Area type="monotone" dataKey="range" fill={config.color} fillOpacity={0.1} stroke="none" isAnimationActive={false} />
                <Line 
                  type="monotone" 
                  dataKey="measured" 
                  stroke={config.color} 
                  strokeWidth={2} 
                  isAnimationActive={false} 
                  dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    if (payload.isAffected) {
                      return <circle cx={cx} cy={cy} r={4} fill="#EF4444" stroke="#0B0F19" strokeWidth={1} />;
                    }
                    return <svg/>; // hidden for normal points
                  }} 
                />
                <Line type="monotone" dataKey="forecast_val" stroke={config.color} strokeWidth={2} strokeDasharray="5 5" dot={false} isAnimationActive={false} name="Forecast" />
                {currentNowTime && (
                  <ReferenceLine x={currentNowTime} stroke="#E8ECEF" strokeWidth={1} strokeDasharray="2 2" strokeOpacity={0.3}
                    label={{ position: 'top', value: 'NOW', fill: '#9AA6AF', fontSize: 9 }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Distribution histogram */}
        <div className="w-64 bg-surface/30 rounded-lg p-3 flex flex-col shrink-0">
          <h3 className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">Distribution</h3>
          <div className="flex-1">
            {histogramData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histogramData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <XAxis dataKey="bin" fontSize={9} stroke="#6B7280" tickLine={false} axisLine={false} />
                  <YAxis fontSize={9} stroke="#6B7280" tickLine={false} axisLine={false} width={25} />
                  <Bar dataKey="count" fill={config.color} fillOpacity={0.6} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-[10px] text-text-secondary italic flex items-center justify-center h-full">Insufficient data</div>
            )}
          </div>
        </div>
      </div>

      {/* Historical records table */}
      <div className="bg-surface/30 rounded-lg flex flex-col" style={{ maxHeight: '240px' }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/20 shrink-0">
          <h3 className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Historical Records</h3>
          <div className="flex items-center space-x-2">
            {/* Time range buttons */}
            {TIME_RANGES.map(r => (
              <button
                key={r.label}
                onClick={() => setSelectedRange(r.label)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${
                  selectedRange === r.label
                    ? 'bg-telemetry-blue/20 text-telemetry-blue border border-telemetry-blue/30'
                    : 'text-text-secondary hover:text-text-main border border-transparent'
                }`}
              >
                {r.label}
              </button>
            ))}
            <span className="text-[10px] text-text-secondary mx-1">|</span>
            <select
              value={rowsPerPage}
              onChange={e => setRowsPerPage(Number(e.target.value))}
              className="bg-elevated text-text-main text-[10px] font-mono rounded px-1.5 py-0.5 border border-border/30"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button onClick={exportCSV} className="px-2 py-0.5 rounded text-[10px] font-mono text-telemetry-blue hover:bg-telemetry-blue/10 border border-telemetry-blue/20 transition-colors">CSV</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {historyLoading ? (
            <div className="text-[10px] text-text-secondary text-center py-4 animate-pulse">Loading...</div>
          ) : apiHistory.length === 0 ? (
            <div className="text-[10px] text-text-secondary text-center py-4">No records for this time range</div>
          ) : (
            <table className="w-full text-left border-collapse text-[11px]">
              <thead className="bg-surface/60 sticky top-0">
                <tr>
                  <th className="p-2 pl-3 font-medium text-text-secondary border-b border-border/20">Timestamp</th>
                  <th className="p-2 font-medium text-text-secondary border-b border-border/20">{param} ({config.unit})</th>
                  <th className="p-2 font-medium text-text-secondary border-b border-border/20">Distance (mm)</th>
                  <th className="p-2 font-medium text-text-secondary border-b border-border/20">Tilt</th>
                  <th className="p-2 font-medium text-text-secondary border-b border-border/20">Battery (V)</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {apiHistory.map((row, i) => (
                  <tr key={i} className="border-b border-border/5 hover:bg-elevated/30 transition-colors">
                    <td className="p-2 pl-3 text-text-secondary">{new Date(row.timestamp).toLocaleString()}</td>
                    <td className="p-2 font-medium text-text-main">{Number(row[apiCol]).toFixed(3)}</td>
                    <td className="p-2 text-text-secondary">{Number(row.distance_mm).toFixed(1)}</td>
                    <td className="p-2 text-text-secondary">{Number(row.tilt_x).toFixed(4)}</td>
                    <td className="p-2 text-text-secondary">{Number(row.battery_v).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {/* Pagination */}
        {historyTotal > 0 && (
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-border/20 text-[10px] font-mono text-text-secondary shrink-0">
            <span>Showing {historyOffset + 1}–{Math.min(historyOffset + rowsPerPage, historyTotal)} of {historyTotal}</span>
            <div className="flex items-center space-x-1">
              <button
                onClick={() => setHistoryOffset(Math.max(0, historyOffset - rowsPerPage))}
                disabled={historyOffset === 0}
                className="p-1 rounded hover:bg-elevated disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>
              <button
                onClick={() => setHistoryOffset(historyOffset + rowsPerPage)}
                disabled={historyOffset + rowsPerPage >= historyTotal}
                className="p-1 rounded hover:bg-elevated disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const StatCard = ({ label, value, highlight, color }: { label: string; value: string; highlight?: boolean; color?: string }) => (
  <div className={`bg-surface/50 rounded-lg p-2.5 flex flex-col ${highlight ? 'border-b-2 shadow-sm' : ''}`} style={highlight ? { borderBottomColor: color } : {}}>
    <span className="text-[9px] text-text-secondary uppercase tracking-wider mb-0.5 font-medium">{label}</span>
    <span className="text-sm font-bold font-mono truncate" style={highlight ? { color } : { color: '#E8ECEF' }}>{value}</span>
  </div>
);

export default ParameterAnalysis;



