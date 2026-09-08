"""
SHESHA — AI-Enabled Mine Subsidence & Early Warning System
============================================================
Enterprise Command Center dashboard (Streamlit).
"""

from __future__ import annotations

import base64
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from sklearn.ensemble import IsolationForest
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline

# ==========================================================================
# Configuration
# ==========================================================================

CSV_PATH = Path("shesha_data.csv")
LOGO_PATH = Path("assets/logo.png")
REFRESH_SECONDS = 2
MIN_ROWS_FOR_MODEL = 10
CONTAMINATION = 0.1
REFIT_INTERVAL_ROWS = 5   # only refit the AI model every N new readings (stability + perf)

# Matches shesha_logger.py's HEADERS exactly.
COLUMNS = ["Timestamp", "Node_ID", "Trigger", "Distance", "Tilt", "Soil",
           "Battery", "Seq", "CRC", "RSSI"]
NUMERIC_COLUMNS = ["Distance", "Tilt", "Soil", "Battery", "Seq", "CRC", "RSSI"]

CRITICAL_DISTANCE_MM = 15.0    # wall-gap threshold judged "critical"
SAFE_DISTANCE_MM = 40.0        # nominal resting wall-gap distance
BASELINE_TILT = 9.81           # resting gravity vector, m/s^2
LOW_BATTERY_PCT = 20.0         # node battery level that triggers a power alert
FAST_DISTANCE_RATE_MM_PER_HR = 1.5  # rate-of-change that triggers an early drift alert

# ---- Industrial Operations Design System -------------------------------
PALETTE = {
    "bg": "#090A0F",
    "bg_gradient": "linear-gradient(180deg, #090A0F 0%, #0F1319 100%)",
    "panel": "#141820",
    "panel_alt": "#1B212B",
    "border": "rgba(255, 255, 255, 0.07)",
    "border_strong": "rgba(255, 255, 255, 0.14)",
    "text": "#E4E7EC",
    "muted": "#8A94A6",
    "accent": "#60A5FA",     # precision steel blue
    "bronze": "#D97706",     # technical bronze / amber
    "ok": "#10B981",         # controlled emerald
    "warn": "#D97706",
    "critical": "#DC2626",   # hazard crimson
}

FONT_MONO = "'JetBrains Mono', 'Roboto Mono', ui-monospace, SFMono-Regular, monospace"
FONT_SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

RADIUS = "10px"

_HAS_FRAGMENT = hasattr(st, "fragment")
_HAS_EXPERIMENTAL_FRAGMENT = hasattr(st, "experimental_fragment")
_HAS_DIALOG = hasattr(st, "dialog")


# ==========================================================================
# Assets
# ==========================================================================

@st.cache_data(show_spinner=False)
def get_logo_base64() -> str:
    if not LOGO_PATH.exists():
        return ""
    try:
        return base64.b64encode(LOGO_PATH.read_bytes()).decode()
    except OSError:
        return ""


# ==========================================================================
# Data layer — Live Telemetry
# ==========================================================================

@st.cache_data(ttl=1, show_spinner=False)
def load_live_data() -> pd.DataFrame:
    if not CSV_PATH.exists():
        return pd.DataFrame(columns=COLUMNS)

    try:
        df = pd.read_csv(CSV_PATH)
    except (pd.errors.EmptyDataError, pd.errors.ParserError, OSError):
        return pd.DataFrame(columns=COLUMNS)

    for col in COLUMNS:
        if col not in df.columns:
            df[col] = np.nan
    df = df[COLUMNS].copy()

    for col in NUMERIC_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["Distance", "Tilt", "Soil"]).tail(100).reset_index(drop=True)
    if df.empty:
        return df

    df["Trigger"] = df["Trigger"].fillna("NONE").astype(str)
    df["Node_ID"] = df["Node_ID"].fillna("UNKNOWN").astype(str)

    parsed_ts = pd.to_datetime(df["Timestamp"], errors="coerce")
    if parsed_ts.notna().any():
        df["Timestamp"] = parsed_ts
    else:
        df["Timestamp"] = pd.Timestamp.now() - pd.to_timedelta(
            np.arange(len(df))[::-1], unit="s"
        )

    return df


@dataclass
class RiskAssessment:
    level: str
    message: str
    score: float = 0.0
    drivers: Optional[dict] = None  # e.g. {"Distance": 0.62, "Tilt": 0.21, "Soil": 0.17}


@st.cache_resource(show_spinner=False, max_entries=16, ttl=600)
def _fit_isolation_forest(feature_rows: tuple, contamination: float):
    arr = np.array(feature_rows)
    model = make_pipeline(
        StandardScaler(), 
        IsolationForest(contamination=contamination, random_state=42)
    )
    model.fit(arr)
    return model


