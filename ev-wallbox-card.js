/**
 * EV Wallbox Custom Dashboard Card for Home Assistant
 * Version 5.0 - Dynamic Current-Session Graphing
 */

var LitElement = LitElement || Object.getPrototypeOf(customElements.get("ha-panel-lovelace"));
var html = LitElement.prototype.html;
var css = LitElement.prototype.css;

class EvWallboxCard extends LitElement {
    static get properties() {
        return {
            hass: {},
            config: {},
            _historyData: { type: Array },
            _localCharging: { type: Boolean },
            _localGreen: { type: Boolean },
            _localStatusText: { type: String }
        };
    }

    constructor() {
        super();
        this._historyData = [];
        this._localCharging = null;
        this._localGreen = null;
        this._localStatusText = null;
        this._sequenceTimeout = null;
        this._historyFetched = false;
    }

    firstUpdated() {
        this._fetchHistory();
        setInterval(() => this._fetchHistory(), 15 * 60 * 1000);
    }

    // Holt eine breite Datenbasis (18h), wird später intelligent gefiltert
    async _fetchHistory() {
        if (!this.hass || !this.config.charger_power) return;
        
        const hours = 18; // Großzügiger Puffer für sehr lange Ladevorgänge
        const start = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
        const end = new Date().toISOString();

        try {
            const response = await this.hass.callWS({
                type: 'history/history_during_period',
                start_time: start,
                end_time: end,
                minimal_response: true,
                no_attributes: true,
                entity_ids: [this.config.charger_power]
            });
            
            if (response && response[this.config.charger_power]) {
                this._historyData = response[this.config.charger_power].map(s => ({
                    state: parseFloat(s.s || s.state),
                    time: new Date(s.lu || s.last_changed).getTime()
                })).filter(p => !isNaN(p.state));
                this._historyFetched = true;
                this.requestUpdate();
            }
        } catch (e) {
            console.warn("EV Wallbox Card: WebSocket Historie fehlgeschlagen.", e);
        }
    }

    // Filtert die Historie exakt auf den JETZIGEN Ladevorgang
    _filterCurrentSession(history) {
        if (!history || history.length === 0) return [];
        
        // Wenn aktuell nicht geladen wird, zeigen wir einfach eine Nulllinie
        if (history[history.length - 1].state <= 0.1) {
            return [ { state: 0, time: Date.now() } ]; 
        }

        let startIndex = 0;
        
        // Rückwärts suchen: Wo fing der Ladevorgang an (Leistung ging von 0 auf >0)?
        for (let i = history.length - 1; i > 0; i--) {
            const pt = history[i];
            const prevPt = history[i-1];
            
            if (prevPt.state <= 0.1) {
                // Wir tolerieren kurze Einbrüche (z.B. Wolke bei PV). 
                // War es länger als 5 Minuten auf 0? Dann ist es ein neuer Start!
                const pauseDuration = pt.time - prevPt.time;
                if (pauseDuration > 5 * 60 * 1000) {
                    startIndex = i - 1; // Den Nullpunkt vor dem Start mitnehmen
                    break;
                }
            }
        }
        return history.slice(startIndex);
    }

