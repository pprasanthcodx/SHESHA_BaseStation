import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import type { LiveTelemetryPayload, AffectedParam } from './types';
import { Activity, Battery, Signal, Zap, Droplets, AlertTriangle, Network, ShieldAlert, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface DashboardProps {
  currentData: LiveTelemetryPayload;
  historyData: LiveTelemetryPayload[];
  onParameterClick: (param: string) => void;
}

const PARAM_COLORS: Record<string, string> = {
  Distance: '#4DA3FF',
  Tilt: '#A78BFA',
  Soil: '#E5A93D',
  Battery: '#39B86A',
  RSSI: '#6B7280',
};

const Dashboard = ({ currentData, historyData, onParameterClick }: DashboardProps) => {
  const { telemetry, risk } = currentData;
  const [visibleLines, setVisibleLines] = useState<Record<string, boolean>>({
    Distance: true, Tilt: true, Soil: true, Battery: false, RSSI: false,
  });

  const toggleLine = (key: string) => {
    setVisibleLines(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Compute chart data with normalization
  const chartData = useMemo(() => {
    if (historyData.length === 0) return [];
    
    const keys = ['distance', 'tilt', 'soil', 'battery', 'rssi'] as const;
    const mins: Record<string, number> = {};
    const maxs: Record<string, number> = {};
    
    keys.forEach(k => { mins[k] = Infinity; maxs[k] = -Infinity; });
    historyData.forEach(d => {
      keys.forEach(k => {
        const v = d.telemetry[k];
        if (v < mins[k]) mins[k] = v;
        if (v > maxs[k]) maxs[k] = v;
      });
    });

    const normalize = (val: number, min: number, max: number) => {
      const range = max - min;
      return range > 0 ? (val - min) / range : 0.5;
    };

    return historyData.map((d, idx) => ({
      time: new Date(d.telemetry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      fullTime: d.telemetry.timestamp,
      Distance: normalize(d.telemetry.distance, mins.distance, maxs.distance),
      Tilt: normalize(d.telemetry.tilt, mins.tilt, maxs.tilt),
      Soil: normalize(d.telemetry.soil, mins.soil, maxs.soil),
      Battery: normalize(d.telemetry.battery, mins.battery, maxs.battery),
      RSSI: normalize(d.telemetry.rssi, mins.rssi, maxs.rssi),
      raw: d.telemetry,
      riskLevel: d.risk.level,
      isTrigger: d.risk.level === 'WATCH' || d.risk.level === 'CRITICAL',
      isLast: idx === historyData.length - 1,
    }));
  }, [historyData]);

  // Compute trend per parameter
  const trends = useMemo(() => {
    if (historyData.length < 5) return {};
    const result: Record<string, { direction: string; change: number }> = {};
    const params = [
      { key: 'distance' as const, label: 'Distance', unit: 'mm' },
      { key: 'tilt' as const, label: 'Tilt', unit: '°' },
      { key: 'soil' as const, label: 'Soil', unit: '%' },
      { key: 'battery' as const, label: 'Battery', unit: 'V' },
      { key: 'rssi' as const, label: 'RSSI', unit: 'dBm' },
    ];
    const recent = historyData.slice(-20);
    params.forEach(p => {
      const first = recent[0].telemetry[p.key];
      const last = recent[recent.length - 1].telemetry[p.key];
      const change = last - first;
      const pctChange = first !== 0 ? Math.abs(change / first) : 0;
      result[p.label] = {
        direction: pctChange < 0.001 ? 'stable' : change > 0 ? 'rising' : 'falling',
        change: change,
      };
    });
    return result;
  }, [historyData]);

  // Check which params are affected by anomaly
  const affectedSet = new Set((risk.affected_params || []).map((p: AffectedParam) => p.parameter));

  const getRiskStyle = (level: string) => {
    switch (level) {
      case 'CRITICAL': return { bg: 'bg-status-critical', text: 'text-white', border: 'border-status-critical' };
      case 'WATCH': return { bg: 'bg-status-watch', text: 'text-background', border: 'border-status-watch' };
      case 'STABLE': return { bg: 'bg-status-stable', text: 'text-background', border: 'border-status-stable' };
      default: return { bg: 'bg-surface', text: 'text-text-main', border: 'border-border' };
    }
  };

  const riskStyle = getRiskStyle(risk.level);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const raw = payload[0].payload.raw;
      const rl = payload[0].payload.riskLevel;
      return (
        <div className="bg-surface border border-border/50 rounded-lg p-3 text-xs font-mono shadow-xl">
          <div className="text-text-secondary mb-2 pb-1 border-b border-border/30">
            {new Date(payload[0].payload.fullTime).toLocaleString()}
          </div>
          <div style={{ color: PARAM_COLORS.Distance }} className="mb-0.5">Distance: {raw.distance.toFixed(2)} mm</div>
          <div style={{ color: PARAM_COLORS.Tilt }} className="mb-0.5">Tilt: {raw.tilt.toFixed(4)}°</div>
          <div style={{ color: PARAM_COLORS.Soil }} className="mb-0.5">Soil: {raw.soil.toFixed(1)}%</div>
          <div style={{ color: PARAM_COLORS.Battery }} className="mb-0.5">Battery: {raw.battery.toFixed(2)} V</div>
          <div style={{ color: PARAM_COLORS.RSSI }}>RSSI: {raw.rssi.toFixed(0)} dBm</div>
          <div className="mt-1.5 pt-1.5 border-t border-border/30">
            <span className={`text-[10px] font-bold ${rl === 'CRITICAL' ? 'text-status-critical' : rl === 'WATCH' ? 'text-status-watch' : 'text-status-stable'}`}>{rl}</span>
          </div>
        </div>
      );
    }
    return null;
  };

  // Find trigger regions for shading
  const triggerRegions = useMemo(() => {
    const regions: { start: string; end: string; level: string }[] = [];
    let inTrigger = false;
    let startTime = '';
    let currentLevel = '';
    chartData.forEach((d, i) => {
      if (d.isTrigger && !inTrigger) {
        inTrigger = true;
        startTime = d.time;
        currentLevel = d.riskLevel;
      } else if (!d.isTrigger && inTrigger) {
        inTrigger = false;
        regions.push({ start: startTime, end: chartData[i - 1].time, level: currentLevel });
      }
    });
    if (inTrigger && chartData.length > 0) {
      regions.push({ start: startTime, end: chartData[chartData.length - 1].time, level: currentLevel });
    }
    return regions;
  }, [chartData]);

  return (
    <div className="flex flex-col h-full space-y-4 animate-mount">
      {/* ===== MAIN GRAPH ===== */}
      <div className="flex flex-col" style={{ minHeight: '340px', flex: '1 1 340px' }}>
        <div className="flex justify-between items-end mb-3 px-1">
          <div>
            <h2 className="text-base font-bold tracking-tight text-text-main mb-1.5">
              System Telemetry — {telemetry.node_id}
            </h2>
            <div className="flex space-x-3 text-xs font-medium uppercase tracking-wider">
              {Object.entries(PARAM_COLORS).map(([label, color]) => (
                <Toggle key={label} label={label} color={color} active={visibleLines[label]} onClick={() => toggleLine(label)} />
              ))}
            </div>
          </div>
          <div className="text-xs font-mono text-text-secondary">
            {historyData.length} points
          </div>
        </div>

        <div className="flex-1 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} opacity={0.6} />
              <XAxis dataKey="time" stroke="#6B7280" fontSize={10} tickMargin={8} minTickGap={50} tickLine={false} axisLine={false} />
              <YAxis domain={[-0.05, 1.05]} hide />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#4DA3FF', strokeWidth: 1, strokeDasharray: '4 4' }} />
              
              {/* Event region shading */}
              {triggerRegions.map((r, i) => (
                <ReferenceArea key={i} x1={r.start} x2={r.end}
                  fill={r.level === 'CRITICAL' ? '#EF4444' : '#F59E0B'}
                  fillOpacity={0.06} strokeOpacity={0}
                />
              ))}

              {visibleLines.Distance && <Line type="monotone" dataKey="Distance" stroke={PARAM_COLORS.Distance} strokeWidth={2} dot={false} isAnimationActive={false} />}
              {visibleLines.Tilt && <Line type="monotone" dataKey="Tilt" stroke={PARAM_COLORS.Tilt} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
              {visibleLines.Soil && <Line type="monotone" dataKey="Soil" stroke={PARAM_COLORS.Soil} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
              {visibleLines.Battery && <Line type="monotone" dataKey="Battery" stroke={PARAM_COLORS.Battery} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
              {visibleLines.RSSI && <Line type="monotone" dataKey="RSSI" stroke={PARAM_COLORS.RSSI} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
              
              {chartData.length > 0 && (
                <ReferenceLine x={chartData[chartData.length - 1].time} stroke="#E8ECEF" strokeWidth={1} strokeDasharray="2 2" strokeOpacity={0.3}
                  label={{ position: 'top', value: 'NOW', fill: '#9AA6AF', fontSize: 9 }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ===== PARAMETER STRIP ===== */}
      <div className="grid grid-cols-5 gap-2">
        <ParamCard
          label="Distance" value={`${telemetry.distance.toFixed(1)} mm`}
          icon={<Activity className="w-3.5 h-3.5" />} color={PARAM_COLORS.Distance}
          trend={trends['Distance']} isAffected={affectedSet.has('Distance')}
          affectedParam={(risk.affected_params || []).find((p: AffectedParam) => p.parameter === 'Distance')}
          onClick={() => onParameterClick('Distance')}
        />
        <ParamCard
          label="Tilt" value={`${telemetry.tilt.toFixed(3)}°`}
          icon={<Zap className="w-3.5 h-3.5" />} color={PARAM_COLORS.Tilt}
          trend={trends['Tilt']} isAffected={affectedSet.has('Tilt')}
          affectedParam={(risk.affected_params || []).find((p: AffectedParam) => p.parameter === 'Tilt')}
          onClick={() => onParameterClick('Tilt')}
        />
        <ParamCard
          label="Soil" value={`${telemetry.soil.toFixed(1)}%`}
          icon={<Droplets className="w-3.5 h-3.5" />} color={PARAM_COLORS.Soil}
          trend={trends['Soil']} isAffected={affectedSet.has('Soil Moisture')}
          affectedParam={(risk.affected_params || []).find((p: AffectedParam) => p.parameter === 'Soil Moisture')}
          onClick={() => onParameterClick('Soil')}
        />
        <ParamCard
          label="Battery" value={`${telemetry.battery.toFixed(2)} V`}
          icon={<Battery className="w-3.5 h-3.5" />} color={PARAM_COLORS.Battery}
          trend={trends['Battery']} isAffected={false}
          onClick={() => onParameterClick('Battery')}
          alert={telemetry.battery < 3.5}
        />
        <ParamCard
          label="RSSI" value={`${telemetry.rssi.toFixed(0)} dBm`}
          icon={<Signal className="w-3.5 h-3.5" />} color={PARAM_COLORS.RSSI}
          trend={trends['RSSI']} isAffected={false}
          onClick={() => onParameterClick('RSSI')}
          alert={telemetry.rssi < -95}
        />
      </div>

      {/* ===== RISK + ANOMALY + DIAGNOSTICS ===== */}
      <div className="grid grid-cols-12 gap-3">
        {/* Risk State */}
        <div
          onClick={() => onParameterClick('FOS')}
          className={`col-span-3 cursor-pointer rounded-lg p-4 flex flex-col items-center justify-center transition-all duration-200 hover:scale-[1.01] border-2 ${riskStyle.border} ${riskStyle.bg} ${riskStyle.text}`}
        >
          <ShieldAlert className="w-5 h-5 mb-1 opacity-80" />
          <div className="text-[10px] font-bold uppercase tracking-widest mb-1 opacity-80">Risk State</div>
          <div className="text-xl font-bold font-mono">{risk.level}</div>
          <div className="mt-1 text-xs opacity-80 font-mono">FOS {risk.fos !== null ? risk.fos.toFixed(3) : '---'}</div>
        </div>

        {/* Anomaly Pipeline */}
        <div className="col-span-3 bg-surface/60 rounded-lg p-3 flex flex-col">
          <h3 className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2 flex items-center">
            <Network className="w-3 h-3 mr-1.5 text-telemetry-blue" /> Anomaly Pipeline
          </h3>
          <div className="space-y-1.5 flex-1 flex flex-col justify-center text-xs">
            <div className="flex justify-between items-center">
              <span className="text-text-secondary">Detector</span>
              <span className={`font-mono font-bold px-2 py-0.5 rounded text-[10px] ${
                risk.is_anomalous ? 'bg-status-critical/15 text-status-critical' : 'bg-status-stable/10 text-status-stable'
              }`}>
                {risk.model_status === 'CALIBRATING' ? 'CALIBRATING' : risk.is_anomalous ? 'ANOMALOUS' : 'NOMINAL'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-text-secondary">Persistence</span>
              <div className="flex items-center space-x-1">
                {Array.from({ length: risk.persistence_threshold || 3 }).map((_, i) => (
                  <div key={i} className={`w-2.5 h-2.5 rounded-sm ${
                    i < risk.anomaly_persistence
                      ? risk.anomaly_persistence >= (risk.persistence_threshold || 3) ? 'bg-status-critical' : 'bg-status-watch'
                      : 'bg-elevated'
                  }`} />
                ))}
                <span className="font-mono text-text-main ml-1 text-[10px]">{risk.anomaly_persistence}/{risk.persistence_threshold || 3}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Risk Assessment (plain language) */}
        <div className="col-span-6 bg-surface/60 rounded-lg p-3 flex flex-col">
          <h3 className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2 flex items-center">
            <AlertTriangle className="w-3 h-3 mr-1.5 text-telemetry-blue" /> Risk Assessment
          </h3>
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {risk.reasons.length > 0 ? (
              risk.reasons.map((reason: string, idx: number) => (
                <div key={idx} className="text-xs text-text-main leading-relaxed flex items-start">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 mr-2 shrink-0 ${
                    risk.level === 'CRITICAL' ? 'bg-status-critical' : risk.level === 'WATCH' ? 'bg-status-watch' : 'bg-text-secondary'
                  }`} />
                  <span>{reason}</span>
                </div>
              ))
            ) : (
              <div className="text-xs text-text-secondary italic">All systems nominal. No risk indicators active.</div>
            )}
            {/* Affected parameters detail */}
            {(risk.affected_params || []).length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/20">
                <div className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1">Change Detected</div>
                {(risk.affected_params || []).map((p: AffectedParam, i: number) => (
                  <div key={i} className="text-xs font-mono text-status-critical">
                    {p.parameter}: {p.deviation > 0 ? '+' : ''}{p.deviation} from baseline
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ===== SUB-COMPONENTS =====

const Toggle = ({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }) => (
  <button onClick={onClick} className="flex items-center space-x-1.5 cursor-pointer hover:opacity-80 transition-opacity">
    <span className={`w-2 h-2 rounded-full transition-all ${active ? 'scale-100' : 'opacity-20 scale-75'}`} style={{ backgroundColor: color }} />
    <span className={`transition-colors ${active ? 'text-text-main' : 'text-text-secondary'}`}>{label}</span>
  </button>
);

interface ParamCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  trend?: { direction: string; change: number };
  isAffected: boolean;
  affectedParam?: AffectedParam;
  onClick: () => void;
  alert?: boolean;
}

const ParamCard = ({ label, value, icon, trend, isAffected, affectedParam, onClick, alert }: ParamCardProps) => {
  const TrendIcon = trend?.direction === 'rising' ? TrendingUp : trend?.direction === 'falling' ? TrendingDown : Minus;
  
  return (
    <div
      onClick={onClick}
      className={`rounded-lg p-3 cursor-pointer group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
        isAffected
          ? 'bg-status-critical/8 border border-status-critical/30 animate-pulse'
          : alert
            ? 'bg-status-critical/5 border border-status-critical/20'
            : 'bg-surface/70 border border-transparent hover:border-border/30'
      }`}
    >
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">{label}</span>
        <div className={`w-3.5 h-3.5 ${isAffected ? 'text-status-critical' : alert ? 'text-status-critical' : 'text-text-secondary opacity-50 group-hover:opacity-100'}`}>
          {icon}
        </div>
      </div>
      <div className={`text-lg font-bold font-mono truncate ${isAffected ? 'text-status-critical' : alert ? 'text-status-critical' : 'text-text-main'}`}>
        {value}
      </div>
      {trend && (
        <div className="flex items-center mt-1 space-x-1">
          <TrendIcon className={`w-3 h-3 ${
            trend.direction === 'rising' ? 'text-status-watch' : trend.direction === 'falling' ? 'text-telemetry-blue' : 'text-text-secondary'
          }`} />
          <span className="text-[10px] text-text-secondary font-mono">
            {trend.direction === 'stable' ? 'Stable' : `${trend.change > 0 ? '+' : ''}${trend.change.toFixed(2)}`}
          </span>
        </div>
      )}
      {isAffected && affectedParam && (
        <div className="text-[10px] font-mono text-status-critical mt-1">
          {affectedParam.deviation > 0 ? '+' : ''}{affectedParam.deviation} from baseline
        </div>
      )}
    </div>
  );
};

export default Dashboard;