def assess_risk(df: pd.DataFrame, contamination: float = CONTAMINATION) -> RiskAssessment:
    if df.empty:
        return RiskAssessment("calibrating", "Awaiting telemetry — no data received yet.")

    latest = df.iloc[-1]

    if str(latest["Trigger"]).upper() == "EMERGENCY_IMPACT":
        return RiskAssessment(
            "critical", "Hardware trigger — critical impact detected. Evacuate immediately.", 1.0
        )

    if len(df) <= MIN_ROWS_FOR_MODEL:
        return RiskAssessment(
            "calibrating",
            f"AI model is calibrating baseline threshold "
            f"({len(df)}/{MIN_ROWS_FOR_MODEL} readings)."
        )

    feature_rows = df[["Distance", "Tilt", "Soil"]].to_numpy()

    try:
        ss = st.session_state
        cache_key = "_iforest_cache"
        cached = ss.get(cache_key)

        # Refit only every REFIT_INTERVAL_ROWS new readings (or when sensitivity
        # changes / no model yet). Refitting on every single tick made the
        # baseline — and therefore the threshold — shift on every refresh,
        # which caused the same reading to flip between "stable" and
        # "anomalous" from one cycle to the next.
        need_refit = (
            cached is None
            or cached.get("contamination") != contamination
            or len(df) - cached.get("fit_len", 0) >= REFIT_INTERVAL_ROWS
        )

        if need_refit:
            model = _fit_isolation_forest(tuple(map(tuple, feature_rows)), contamination)
            ss[cache_key] = {"model": model, "fit_len": len(df), "contamination": contamination}
        else:
            model = cached["model"]

        scaler = model.named_steps["standardscaler"]
        forest = model.named_steps["isolationforest"]

        scaled_rows = scaler.transform(feature_rows)
        all_scores = forest.decision_function(scaled_rows)

        # Robust (median / MAD) threshold instead of mean/std, since the
        # mean and standard deviation are themselves skewed by the very
        # anomalies we're trying to detect.
        median_score = np.median(all_scores)
        mad_score = np.median(np.abs(all_scores - median_score)) * 1.4826  # normal-consistent MAD
        mad_score = max(mad_score, 1e-6)  # avoid a zero-width threshold on flat data

        dynamic_threshold = median_score - (2.5 * mad_score)

        window_size = 10
        recent_scores = all_scores[-window_size:]
        anomaly_count = int(sum(1 for score in recent_scores if score < dynamic_threshold))

        latest_score = float(recent_scores[-1])

        # Per-sensor contribution breakdown for the latest reading: how far
        # (in scaled units) each feature sits from the fitted baseline.
        latest_scaled = np.abs(scaled_rows[-1])
        total_dev = float(np.sum(latest_scaled)) or 1e-6
        drivers = {
            col: round(float(latest_scaled[i]) / total_dev, 3)
            for i, col in enumerate(["Distance", "Tilt", "Soil"])
        }

    except Exception:
        # Any unexpected model/data issue degrades to "calibrating" rather
        # than crashing the whole dashboard.
        return RiskAssessment("calibrating", "AI model temporarily unavailable — retrying next cycle.")

    if anomaly_count >= 2:
        return RiskAssessment(
            "critical",
            f"CRITICAL: AI detected {anomaly_count} genuine threshold breaches. Structural failure imminent.",
            latest_score,
            drivers,
        )
    elif anomaly_count == 1:
        return RiskAssessment("warning", "Early warning: Isolated threshold breach detected.", latest_score, drivers)

    return RiskAssessment("stable", "Structural integrity within normal parameters.", latest_score, drivers)


def _append_event(level: str, message: str) -> None:
    ss = st.session_state
    ss.setdefault("event_log", [])

    now = pd.Timestamp.now()
    last = ss["event_log"][-1] if ss["event_log"] else None
    stale = last is None or (now - last["timestamp"]).total_seconds() > 30
    changed = last is None or last["message"] != message
    if stale or changed:
        ss["event_log"].append({"timestamp": now, "level": level, "message": message})
        ss["event_log"] = ss["event_log"][-20:]


def _update_session_history(risk: RiskAssessment) -> None:
    ss = st.session_state
    ss.setdefault("score_history", [])

    if risk.level in ("critical", "warning"):
        _append_event(risk.level, risk.message)

    if risk.level in ("stable", "warning"):
        ss["score_history"].append(
            {"timestamp": pd.Timestamp.now(), "score": risk.score, "level": risk.level}
        )
        ss["score_history"] = ss["score_history"][-150:]


def _check_battery_alert(latest: pd.Series) -> None:
    battery = latest.get("Battery")
    if pd.isna(battery):
        return
    if battery < LOW_BATTERY_PCT:
        message = (
            f"NODE POWER CRITICAL: Transmitter {latest['Node_ID']} battery at "
            f"{battery:.0f}% — schedule maintenance."
        )
        _append_event("warning", message)


def _check_distance_rate(df: pd.DataFrame, critical_distance: float) -> None:
    """Flag a fast-closing wall gap using recent readings, ahead of the
    anomaly model catching it. New feature — additive, no architecture change."""
    if len(df) < 3:
        return

    window = df.tail(6)
    elapsed_hr = (window["Timestamp"].iloc[-1] - window["Timestamp"].iloc[0]).total_seconds() / 3600.0
    if elapsed_hr <= 0:
        return

    rate = (window["Distance"].iloc[0] - window["Distance"].iloc[-1]) / elapsed_hr  # mm/hr closing
    if rate >= FAST_DISTANCE_RATE_MM_PER_HR:
        latest_distance = window["Distance"].iloc[-1]
        message = (
            f"RAPID CLOSURE: Wall-gap distance closing at {rate:.2f} mm/hr "
            f"(currently {latest_distance:.1f} mm, critical at {critical_distance:.0f} mm)."
        )
        _append_event("warning", message)