    render() {
        if (!this.hass || !this.config) return html``;

        const stateConnected = this.hass.states[this.config.charger_connected];
        const stateEnergy = this.hass.states[this.config.charger_energy];
        const statePower = this.hass.states[this.config.charger_power];
        const stateStatus = this.hass.states[this.config.charger_status];
        const stateMode = this.hass.states[this.config.charger_mode_status];

        const connectedVal = stateConnected ? stateConnected.state : 'Ausgesteckt';
        const isConnected = connectedVal.toLowerCase() === 'eingesteckt' || connectedVal === 'on' || connectedVal === 'true';
        
        const energyVal = stateEnergy ? parseFloat(stateEnergy.state) : 0;
        const powerVal = statePower ? parseFloat(statePower.state) : 0;

        if (statePower && this._historyFetched) {
            const time = new Date(statePower.last_changed).getTime();
            const lastPoint = this._historyData[this._historyData.length - 1];
            if (!lastPoint || lastPoint.time !== time) {
                if (!isNaN(powerVal)) {
                    this._historyData.push({ state: powerVal, time: time });
                }
            }
        }

        let isGreenActive = stateMode ? (stateMode.state === 'PV Power') : false;
        if (this._localGreen !== null) { isGreenActive = this._localGreen; }

        let isCharging = powerVal > 0.1 || (stateStatus && (stateStatus.state.toLowerCase() === 'charging' || stateStatus.state.toLowerCase() === 'laden'));
        if (this._localCharging !== null) { isCharging = this._localCharging; }

        let statusText = stateStatus ? stateStatus.state : 'Standby';
        if (this._localStatusText !== null) { statusText = this._localStatusText; }

        const maxCapacity = parseFloat(this.config.max_capacity) || 77;
        const maxReach = parseFloat(this.config.max_reach) || 500;
        const maxPower = parseFloat(this.config.max_power) || 11;

        const pct = Math.min(100, Math.max(0, (energyVal / maxCapacity) * 100));
        const currentKm = Math.round((pct / 100) * maxReach);

        // Historie auf die aktuelle Session trimmen
        const sessionData = this._filterCurrentSession(this._historyData);

        return html`
            <ha-card class="wallbox-card">
                <!-- ZEILE 1: Liniengraph (Nur aktueller Ladevorgang) -->
                <div class="graph-track">
                    <div class="line-graph-container">
                        <svg viewBox="0 0 500 60" preserveAspectRatio="none" class="history-svg">
                            <path d="${this._generateHistoryPath(sessionData, maxPower, true)}" fill="${isCharging ? 'rgba(76, 175, 80, 0.15)' : 'rgba(255, 255, 255, 0.05)'}" stroke="none" />
                            <path d="${this._generateHistoryPath(sessionData, maxPower, false)}" fill="none" stroke="${isCharging ? '#4caf50' : 'rgba(255, 255, 255, 0.2)'}" stroke-width="2.5" />
                        </svg>
                    </div>
                    <div class="graph-value-label">${powerVal.toFixed(1).replace('.', ',')} kW</div>
                </div>

                <!-- ZEILE 2: Bargraph -->
                <div class="graph-track">
                    <div class="bar-graph-container">
                        <div class="bar-fill" style="width: ${pct}%;"></div>
                    </div>
                    <div class="graph-value-label">${energyVal.toFixed(1).replace('.', ',')} kWh</div>
                </div>

                <!-- Reichweiten & Prozent -->
                <div class="metrics-container">
                    <div class="primary-metrics">
                        <span class="value-large">${currentKm}</span>
                        <span class="unit-large">km</span>
                        <span class="separator">/</span>
                        <span class="value-percent">${pct.toFixed(0)}%</span>
                    </div>
                    <div class="secondary-metrics">
                        <span>LIMIT 100% / ≈ ${maxReach} km</span>
                    </div>
                </div>

                <!-- Steuerungs-Buttons -->
                <div class="controls-row">
                    <div class="pill-buttons-group">
                        <button class="btn-pill ${isConnected ? 'connected' : 'disconnected'}" @click=${() => this._handleButtonPress('plug')}>
                            <ha-icon icon="${isConnected ? 'mdi:ev-plug-type2' : 'mdi:power-plug-off'}"></ha-icon>
                        </button>
                        <button class="btn-pill mode-toggle ${isGreenActive ? 'eco' : 'full-power'}" @click=${() => this._handleButtonPress('mode', isGreenActive)}>
                            <ha-icon icon="${isGreenActive ? 'mdi:leaf' : 'mdi:leaf-off'}"></ha-icon>
                        </button>
                        <button class="btn-pill action-toggle ${isCharging ? 'charging' : 'idle'}" @click=${() => this._handleButtonPress('charge', isCharging)}>
                            <ha-icon icon="${isCharging ? 'mdi:stop' : 'mdi:play'}"></ha-icon>
                        </button>
                    </div>
                    <div class="status-label-container">
                        <span class="status-text">${statusText}</span>
                    </div>
                </div>
            </ha-card>
        `;
    }

    _generateHistoryPath(history, maxPower, isArea = false) {
        if (!history || history.length < 2) {
            return isArea ? 'M 0,60 L 500,60 L 0,60 Z' : 'M 0,55 L 500,55';
        }

        const width = 500;
        const height = 60;
        const padding = 6;
        const usableHeight = height - (padding * 2);

        const now = Date.now();
        
        // Dauer des aktuellen Ladevorgangs berechnen (Minimum 30 Min, damit es gut aussieht)
        const sessionDuration = now - history[0].time;
        const timeRange = Math.max(sessionDuration, 30 * 60 * 1000); 
        const minTime = now - timeRange;

        let points = [];

        // Wenn der Graph z.B. nur 10 Min an Daten hat, füllen wir links mit 0 kW auf
        if (history[0].time > minTime) {
            points.push(`0,${height - padding}`);
            const firstX = ((history[0].time - minTime) / timeRange) * width;
            points.push(`${firstX},${height - padding}`);
        }

        history.forEach((point) => {
            let x = ((point.time - minTime) / timeRange) * width;
            x = Math.max(0, Math.min(width, x)); 
            const factor = Math.min(1, Math.max(0, point.state / maxPower));
            const y = height - padding - (factor * usableHeight);
            points.push(`${x},${y}`);
        });

        const lastPoint = history[history.length - 1];
        const factor = Math.min(1, Math.max(0, lastPoint.state / maxPower));
        const y = height - padding - (factor * usableHeight);
        points.push(`${width},${y}`);

        if (isArea) {
            return `M ${points.join(' L ')} L ${width},${height} L 0,${height} Z`;
        } else {
            return `M ${points.join(' L ')}`;
        }
    }

