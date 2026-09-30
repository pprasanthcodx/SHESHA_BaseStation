import { API_BASE_URL, getWsUrl } from './config';
import { useEffect, useState, useRef, useCallback } from 'react';
import { Activity, History as HistoryIcon, Settings, Cpu, Info, X, ShieldAlert } from 'lucide-react';
import type { LiveTelemetryPayload, AffectedParam } from './types';
import Dashboard from './Dashboard';
import HistoryPage from './HistoryPage';
import AnalysisPage from './AnalysisPage';
import NodesPage from './NodesPage';
import ConfigPage from './ConfigPage';
import ParameterAnalysis from './ParameterAnalysis';
import FosAnalysis from './FosAnalysis';

const WS_URL = getWsUrl('/ws/live');

interface CriticalAlertProps {
  data: LiveTelemetryPayload;
  onAcknowledge: () => void;
  onViewNode: () => void;
}

const CriticalAlertOverlay = ({ data, onAcknowledge, onViewNode }: CriticalAlertProps) => {
  const { telemetry, risk } = data;
  const affected = risk.affected_params || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-mount">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 border-4 border-status-critical/60 animate-pulse" />
      </div>

      <div className="relative bg-surface border-2 border-status-critical rounded-xl shadow-2xl max-w-2xl w-full mx-4 overflow-hidden">
        <div className="bg-status-critical/15 border-b border-status-critical/30 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <ShieldAlert className="w-7 h-7 text-status-critical animate-pulse" />
            <div>
              <h2 className="text-xl font-bold text-status-critical tracking-wide">CRITICAL STRUCTURAL RISK</h2>
              <p className="text-sm font-mono text-text-secondary mt-0.5">{telemetry.node_id} — {new Date(telemetry.timestamp).toLocaleString()}</p>
            </div>
          </div>
          <button onClick={onAcknowledge} className="p-2 rounded-lg hover:bg-elevated transition-colors text-text-secondary hover:text-text-main">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-border/30">
          <p className="text-sm text-text-main leading-relaxed">
            Abnormal movement and/or stability indicators have crossed the configured critical condition.
          </p>
        </div>

        {affected.length > 0 && (
          <div className="px-6 py-4 border-b border-border/30">
            <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">Affected Parameters</h3>
            <div className="grid grid-cols-2 gap-3">
              {affected.map((p: AffectedParam, i: number) => (
                <div key={i} className="bg-status-critical/5 border border-status-critical/20 rounded-lg p-3">
                  <div className="text-xs font-bold text-status-critical uppercase mb-1">{p.parameter}</div>
                  <div className="space-y-0.5 text-xs font-mono">
                    <div className="flex justify-between"><span className="text-text-secondary">Current</span><span className="text-text-main">{p.current}</span></div>
                    <div className="flex justify-between"><span className="text-text-secondary">Baseline</span><span className="text-text-main">{p.baseline_mean}</span></div>
                    <div className="flex justify-between"><span className="text-text-secondary">Change</span><span className="text-status-critical font-bold">{p.deviation > 0 ? '+' : ''}{p.deviation}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="px-6 py-4 border-b border-border/30">
          <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">Evidence</h3>
          <div className="space-y-1.5 text-xs font-mono">
            <div className="flex justify-between"><span className="text-text-secondary">Anomaly Persistence</span><span className="text-text-main">{risk.anomaly_persistence} / {risk.persistence_threshold}</span></div>
            <div className="flex justify-between"><span className="text-text-secondary">FOS</span><span className="text-text-main">{risk.fos !== null ? risk.fos.toFixed(3) : '---'}</span></div>
          </div>
          <div className="mt-3 space-y-1">
            {risk.reasons.map((r: string, i: number) => (
              <div key={i} className="text-xs text-text-main flex items-start">
                <span className="w-1.5 h-1.5 rounded-full bg-status-critical mt-1.5 mr-2 shrink-0" />
                <span>{r}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-4 flex items-center justify-end space-x-3">
          <button
            onClick={onViewNode}
            className="px-4 py-2 rounded-lg border border-border/50 text-sm font-medium text-text-main hover:bg-elevated transition-colors"
          >
            View Node Details
          </button>
          <button
            onClick={onAcknowledge}
            className="px-4 py-2 rounded-lg bg-status-critical text-white text-sm font-bold hover:bg-status-critical/80 transition-colors"
          >
            Acknowledge Alert
          </button>
        </div>
      </div>
    </div>
  );
};

function App() {
  const [activeTab, setActiveTab] = useState('Command Center');
  const [drillDownParam, setDrillDownParam] = useState<string | null>(null);
  
  const [liveData, setLiveData] = useState<Record<string, LiveTelemetryPayload>>({});
  const [historyData, setHistoryData] = useState<Record<string, LiveTelemetryPayload[]>>({});
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const [criticalAlert, setCriticalAlert] = useState<LiveTelemetryPayload | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const selectedNodeRef = useRef<string | null>(null);

  useEffect(() => { selectedNodeRef.current = selectedNode; }, [selectedNode]);

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // INITIALIZATION: Fetch nodes status and recent history to prevent blank page on refresh
  useEffect(() => {
    const initializeData = async () => {
      try {
        const nodesRes = await fetch(`${API_BASE_URL}/nodes/status`);
        if (!nodesRes.ok) return;
        const nodes = await nodesRes.json();
        
        const newLiveData: Record<string, LiveTelemetryPayload> = {};
        const newHistoryData: Record<string, LiveTelemetryPayload[]> = {};
        
        for (const node of nodes) {
          const histRes = await fetch(`${API_BASE_URL}/telemetry/${node.id}/history?hours=24&limit=200`);
          if (histRes.ok) {
            const histData = await histRes.json();
            const records = Array.isArray(histData.records) ? histData.records : [];
            if (records.length > 0) {
              // Convert DB records to LiveTelemetryPayload format
              const formattedRecords = records.reverse().map((r: any) => ({
                type: "LIVE_TELEMETRY",
                telemetry: {
                  timestamp: r.timestamp,
                  node_id: r.node_id,
                  distance: r.distance_mm,
                  tilt: r.tilt_x,
                  soil: r.soil_moisture_percent,
                  battery: r.battery_v,
                  rssi: r.lora_rssi,
                  trigger: false
                },
                risk: {
                  level: node.risk_state, // fallback approx
                  fos: node.fos,
                  anomaly_persistence: 0,
                  persistence_threshold: 3,
                  is_anomalous: false,
                  model_status: "INITIALIZED",
                  reasons: [],
                  affected_params: []
                }
              }));
              newHistoryData[node.id] = formattedRecords;
              newLiveData[node.id] = formattedRecords[formattedRecords.length - 1];
            }
          }
        }
        
        setHistoryData(prev => ({ ...newHistoryData, ...prev }));
        setLiveData(prev => ({ ...newLiveData, ...prev }));
        
        if (nodes.length > 0) {
          setSelectedNode(prev => prev || nodes[0].id);
        }
      } catch (e) {
        console.error("Failed to initialize state", e);
      }
    };
    initializeData();
  }, []);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let mounted = true;

    const connectWs = () => {
      if (!mounted) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => { if (mounted) setIsConnected(true); };
      
      ws.onmessage = (event) => {
        try {
          const data: LiveTelemetryPayload = JSON.parse(event.data);
          if (data.type === 'LIVE_TELEMETRY') {
            const nodeId = data.telemetry.node_id;
            
            setLiveData(prev => ({ ...prev, [nodeId]: data }));
            setHistoryData(prev => {
              const nodeHistory = prev[nodeId] || [];
              const updatedHistory = [...nodeHistory, data].slice(-200);
              return { ...prev, [nodeId]: updatedHistory };
            });

            setSelectedNode(prev => prev || nodeId);

            if (data.risk.level === 'CRITICAL') {
              setCriticalAlert(data);
            }
          }
        } catch (e) {
          console.error("Error parsing WS message", e);
        }
      };

      ws.onclose = () => {
        if (mounted) {
          setIsConnected(false);
          reconnectTimer = setTimeout(connectWs, 3000);
        }
      };
      ws.onerror = () => { ws.close(); };
    };

    connectWs();
    return () => {
      mounted = false;
      clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const tabs = ['Command Center', 'History', 'Intelligence', 'Nodes', 'Configuration'];

  const handleTabClick = (tab: string) => {
    setActiveTab(tab);
    setDrillDownParam(null);
  };

  const handleAcknowledgeAlert = useCallback(() => {
    setCriticalAlert(null);
  }, []);

  const handleViewAlertNode = useCallback(() => {
    if (criticalAlert) {
      setSelectedNode(criticalAlert.telemetry.node_id);
      setActiveTab('Command Center');
      setDrillDownParam(null);
    }
    setCriticalAlert(null);
  }, [criticalAlert]);

  const renderContent = () => {
    if (activeTab === 'Command Center') {
      if (!selectedNode || !liveData[selectedNode]) {
        return <div className="flex items-center justify-center h-full text-text-secondary font-mono text-sm uppercase tracking-wider">AWAITING TELEMETRY DATA...</div>;
      }
      
      if (drillDownParam === 'FOS') {
        return <FosAnalysis currentData={liveData[selectedNode]} onBack={() => setDrillDownParam(null)} />;
      }
      if (drillDownParam) {
        return <ParameterAnalysis param={drillDownParam} currentData={liveData[selectedNode]} historyData={historyData[selectedNode] || []} onBack={() => setDrillDownParam(null)} />;
      }
      
      return <Dashboard currentData={liveData[selectedNode]} historyData={historyData[selectedNode] || []} onParameterClick={setDrillDownParam} />;
    }
    
    switch (activeTab) {
      case 'History': return <HistoryPage nodes={Object.keys(liveData)} />;
      case 'Intelligence': return <AnalysisPage />;
      case 'Nodes': return <NodesPage />;
      case 'Configuration': return <ConfigPage />;
      default: return null;
    }
  };

  const dataSource = Object.values(liveData).length > 0 ? 'SIMULATED' : null;

  return (
    <div className="flex h-screen w-full bg-background text-text-main font-sans overflow-hidden">
      {criticalAlert && (
        <CriticalAlertOverlay
          data={criticalAlert}
          onAcknowledge={handleAcknowledgeAlert}
          onViewNode={handleViewAlertNode}
        />
      )}

      <div className="w-60 bg-surface border-r border-border/50 flex flex-col shrink-0">
        <div className="p-4 flex items-center space-x-3 border-b border-border/50">
          <img src="/shesha-logo.png" alt="SHESHA" className="w-10 h-10 drop-shadow-lg" />
          <div>
            <h1 className="text-base font-bold tracking-[0.15em] text-brand-gold uppercase">SHESHA</h1>
            <p className="text-[9px] text-text-secondary tracking-wider uppercase">Mine Monitoring System</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 mt-1 overflow-y-auto">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => handleTabClick(tab)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all duration-200 flex items-center space-x-2.5 ${
                activeTab === tab
                  ? 'bg-brand-gold/10 text-brand-gold font-medium border border-brand-gold/30'
                  : 'text-text-secondary hover:bg-elevated hover:text-text-main border border-transparent'
              }`}
            >
              {tab === 'Command Center' && <Activity className="w-4 h-4 shrink-0" />}
              {tab === 'History' && <HistoryIcon className="w-4 h-4 shrink-0" />}
              {tab === 'Intelligence' && <Cpu className="w-4 h-4 shrink-0" />}
              {tab === 'Nodes' && <Info className="w-4 h-4 shrink-0" />}
              {tab === 'Configuration' && <Settings className="w-4 h-4 shrink-0" />}
              <span>{tab}</span>
            </button>
          ))}
        </nav>
        
        <div className="p-3 border-t border-border/50 bg-background/30">
          <h3 className="text-[10px] font-bold text-text-secondary mb-2 uppercase tracking-wider px-1">Active Nodes</h3>
          <div className="space-y-1">
            {Object.keys(liveData).sort().map(nodeId => {
              const state = liveData[nodeId].risk.level;
              const stateColors: Record<string, string> = {
                'STABLE': 'bg-status-stable shadow-[0_0_6px_rgba(16,185,129,0.5)]',
                'WATCH': 'bg-status-watch shadow-[0_0_6px_rgba(245,158,11,0.5)]',
                'CRITICAL': 'bg-status-critical shadow-[0_0_6px_rgba(239,68,68,0.5)]',
                'CALIBRATING': 'bg-telemetry-blue shadow-[0_0_6px_rgba(59,130,246,0.5)]',
              };
              const indicatorColor = stateColors[state] || 'bg-text-secondary';
              const isCritical = state === 'CRITICAL';

              return (
                <button
                  key={nodeId}
                  onClick={() => { setSelectedNode(nodeId); handleTabClick('Command Center'); }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-all duration-200 text-xs ${
                    selectedNode === nodeId
                      ? 'bg-elevated border border-border/60'
                      : 'hover:bg-elevated border border-transparent'
                  } ${isCritical ? 'animate-pulse' : ''}`}
                >
                  <span className={`font-mono font-medium ${selectedNode === nodeId ? 'text-brand-gold' : 'text-text-main'}`}>{nodeId}</span>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] text-text-secondary font-mono">{state}</span>
                    <span className={`w-2 h-2 rounded-full ${indicatorColor}`} />
                  </div>
                </button>
              );
            })}
            {Object.keys(liveData).length === 0 && (
              <div className="text-[10px] text-text-secondary italic px-1">AWAITING TELEMETRY</div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-12 bg-surface border-b border-border/50 flex items-center px-5 justify-between shrink-0">
          <h2 className="text-sm font-bold tracking-widest text-text-main uppercase">
            {drillDownParam
              ? <><span className="text-brand-gold">{activeTab}</span> <span className="text-text-secondary mx-1">/</span> {drillDownParam}</>
              : <span className="text-brand-gold">{activeTab}</span>
            }
          </h2>
          <div className="flex items-center space-x-4 text-[10px] font-mono tracking-wider">
            {dataSource && (
              <span className="text-text-secondary flex items-center bg-elevated px-2.5 py-1 rounded-md border border-border/30">
                <span className="opacity-50 mr-1.5">DATA</span>
                <span className="text-status-watch font-bold">{dataSource}</span>
              </span>
            )}
            {selectedNode && (
              <span className="text-text-secondary flex items-center bg-elevated px-2.5 py-1 rounded-md border border-border/30">
                <span className="opacity-50 mr-1.5">NODE</span>
                <span className="text-brand-gold font-bold">{selectedNode}</span>
              </span>
            )}
            <span className="text-text-main">{currentTime.toLocaleTimeString()}</span>
            <span className="flex items-center border border-border/30 px-2.5 py-1 rounded-full bg-elevated">
              <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${isConnected ? 'bg-status-stable shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'bg-status-critical shadow-[0_0_6px_rgba(239,68,68,0.6)]'}`} />
              {isConnected ? 'LIVE' : 'DISCONNECTED'}
            </span>
          </div>
        </header>
        
        <main className="flex-1 p-4 bg-background overflow-y-auto">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}

export default App;