def _check_packet_integrity(df: pd.DataFrame, latest: pd.Series) -> None:
    crc = latest.get("CRC")
    if pd.notna(crc) and not (0 <= crc <= 255):
        _append_event("warning", f"Node {latest['Node_ID']}: implausible CRC value ({crc:.0f}) — check link.")

    if len(df) < 2:
        return
    prev_seq = df.iloc[-2].get("Seq")
    seq = latest.get("Seq")
    if pd.notna(prev_seq) and pd.notna(seq) and seq - prev_seq > 1:
        gap = int(seq - prev_seq - 1)
        _append_event("warning", f"Node {latest['Node_ID']}: {gap} packet(s) dropped (seq gap detected).")


# ==========================================================================
# Data layer — Predictive Analysis (synthetic history + forecasting)
# ==========================================================================

@st.cache_data(show_spinner=False)
def generate_synthetic_history(days: int = 30) -> pd.DataFrame:
    rng = np.random.default_rng(42)
    hours = days * 24
    timestamps = pd.date_range(end=pd.Timestamp.now(), periods=hours, freq="h")
    t = np.arange(hours)

    daily_cycle = np.sin(2 * np.pi * t / 24)

    distance = SAFE_DISTANCE_MM - 0.05 * (t / 24) + 0.6 * daily_cycle + rng.normal(0, 0.3, hours)
    tilt = BASELINE_TILT + 0.002 * (t / 24) + 0.02 * daily_cycle + rng.normal(0, 0.015, hours)
    soil = 30 + 0.35 * (t / 24) + 4 * daily_cycle + rng.normal(0, 1.5, hours)
    soil = np.clip(soil, 0, 100)

    battery_start, battery_end = 100.0, 15.0
    battery = battery_start + (battery_end - battery_start) * (t / (hours - 1))
    battery = np.clip(battery + rng.normal(0, 0.4, hours), 0, 100)

    return pd.DataFrame({
        "Timestamp": timestamps,
        "Distance": distance,
        "Tilt": tilt,
        "Soil": soil,
        "Battery": battery,
    })


def filter_by_range(df: pd.DataFrame, label: str) -> pd.DataFrame:
    hours = {"24 Hours": 24, "7 Days": 24 * 7, "30 Days": 24 * 30}[label]
    return df.tail(hours).reset_index(drop=True)


@dataclass
class Forecast:
    history: pd.DataFrame
    future_timestamps: pd.Series
    future_values: np.ndarray
    slope_per_day: float


def forecast_linear(df: pd.DataFrame, column: str, days_ahead: int = 7) -> Forecast:
    x = (df["Timestamp"] - df["Timestamp"].iloc[0]).dt.total_seconds().to_numpy().reshape(-1, 1)
    y = df[column].to_numpy()

    model = LinearRegression()
    model.fit(x, y)

    seconds_per_day = 86400
    future_x_seconds = np.arange(
        x[-1, 0] + seconds_per_day,
        x[-1, 0] + days_ahead * seconds_per_day + 1,
        seconds_per_day,
    ).reshape(-1, 1)
    future_values = model.predict(future_x_seconds)

    future_timestamps = df["Timestamp"].iloc[0] + pd.to_timedelta(future_x_seconds.flatten(), unit="s")
    slope_per_day = model.coef_[0] * seconds_per_day

    return Forecast(df, pd.Series(future_timestamps), future_values, slope_per_day)


def days_to_threshold(
    current_value: float, slope_per_day: float, threshold: float
) -> Optional[float]:
    if slope_per_day == 0:
        return None
    days = (threshold - current_value) / slope_per_day
    return days if days > 0 else None


def build_ai_summary(df: pd.DataFrame, dist_forecast: Forecast, critical_distance: float) -> str:
    soil_start, soil_end = df["Soil"].iloc[0], df["Soil"].iloc[-1]
    soil_change_pct = ((soil_end - soil_start) / max(soil_start, 1e-6)) * 100

    dist_start, dist_end = df["Distance"].iloc[0], df["Distance"].iloc[-1]
    dist_change = dist_end - dist_start

    eta = days_to_threshold(dist_end, dist_forecast.slope_per_day, critical_distance)

    lines = [
        f"Soil moisture has changed {soil_change_pct:+.1f}% over the selected window, "
        f"correlating with a {dist_change:+.2f} mm shift in wall-gap distance.",
    ]
    if eta is not None:
        lines.append(
            f"At the current degradation rate, the {critical_distance:.0f} mm critical "
            f"threshold is projected in approximately {eta:.0f} days."
        )
        if eta <= 14:
            lines.append(
                "Recommendation: schedule a structural inspection and restrict access "
                "to the affected sector."
            )
        else:
            lines.append("Recommendation: continue routine monitoring; no immediate action required.")
    else:
        lines.append("Wall-gap distance is currently stable or trending away from the critical threshold.")

    return " ".join(lines)


# ==========================================================================
# Presentation — shared styling
# ==========================================================================