    _handleButtonPress(type, currentState) {
        this._localStatusText = "Command send";
        
        if (type === 'mode') {
            this._localGreen = !currentState;
            const serviceEntity = currentState ? this.config.button_disable_green_power : this.config.button_enable_green_power;
            this._callHomeAssistantService(serviceEntity);
        } 
        else if (type === 'charge') {
            this._localCharging = !currentState;
            const serviceEntity = currentState ? this.config.button_stop_charge : this.config.button_start_charge;
            this._callHomeAssistantService(serviceEntity);
        }

        if (this._sequenceTimeout) clearTimeout(this._sequenceTimeout);
        
        this._sequenceTimeout = setTimeout(() => {
            const entitiesToUpdate = [
                this.config.charger_connected,
                this.config.charger_energy,
                this.config.charger_power,
                this.config.charger_status,
                this.config.charger_mode_status
            ].filter(Boolean);

            entitiesToUpdate.forEach(entity => {
                this.hass.callService('homeassistant', 'update_entity', { entity_id: entity });
            });

            setTimeout(() => {
                this._localCharging = null;
                this._localGreen = null;
                this._localStatusText = null;
                this.requestUpdate();
            }, 2000); 

        }, 10000); 

        this.requestUpdate();
    }

    _callHomeAssistantService(serviceEntity) {
        if (!serviceEntity) return;
        const domain = serviceEntity.split('.')[0];
        const service = domain === 'button' ? 'press' : 'turn_on';
        this.hass.callService(domain, service, { entity_id: serviceEntity });
    }

    setConfig(config) {
        if (!config.charger_connected || !config.charger_energy || !config.charger_power || !config.charger_status || !config.charger_mode_status) {
            throw new Error("Bitte alle Pflicht-Entitäten inkl. charger_mode_status definieren.");
        }
        this.config = config;
    }

    getCardSize() { return 5; }

    static get styles() {
        return css`
            :host { display: block; }
            .wallbox-card { background: linear-gradient(145deg, #1e242c, #12161a); border-radius: 18px; padding: 12px; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; box-shadow: 0 8px 20px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.05); }
            .graph-track { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
            .line-graph-container { flex: 1; height: 55px; border-radius: 10px; overflow: hidden; background: rgba(255, 255, 255, 0.01); border: 1px solid rgba(255, 255, 255, 0.03); }
            .history-svg { width: 100%; height: 100%; }
            .bar-graph-container { flex: 1; height: 16px; border-radius: 6px; overflow: hidden; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.04); }
            .bar-fill { height: 100%; background: linear-gradient(90deg, #4caf50, #81c784); box-shadow: 0 0 12px rgba(76, 175, 80, 0.3); transition: width 0.5s ease; }
            .graph-value-label { width: 65px; text-align: right; font-size: 13px; font-weight: 600; color: rgba(255, 255, 255, 0.9); font-variant-numeric: tabular-nums; }
            .metrics-container { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 14px; margin-top: 6px; padding: 0 2px; }
            .primary-metrics { display: flex; align-items: baseline; }
            .value-large { font-size: 36px; font-weight: 400; line-height: 1; }
            .unit-large { font-size: 16px; color: rgba(255, 255, 255, 0.6); margin-left: 4px; margin-right: 10px; }
            .separator { font-size: 20px; color: rgba(255, 255, 255, 0.2); margin-right: 10px; }
            .value-percent { font-size: 20px; font-weight: 300; color: rgba(255, 255, 255, 0.6); }
            .secondary-metrics { font-size: 11px; font-weight: 600; color: rgba(255, 255, 255, 0.25); letter-spacing: 0.5px; padding-bottom: 4px; }
            .controls-row { display: flex; justify-content: space-between; align-items: center; padding: 0 2px; gap: 16px; }
            .pill-buttons-group { display: flex; gap: 10px; flex-shrink: 0; }
            .btn-pill { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 18px; padding: 6px 20px; color: #ffffff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.1s ease; min-width: 65px; height: 36px; }
            .btn-pill:active { transform: scale(0.92); background: rgba(255, 255, 255, 0.3) !important; border-color: rgba(255, 255, 255, 0.5) !important; box-shadow: inset 0 2px 4px rgba(0,0,0,0.5); }
            .btn-pill.connected { background: rgba(76, 175, 80, 0.2); border-color: rgba(76, 175, 80, 0.45); color: #81c784; }
            .btn-pill.disconnected { background: rgba(255, 255, 255, 0.02); border-color: rgba(255, 255, 255, 0.05); color: rgba(255, 255, 255, 0.3); }
            .btn-pill.eco { background: rgba(76, 175, 80, 0.2); border-color: rgba(76, 175, 80, 0.45); color: #81c784; }
            .btn-pill.full-power { background: rgba(33, 150, 243, 0.2); border-color: rgba(33, 150, 243, 0.45); color: #64b5f6; }
            .btn-pill.charging { background: rgba(255, 167, 38, 0.2); border-color: rgba(255, 167, 38, 0.45); color: #ffb74d; }
            .status-label-container { display: flex; align-items: center; justify-content: flex-end; flex: 1; min-width: 0; }
            .status-text { font-size: 14px; font-weight: 500; color: rgba(255, 255, 255, 0.7); letter-spacing: 0.3px; text-align: right; line-height: 1.3; word-break: break-word; }
        `;
    }
}
customElements.define('ev-wallbox-card', EvWallboxCard);