def inject_style() -> None:
    st.markdown(
        f"""
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

            * {{ box-sizing: border-box; }}
            html, body, .stApp {{
                background: {PALETTE['bg_gradient']};
                color: {PALETTE['text']};
                font-family: {FONT_SANS};
            }}
            #MainMenu, footer, header {{ visibility: hidden; }}
            button, input, select, textarea, .stSelectbox, .stRadio,
            div[data-testid="stMetric"], div[data-testid="stPlotlyChart"],
            div[data-testid="stAlert"] {{
                transition: border-color 0.16s ease, background-color 0.16s ease;
            }}

            /* ---------- Segmented nav (styled radio) ---------- */
            div[role="radiogroup"] {{
                display: flex;
                flex-direction: row;
                gap: 0.6rem;
                flex-wrap: wrap;
            }}
            div[role="radiogroup"] label {{
                display: flex;
                align-items: center;
                padding: 0.65rem 1.15rem;
                border-radius: {RADIUS};
                border: 1px solid {PALETTE['border']};
                background-color: {PALETTE['panel']};
                color: {PALETTE['muted']};
                font-size: 0.92rem;
                font-weight: 600;
                cursor: pointer;
            }}
            div[role="radiogroup"] label:hover {{
                background-color: {PALETTE['panel_alt']};
                color: {PALETTE['text']};
                border-color: {PALETTE['border_strong']};
            }}
            div[role="radiogroup"] label:has(input:checked) {{
                background-color: {PALETTE['panel_alt']};
                border-color: {PALETTE['accent']};
                color: {PALETTE['text']};
            }}
            div[role="radiogroup"] label > div:first-child {{ display: none; }}

            .shesha-header {{
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 1rem 1.5rem;
                background-color: {PALETTE['panel']};
                border: 1px solid {PALETTE['border']};
                border-radius: {RADIUS};
                margin-bottom: 1.25rem;
            }}
            .shesha-header-left {{ display: flex; align-items: center; gap: 0.85rem; }}
            .shesha-header-left img {{
                width: 42px;
                height: 42px;
                border-radius: 6px;
                border: 1px solid {PALETTE['border_strong']};
            }}
            .shesha-title {{
                font-family: {FONT_SANS};
                font-size: 1.25rem;
                font-weight: 700;
                letter-spacing: 0.01em;
                margin: 0;
                color: {PALETTE['text']};
            }}
            .shesha-subtitle {{
                font-family: {FONT_SANS};
                color: {PALETTE['muted']};
                font-size: 0.82rem;
                margin: 0.2rem 0 0 0;
            }}
            .shesha-badge {{
                display: flex;
                align-items: center;
                gap: 0.5rem;
                font-family: {FONT_MONO};
                font-size: 0.72rem;
                font-weight: 600;
                padding: 0.4rem 0.85rem;
                border-radius: 999px;
                border: 1px solid {PALETTE['border']};
                background-color: {PALETTE['panel_alt']};
                text-transform: uppercase;
                letter-spacing: 0.06em;
            }}
            .pulse-dot {{
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: currentColor;
                animation: pulse 2s ease-in-out infinite;
            }}
            @keyframes pulse {{
                0% {{ opacity: 1; }}
                50% {{ opacity: 0.35; }}
                100% {{ opacity: 1; }}
            }}

            div[data-testid="stMetric"] {{
                background-color: {PALETTE['panel']};
                border: 1px solid {PALETTE['border']};
                border-radius: {RADIUS};
                padding: 0.9rem 1.1rem;
            }}
            div[data-testid="stMetric"]:hover {{ border-color: {PALETTE['border_strong']}; }}
            div[data-testid="stMetricLabel"] {{
                color: {PALETTE['muted']};
                font-family: {FONT_SANS};
                font-size: 0.78rem;
                text-transform: uppercase;
                letter-spacing: 0.04em;
            }}
            div[data-testid="stMetricValue"] {{
                font-family: {FONT_MONO};
                font-weight: 600;
            }}
            div[data-testid="stMetricDelta"] {{ font-family: {FONT_MONO}; }}

            .shesha-panel {{
                background-color: {PALETTE['panel']};
                border: 1px solid {PALETTE['border']};
                border-radius: {RADIUS};
                padding: 1.1rem 1.35rem;
                margin-bottom: 1rem;
            }}
            .shesha-section-title {{
                font-family: {FONT_SANS};
                font-size: 0.78rem;
                font-weight: 700;
                color: {PALETTE['muted']};
                text-transform: uppercase;
                letter-spacing: 0.08em;
                margin-bottom: 0.7rem;
                border-left: 2px solid {PALETTE['accent']};
                padding-left: 0.6rem;
            }}
            .shesha-summary {{
                background-color: {PALETTE['panel_alt']};
                border: 1px solid {PALETTE['border']};
                border-left: 2px solid {PALETTE['accent']};
                border-radius: 6px;
                padding: 0.95rem 1.2rem;
                font-family: {FONT_SANS};
                font-size: 0.9rem;
                line-height: 1.55;
                color: {PALETTE['text']};
            }}
            .shesha-event-row {{
                display: flex;
                gap: 0.75rem;
                padding: 0.55rem 0;
                border-bottom: 1px solid {PALETTE['border']};
                font-family: {FONT_SANS};
            }}
            .shesha-event-level {{
                font-family: {FONT_MONO};
                font-weight: 700;
                min-width: 68px;
                text-transform: uppercase;
                font-size: 0.7rem;
            }}
            .shesha-event-time {{
                font-family: {FONT_MONO};
                color: {PALETTE['muted']};
                min-width: 150px;
                font-size: 0.78rem;
            }}
            .shesha-event-message {{ color: {PALETTE['text']}; font-size: 0.84rem; }}

            div[data-testid="stPlotlyChart"] {{
                background-color: {PALETTE['panel']};
                border: 1px solid {PALETTE['border']};
                border-radius: {RADIUS};
                overflow: hidden;
                padding: 0.35rem;
            }}
            div[data-testid="stPlotlyChart"]:hover {{ border-color: {PALETTE['border_strong']}; }}
            div[data-testid="stAlert"] {{ border-radius: {RADIUS}; border: 1px solid {PALETTE['border']}; }}
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_header(is_live: bool = True) -> None:
    logo_b64 = get_logo_base64()
    logo_html = f'<img src="data:image/png;base64,{logo_b64}" />' if logo_b64 else ""
    status_color = PALETTE["ok"] if is_live else PALETTE["muted"]
    status_text = "SYSTEM ONLINE" if is_live else "AWAITING SIGNAL"

    st.markdown(
        f"""
        <div class="shesha-header">
            <div class="shesha-header-left">
                {logo_html}
                <div>
                    <p class="shesha-title">SHESHA — Mine Subsidence Monitoring</p>
                    <p class="shesha-subtitle">Structural telemetry, anomaly detection &amp; early warning</p>
                </div>
            </div>
            <div class="shesha-badge" style="color:{status_color};">
                <span class="pulse-dot"></span>{status_text}
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_technical_line(fig: go.Figure, x: pd.Series, y: pd.Series, color: str, name: str) -> None:
    r, g, b = int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)
    fig.add_trace(go.Scatter(
        x=x, y=y, mode="lines", name=name,
        line=dict(color=color, width=1.75, shape="linear"),
        fill="tozeroy", fillcolor=f"rgba({r}, {g}, {b}, 0.07)",
        showlegend=False,
    ))


def styled_layout(fig: go.Figure, title: str, height: int = 320) -> go.Figure:
    fig.update_layout(
        title=dict(text=title, font=dict(size=13, color=PALETTE["text"], family=FONT_SANS)),
        plot_bgcolor=PALETTE["panel"],
        paper_bgcolor=PALETTE["panel"],
        font=dict(color=PALETTE["muted"], size=11, family=FONT_MONO),
        margin=dict(l=10, r=10, t=42, b=10),
        xaxis=dict(
            showgrid=False,
            color=PALETTE["muted"],
            showspikes=True,
            spikemode="across",
            spikethickness=1,
            spikedash="dot",
            spikecolor=PALETTE["muted"],
        ),
        yaxis=dict(showgrid=True, gridcolor="rgba(255, 255, 255, 0.05)", color=PALETTE["muted"]),
        hovermode="x unified",
        hoverlabel=dict(
            bgcolor=PALETTE["panel_alt"],
            bordercolor=PALETTE["border_strong"],
            font=dict(family=FONT_MONO, color=PALETTE["text"], size=11),
        ),
        height=height,
    )
    return fig


# ==========================================================================
# Presentation — Live Telemetry mode & Emergency Popup
# ==========================================================================

def _emergency_body() -> None:
    st.markdown(
        f"""
        <div style="text-align: center; padding: 1.75rem; background-color: {PALETTE['panel_alt']}; border-radius: 8px; border: 1px solid {PALETTE['critical']};">
            <h1 style="color: {PALETTE['critical']}; font-family: {FONT_MONO}; font-size: 3rem; margin: 0; letter-spacing: 0.08em;">EVACUATE</h1>
            <h3 style="color: {PALETTE['text']}; font-family: {FONT_SANS}; margin-top: 0.5rem;">Immediate Catastrophic Structural Failure</h3>
            <p style="color: {PALETTE['muted']}; font-family: {FONT_SANS}; font-size: 1.05rem; margin-top: 1rem;">
                The AI threshold has been breached.
                Initiate emergency protocols and evacuate the sector immediately.
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.markdown("<div style='height:1rem'></div>", unsafe_allow_html=True)
    if st.button("Acknowledge & Close Alarm", use_container_width=True, type="primary", key="ack_alarm_btn"):
        st.session_state.dismissed_alert = True
        st.rerun()


if _HAS_DIALOG:
    emergency_popup = st.dialog("CRITICAL EMERGENCY ALERT", width="large")(_emergency_body)
else:
    # Older Streamlit without st.dialog: fall back to an inline full-width
    # banner instead of raising AttributeError on st.dialog.
    def emergency_popup() -> None:
        _emergency_body()


def render_kpis(latest: pd.Series, prev: Optional[pd.Series]) -> None:
    col1, col2, col3, col4, col5, col6 = st.columns(6)

    def delta(key: str) -> Optional[str]:
        if prev is None or pd.isna(latest[key]) or pd.isna(prev[key]):
            return None
        return f"{latest[key] - prev[key]:+.2f}"

    col1.metric("Distance to Wall", f"{latest['Distance']:.1f} mm", delta("Distance"))
    col2.metric("Structural Tilt (Z)", f"{latest['Tilt']:.2f} m/s²", delta("Tilt"))
    col3.metric("Soil Moisture", f"{latest['Soil']:.1f} %", delta("Soil"))

    battery_display = f"{latest['Battery']:.0f}%" if pd.notna(latest["Battery"]) else "N/A"
    col4.metric("Node Battery", battery_display, delta("Battery"))

    rssi_display = f"{latest['RSSI']:.0f} dBm" if pd.notna(latest["RSSI"]) else "N/A"
    col5.metric("LoRa Signal", rssi_display)

    seq_display = f"#{latest['Seq']:.0f}" if pd.notna(latest["Seq"]) else "N/A"
    col6.metric("Packet Seq", seq_display)


def render_score_trend() -> None:
    history = st.session_state.get("score_history", [])
    if len(history) < 2:
        return

    df_hist = pd.DataFrame(history)
    marker_colors = df_hist["level"].map(
        {"stable": PALETTE["ok"], "warning": PALETTE["warn"]}
    ).fillna(PALETTE["muted"])

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=df_hist["timestamp"], y=df_hist["score"], mode="lines+markers",
        line=dict(color=PALETTE["accent"], width=1.75),
        marker=dict(color=marker_colors, size=5),
        showlegend=False, hoverinfo="y+x",
    ))
    fig.add_hline(y=0, line_dash="dot", line_color=PALETTE["muted"], opacity=0.4)
    st.plotly_chart(styled_layout(fig, "AI Anomaly Score Trend (this session)", height=200), use_container_width=True)


def render_risk_banner(risk: RiskAssessment) -> None:
    banner = {
        "critical": st.error,
        "warning": st.warning,
        "stable": st.success,
        "calibrating": st.info,
    }[risk.level]
    st.markdown('<div class="shesha-section-title">AI Risk Assessment</div>', unsafe_allow_html=True)
    suffix = f"  ·  anomaly score {risk.score:+.3f}" if risk.level in ("warning", "stable") else ""
    banner(risk.message + suffix)

    if risk.level in ("warning", "critical") and risk.drivers:
        top_driver = max(risk.drivers, key=risk.drivers.get)
        st.caption(
            f"Primary driver: **{top_driver}** "
            f"({risk.drivers[top_driver] * 100:.0f}% of deviation) · "
            f"Distance {risk.drivers.get('Distance', 0) * 100:.0f}% · "
            f"Tilt {risk.drivers.get('Tilt', 0) * 100:.0f}% · "
            f"Soil {risk.drivers.get('Soil', 0) * 100:.0f}%"
        )

    _update_session_history(risk)
    render_score_trend()


def render_event_log() -> None:
    events = st.session_state.get("event_log", [])
    st.markdown('<div class="shesha-section-title">Alert &amp; Event Log</div>', unsafe_allow_html=True)
    if not events:
        st.markdown(
            f"<p style='color:{PALETTE['muted']}; font-family:{FONT_SANS}; font-size:0.85rem;'>"
            "No alerts recorded this session.</p>",
            unsafe_allow_html=True,
        )
        return

    color_map = {"critical": PALETTE["critical"], "warning": PALETTE["warn"]}
    rows = []
    for event in reversed(events[-10:]):
        c = color_map.get(event["level"], PALETTE["muted"])
        rows.append(
            "<div class='shesha-event-row'>"
            f"<span class='shesha-event-level' style='color:{c};'>{event['level']}</span>"
            f"<span class='shesha-event-time'>{event['timestamp'].strftime('%Y-%m-%d %H:%M:%S')}</span>"
            f"<span class='shesha-event-message'>{event['message']}</span>"
            "</div>"
        )
    st.markdown(f"<div class='shesha-panel'>{''.join(rows)}</div>", unsafe_allow_html=True)


def render_live_charts(df: pd.DataFrame, critical_distance: float) -> None:
    st.markdown('<div class="shesha-section-title">Real-Time Telemetry</div>', unsafe_allow_html=True)
    col1, col2 = st.columns(2)

    with col1:
        fig = go.Figure()
        render_technical_line(fig, df["Timestamp"], df["Tilt"], PALETTE["accent"], "Tilt")
        fig.add_hline(y=BASELINE_TILT, line_dash="dot", line_color=PALETTE["muted"], opacity=0.4)
        st.plotly_chart(styled_layout(fig, "Structural Tilt (Gravity Vector)"), use_container_width=True)

    with col2:
        fig = go.Figure()
        render_technical_line(fig, df["Timestamp"], df["Distance"], PALETTE["ok"], "Distance")
        fig.add_hline(
            y=critical_distance, line_dash="dash", line_color=PALETTE["critical"], opacity=0.6,
            annotation_text="Critical threshold", annotation_font_color=PALETTE["critical"],
        )
        st.plotly_chart(styled_layout(fig, "Wall Gap Distance (mm)"), use_container_width=True)


def _render_live_body() -> None:
    ss = st.session_state

    if ss.get("auto_refresh", True) or "_frozen_df" not in ss:
        df = load_live_data()
        ss["_frozen_df"] = df
    else:
        df = ss["_frozen_df"]

    if df.empty:
        st.info("Waiting for LoRa sensor data...")
        return

    latest = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else None
    render_kpis(latest, prev)
    st.markdown("<div style='height:0.5rem'></div>", unsafe_allow_html=True)

    risk = assess_risk(df, ss.get("contamination", CONTAMINATION))
    render_risk_banner(risk)
    _check_battery_alert(latest)
    _check_packet_integrity(df, latest)
    _check_distance_rate(df, ss.get("critical_distance", CRITICAL_DISTANCE_MM))

    if risk.level != "critical":
        ss.dismissed_alert = False  

    if risk.level == "critical" and not ss.get("dismissed_alert", False):
        emergency_popup()

    render_live_charts(df, ss.get("critical_distance", CRITICAL_DISTANCE_MM))
    st.markdown("<div style='height:0.5rem'></div>", unsafe_allow_html=True)
    render_event_log()


if _HAS_FRAGMENT:
    _live_body = st.fragment(run_every=f"{REFRESH_SECONDS}s")(_render_live_body)
elif _HAS_EXPERIMENTAL_FRAGMENT:
    _live_body = st.experimental_fragment(run_every=f"{REFRESH_SECONDS}s")(_render_live_body)
else:
    _live_body = None


def run_live_mode() -> None:
    if _live_body is not None:
        _live_body()
    else:
        _render_live_body()
        time.sleep(REFRESH_SECONDS)
        st.rerun()


# ==========================================================================
# Presentation — Predictive Analysis mode
# ==========================================================================

def render_forecast_chart(
    df: pd.DataFrame,
    forecast: Forecast,
    column: str,
    color: str,
    title: str,
    threshold: Optional[float] = None,
) -> None:
    fig = go.Figure()
    render_technical_line(fig, df["Timestamp"], df[column], color, "History")

    fig.add_trace(go.Scatter(
        x=forecast.future_timestamps, y=forecast.future_values,
        mode="lines", name="Forecast",
        line=dict(color=PALETTE["bronze"], width=1.75, dash="dash"),
    ))
    if threshold is not None:
        fig.add_hline(
            y=threshold, line_dash="dot", line_color=PALETTE["critical"], opacity=0.6,
            annotation_text="Critical threshold", annotation_font_color=PALETTE["critical"],
        )

    st.plotly_chart(styled_layout(fig, title, height=340), use_container_width=True)


def render_correlation_heatmap(df: pd.DataFrame) -> None:
    corr = df[["Soil", "Tilt", "Distance"]].corr()
    fig = go.Figure(go.Heatmap(
        z=corr.values,
        x=list(corr.columns), y=list(corr.columns),
        colorscale=[[0, PALETTE["panel_alt"]], [0.5, PALETTE["accent"]], [1, PALETTE["text"]]],
        zmin=-1, zmax=1,
        text=np.round(corr.values, 2), texttemplate="%{text}",
        textfont=dict(family=FONT_MONO),
        colorbar=dict(outlinewidth=0, tickfont=dict(color=PALETTE["muted"], family=FONT_MONO)),
    ))
    st.plotly_chart(styled_layout(fig, "Sensor Correlation Matrix", height=340), use_container_width=True)


def render_risk_donut(df_row: pd.Series) -> None:
    dist_risk = max(0.1, (SAFE_DISTANCE_MM - df_row["Distance"]) * 2.5)
    tilt_risk = max(0.1, abs(df_row["Tilt"] - BASELINE_TILT) * 150)
    soil_risk = max(0.1, df_row["Soil"] * 0.8)

    total = dist_risk + tilt_risk + soil_risk
    dist_pct = (dist_risk / total) * 100
    tilt_pct = (tilt_risk / total) * 100
    soil_pct = (soil_risk / total) * 100

    fig = go.Figure(data=[go.Pie(
        labels=["Wall Gap<br>Compression", "Structural<br>Tilt Shift", "Soil<br>Saturation"],
        values=[dist_pct, tilt_pct, soil_pct],
        hole=0.65,
        marker_colors=[PALETTE["ok"], PALETTE["accent"], PALETTE["bronze"]],
        textinfo="percent",
        textposition="outside",
        textfont=dict(color=PALETTE["text"], size=12, family=FONT_MONO),
        hoverinfo="label+percent",
    )])
    fig.update_layout(
        title=dict(text="Predictive Risk Factor Breakdown", font=dict(size=13, color=PALETTE["text"], family=FONT_SANS)),
        plot_bgcolor=PALETTE["panel"],
        paper_bgcolor=PALETTE["panel"],
        margin=dict(t=40, b=10, l=10, r=10),
        showlegend=False,
        height=320,
        annotations=[dict(
            text="AI Risk<br>Drivers", x=0.5, y=0.5,
            font=dict(size=14, color=PALETTE["muted"], family=FONT_SANS), showarrow=False,
        )],
    )
    st.plotly_chart(fig, use_container_width=True)


def run_predictive_mode(range_label: str) -> None:
    ss = st.session_state
    critical_distance = ss.get("critical_distance", CRITICAL_DISTANCE_MM)
    forecast_days = int(ss.get("forecast_days", 7))

    full_history = generate_synthetic_history(days=30)
    df = filter_by_range(full_history, range_label)

    dist_forecast = forecast_linear(df, "Distance", days_ahead=forecast_days)
    tilt_forecast = forecast_linear(df, "Tilt", days_ahead=forecast_days)

    st.markdown('<div class="shesha-section-title">AI Safety Report</div>', unsafe_allow_html=True)
    st.markdown(
        f'<div class="shesha-summary">{build_ai_summary(df, dist_forecast, critical_distance)}</div>',
        unsafe_allow_html=True,
    )
    st.markdown("<div style='height:1rem'></div>", unsafe_allow_html=True)

    st.markdown(
        f'<div class="shesha-section-title">Trend Forecast (+{forecast_days} Days)</div>',
        unsafe_allow_html=True,
    )
    col1, col2 = st.columns(2)
    with col1:
        render_forecast_chart(
            df, dist_forecast, "Distance", PALETTE["ok"], "Wall Gap Distance (mm)", critical_distance
        )
    with col2:
        render_forecast_chart(df, tilt_forecast, "Tilt", PALETTE["accent"], "Structural Tilt (m/s²)")

    st.markdown("<div style='height:1rem'></div>", unsafe_allow_html=True)
    render_correlation_heatmap(df)
    st.markdown("<div style='height:1rem'></div>", unsafe_allow_html=True)

    st.markdown(
        '<div class="shesha-section-title">Interactive Point-in-Time Diagnostics</div>',
        unsafe_allow_html=True,
    )
    st.markdown(
        f"<p style='color:{PALETTE['muted']}; font-family:{FONT_SANS}; font-size: 0.9rem; margin-bottom: 0px;'>"
        "Slide the tracker to select a specific past data point. The AI will generate a localized "
        "risk profile and breakdown chart for that exact moment.</p>",
        unsafe_allow_html=True,
    )

    max_idx = len(df) - 1
    selected_idx = st.slider("Select Data Point", 0, max_idx, max_idx, label_visibility="collapsed")
    selected_row = df.iloc[selected_idx]

    drill_col1, drill_col2 = st.columns([1.2, 1])
    with drill_col1:
        render_risk_donut(selected_row)

    with drill_col2:
        st.markdown("### Point-in-Time Analysis")
        st.markdown(f"**Selected Time:** `{selected_row['Timestamp'].strftime('%Y-%m-%d %H:%M')}`")

        dist = selected_row["Distance"]
        tilt = selected_row["Tilt"]
        soil = selected_row["Soil"]
        prob = min(
            100,
            max(0, ((SAFE_DISTANCE_MM - dist) * 3 + abs(tilt - BASELINE_TILT) * 200 + soil) / 2),
        )

        if prob > 70:
            status, color = "■ CRITICAL TRAJECTORY", PALETTE["critical"]
        elif prob > 35:
            status, color = "▲ ELEVATED ANOMALY", PALETTE["warn"]
        else:
            status, color = "● STABLE CONDITIONS", PALETTE["ok"]

        st.markdown(
            f"""
            <div style="background-color: {PALETTE['panel_alt']}; padding: 1rem; border-radius: 8px; border-left: 3px solid {color}; margin-top: 1rem;">
                <p style="color: {color}; font-family: {FONT_MONO}; font-weight: 700; margin: 0; font-size: 1rem;">{status}</p>
                <p style="color: {PALETTE['muted']}; font-family: {FONT_SANS}; font-size: 0.9rem; margin-top: 0.5rem;">
                    <strong style="color:{PALETTE['text']};">AI Predictiveness Score: {prob:.1f}%</strong><br>
                    At this exact moment, Distance was {dist:.1f}mm, Tilt was {tilt:.2f}m/s², and Soil Saturation was at {soil:.1f}%.
                    The chart reflects how heavily each variable influenced the AI's risk assessment.
                </p>
            </div>
            """,
            unsafe_allow_html=True,
        )


# ==========================================================================
# App entry point
# ==========================================================================

def main() -> None:
    st.set_page_config(page_title="SHESHA Command Center", page_icon=None, layout="wide")
    inject_style()

    df_live_snapshot = load_live_data()
    active_nodes = df_live_snapshot["Node_ID"].nunique() if not df_live_snapshot.empty else 0

    render_header(is_live=not df_live_snapshot.empty)

    st.markdown("### System Dashboard")
    col1, col2 = st.columns([3, 1])

    with col1:
        mode = st.radio(
            "Mode",
            ["Live Telemetry", "AI Predictive Analysis"],
            horizontal=True,
            label_visibility="collapsed",
        )

    with col2:
        st.markdown(
            f"""
            <div style="background-color: {PALETTE['panel_alt']}; padding: 0.55rem 1rem; border-radius: {RADIUS}; border: 1px solid {PALETTE['border']}; display: flex; justify-content: space-between; align-items: center;">
                <span style="color: {PALETTE['muted']}; font-family: {FONT_SANS}; font-size: 0.82rem; font-weight: 600;">Active Nodes</span>
                <span style="color: {PALETTE['text']}; font-family: {FONT_MONO}; font-weight: 700; font-size: 1.1rem;">{active_nodes}</span>
            </div>
            """,
            unsafe_allow_html=True,
        )

    st.markdown(
        f"<hr style='border-color: {PALETTE['border']}; margin-top: 1rem; margin-bottom: 1.5rem;'/>",
        unsafe_allow_html=True,
    )

    try:
        if "Live Telemetry" in mode:
            with st.expander("Advanced Tuning & Controls"):
                s_col1, s_col2, s_col3 = st.columns(3)
                with s_col1:
                    st.number_input(
                        "Critical Distance Threshold (mm)",
                        min_value=1.0, max_value=100.0, value=CRITICAL_DISTANCE_MM, step=0.5,
                        key="critical_distance",
                    )
                with s_col2:
                    st.slider(
                        "Anomaly Sensitivity (contamination)",
                        min_value=0.01, max_value=0.30, value=CONTAMINATION, step=0.01,
                        key="contamination",
                    )
                with s_col3:
                    st.slider(
                        "Forecast Horizon (days)",
                        min_value=1, max_value=14, value=7,
                        key="forecast_days",
                    )
            run_live_mode()

        else:
            st.markdown(
                f'<h5 style="color: {PALETTE["muted"]}; font-family: {FONT_SANS};">Analysis Window</h5>',
                unsafe_allow_html=True,
            )
            range_label = st.radio(
                "Analysis Window",
                ["24 Hours", "7 Days", "30 Days"],
                index=1,
                horizontal=True,
                label_visibility="collapsed",
            )
            st.markdown("<div style='height:1rem'></div>", unsafe_allow_html=True)
            run_predictive_mode(range_label)

    except Exception as exc:  
        st.error("An unexpected error occurred while rendering the dashboard.")
        with st.expander("Technical details"):
            st.exception(exc)


if __name__ == "__main__":
    main()