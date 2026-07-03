/**
 * EV Wallbox Custom Dashboard Card for Home Assistant
 * Version 3.0 - Compact Design, Fixed Plug Logic & 10s Update Sequence
 */

var LitElement = LitElement || Object.getPrototypeOf(customElements.get("ha-panel-lovelace"));
var html = LitElement.prototype.html;
var css = LitElement.prototype.css;

class EvWallboxCard extends LitElement {
    static get properties() {
        return {
            hass: {},
            config: {},
            _powerHistory: { type: Array },
            _localCharging: { type: Boolean },
            _localGreen: { type: Boolean },
            _localStatusText: { type: String }
        };
    }

    constructor() {
        super();
        this._powerHistory = [];
        this._localCharging = null;
        this._localGreen = null;
        this._localStatusText = null;
        this._sequenceTimeout = null;
    }

    render() {
        if (!this.hass || !this.config) return html``;

        // Entitäten laden
        const stateConnected = this.hass.states[this.config.charger_connected];
        const stateEnergy = this.hass.states[this.config.charger_energy];
        const statePower = this.hass.states[this.config.charger_power];
        const stateStatus = this.hass.states[this.config.charger_status];
        const stateMode = this.hass.states[this.config.charger_mode_status];

        // Werte verarbeiten
        const connectedVal = stateConnected ? stateConnected.state : 'Ausgesteckt';
        // Flexibler Abgleich auf "Eingesteckt", "on" oder "true"
        const isConnected = connectedVal.toLowerCase() === 'eingesteckt' || connectedVal === 'on' || connectedVal === 'true';
        
        const energyVal = stateEnergy ? parseFloat(stateEnergy.state) : 0;
        const powerVal = statePower ? parseFloat(statePower.state) : 0;

        // Rolling History für den Leistungsgraphen
        if (this._powerHistory.length === 0) {
            for (let i = 0; i < 40; i++) this._powerHistory.push(powerVal);
        } else {
            const lastPoint = this._powerHistory[this._powerHistory.length - 1];
            if (lastPoint !== powerVal) {
                this._powerHistory.push(powerVal);
                if (this._powerHistory.length > 40) this._powerHistory.shift();
            }
        }

        // EV Modus auswerten (PV Power = Eco) mit lokalem Override
        let isGreenActive = stateMode ? (stateMode.state === 'PV Power') : false;
        if (this._localGreen !== null) {
            isGreenActive = this._localGreen;
        }

        // Lade-Status auswerten mit lokalem Override
        let isCharging = powerVal > 0.1 || (stateStatus && (stateStatus.state.toLowerCase() === 'charging' || stateStatus.state.toLowerCase() === 'laden'));
        if (this._localCharging !== null) {
            isCharging = this._localCharging;
        }

        // Status-Text auswerten mit lokalem Override
        let statusText = stateStatus ? stateStatus.state : 'Standby';
        if (this._localStatusText !== null) {
            statusText = this._localStatusText;
        }

        // Auto-Grenzwerte
        const maxCapacity = parseFloat(this.config.max_capacity) || 77;
        const maxReach = parseFloat(this.config.max_reach) || 500;
        const maxPower = parseFloat(this.config.max_power) || 11;

        // km & Prozent berechnen
        const pct = Math.min(100, Math.max(0, (energyVal / maxCapacity) * 100));
        const currentKm = Math.round((pct / 100) * maxReach);

        return html`
            <ha-card class="wallbox-card">

                <!-- ZEILE 1: Getrennter Liniengraph (Leistung) -->
                <div class="graph-track">
                    <div class="line-graph-container">
                        <svg viewBox="0 0 500 60" preserveAspectRatio="none" class="history-svg">
                            <path d="${this._generateHistoryPath(this._powerHistory, maxPower)}" fill="none" stroke="${isCharging ? '#4caf50' : 'rgba(255, 255, 255, 0.2)'}" stroke-width="2.5" />
                        </svg>
                    </div>
                    <div class="graph-value-label">${powerVal.toFixed(1).replace('.', ',')} kW</div>
                </div>

                <!-- ZEILE 2: Schmaler Bargraph (Prozente / kWh) -->
                <div class="graph-track">
                    <div class="bar-graph-container">
                        <div class="bar-fill" style="width: ${pct}%;"></div>
                    </div>
                    <div class="graph-value-label">${energyVal.toFixed(1).replace('.', ',')} kWh</div>
                </div>

                <!-- Reichweiten & Prozent-Anzeige -->
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

                <!-- Steuerungs-Buttons & Text-Status -->
                <div class="controls-row">
                    <div class="pill-buttons-group">
                        <!-- Stecker Status Button (Löst bei Klick ebenfalls die Aktualisierung aus) -->
                        <button class="btn-pill ${isConnected ? 'connected' : 'disconnected'}" @click=${() => this._handleButtonPress('plug')}>
                            <ha-icon icon="${isConnected ? 'mdi:ev-plug-type2' : 'mdi:power-plug-off'}"></ha-icon>
                        </button>

                        <!-- EV Modus Toggle -->
                        <button class="btn-pill mode-toggle ${isGreenActive ? 'eco' : 'full-power'}" @click=${() => this._handleButtonPress('mode', isGreenActive)}>
                            <ha-icon icon="${isGreenActive ? 'mdi:leaf' : 'mdi:leaf-off'}"></ha-icon>
                        </button>

                        <!-- Start / Stop Laden -->
                        <button class="btn-pill action-toggle ${isCharging ? 'charging' : 'idle'}" @click=${() => this._handleButtonPress('charge', isCharging)}>
                            <ha-icon icon="${isCharging ? 'mdi:stop' : 'mdi:play'}"></ha-icon>
                        </button>
                    </div>

                    <!-- Arbeitsstatus (Rechtsbündig, kleiner & mit Abstand) -->
                    <div class="status-label-container">
                        <span class="status-text">${statusText}</span>
                    </div>
                </div>
            </ha-card>
        `;
    }

    // Erzeugt den Signal-Pfad im SVG
    _generateHistoryPath(history, maxPower) {
        if (!history || history.length < 2) return 'M 0,55 L 500,55';
        const width = 500;
        const height = 60;
        const padding = 6;
        const usableHeight = height - (padding * 2);

        const points = history.map((val, index) => {
            const x = (index / (history.length - 1)) * width;
            const factor = Math.min(1, Math.max(0, val / maxPower));
            const y = height - padding - (factor * usableHeight);
            return `${x},${y}`;
        });

        return `M ${points.join(' L ')}`;
    }

    // Zentrale Steuerungs-Sequenz für alle Buttons inkl. 10s Update-Verzögerung
    _handleButtonPress(type, currentState) {
        // 1. Optisches Sofort-Feedback & "Command send" setzen
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

        // 2. Zeitsteuerung für die 10 Sekunden Sequenz aktivieren
        if (this._sequenceTimeout) clearTimeout(this._sequenceTimeout);
        
        this._sequenceTimeout = setTimeout(() => {
            // Alle in der Card verwendeten Entitäten ermitteln
            const entitiesToUpdate = [
                this.config.charger_connected,
                this.config.charger_energy,
                this.config.charger_power,
                this.config.charger_status,
                this.config.charger_mode_status
            ].filter(Boolean);

            // Home Assistant zwingen, alle Sensoren JETZT frisch abzufragen
            entitiesToUpdate.forEach(entity => {
                this.hass.callService('homeassistant', 'update_entity', { entity_id: entity });
            });

            // Lokale Overrides nach dem Update wieder freigeben, damit Echtwerte gelten
            setTimeout(() => {
                this._localCharging = null;
                this._localGreen = null;
                this._localStatusText = null;
                this.requestUpdate();
            }, 2000); // Kleine Pufferzeit, damit HA die Werte verarbeitet hat

        }, 10000); // Exakt 10 Sekunden Verzögerung

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

    getCardSize() {
        return 5;
    }

    static get styles() {
        return css`
            :host {
                display: block;
            }
            .wallbox-card {
                background: linear-gradient(145deg, #1e242c, #12161a);
                border-radius: 18px;
                padding: 12px; /* Reduzierter Abstand zum Außenrand laut Bild */
                color: #ffffff;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                box-shadow: 0 8px 20px rgba(0,0,0,0.4);
                border: 1px solid rgba(255,255,255,0.05);
            }

            /* Graph-Zeilen Layout */
            .graph-track {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 8px; /* Kompaktisierte Abstände */
            }

            .line-graph-container {
                flex: 1;
                height: 55px;
                border-radius: 10px;
                overflow: hidden;
                background: rgba(255, 255, 255, 0.01);
                border: 1px solid rgba(255, 255, 255, 0.03);
            }
            .history-svg {
                width: 100%;
                height: 100%;
            }

            .bar-graph-container {
                flex: 1;
                height: 16px;
                border-radius: 6px;
                overflow: hidden;
                background: rgba(255, 255, 255, 0.02);
                border: 1px solid rgba(255, 255, 255, 0.04);
            }
            .bar-fill {
                height: 100%;
                background: linear-gradient(90deg, #4caf50, #81c784);
                box-shadow: 0 0 12px rgba(76, 175, 80, 0.3);
                transition: width 0.5s ease;
            }

            .graph-value-label {
                width: 65px;
                text-align: right;
                font-size: 13px;
                font-weight: 600;
                color: rgba(255, 255, 255, 0.9);
                font-variant-numeric: tabular-nums;
            }

            /* Metrics Display */
            .metrics-container {
                display: flex;
                justify-content: space-between;
                align-items: flex-end;
                margin-bottom: 14px;
                margin-top: 6px;
                padding: 0 2px;
            }
            .primary-metrics {
                display: flex;
                align-items: baseline;
            }
            .value-large { font-size: 36px; font-weight: 400; line-height: 1; }
            .unit-large { font-size: 16px; color: rgba(255, 255, 255, 0.6); margin-left: 4px; margin-right: 10px; }
            .separator { font-size: 20px; color: rgba(255, 255, 255, 0.2); margin-right: 10px; }
            .value-percent { font-size: 20px; font-weight: 300; color: rgba(255, 255, 255, 0.6); }
            .secondary-metrics { font-size: 11px; font-weight: 600; color: rgba(255, 255, 255, 0.25); letter-spacing: 0.5px; padding-bottom: 4px; }

            /* Controls Row & Buttons */
            .controls-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0 2px;
                gap: 16px; /* Garantiert Abstand zwischen Buttons und Text */
            }
            .pill-buttons-group {
                display: flex;
                gap: 10px;
                flex-shrink: 0; /* Verhindert, dass Buttons kleiner geschoben werden */
            }
            .btn-pill {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 18px;
                padding: 6px 20px;
                color: #ffffff;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.1s ease;
                min-width: 65px;
                height: 36px;
            }
            
            /* Deutliches visuelles Klick-Feedback */
            .btn-pill:active {
                transform: scale(0.92);
                background: rgba(255, 255, 255, 0.3) !important;
                border-color: rgba(255, 255, 255, 0.5) !important;
                box-shadow: inset 0 2px 4px rgba(0,0,0,0.5);
            }

            /* Farbstile für die Zustände */
            .btn-pill.connected { background: rgba(76, 175, 80, 0.2); border-color: rgba(76, 175, 80, 0.45); color: #81c784; }
            .btn-pill.disconnected { background: rgba(255, 255, 255, 0.02); border-color: rgba(255, 255, 255, 0.05); color: rgba(255, 255, 255, 0.3); }
            .btn-pill.eco { background: rgba(76, 175, 80, 0.2); border-color: rgba(76, 175, 80, 0.45); color: #81c784; }
            .btn-pill.full-power { background: rgba(33, 150, 243, 0.2); border-color: rgba(33, 150, 243, 0.45); color: #64b5f6; }
            .btn-pill.charging { background: rgba(255, 167, 38, 0.2); border-color: rgba(255, 167, 38, 0.45); color: #ffb74d; }
            
            /* Status Text Styling */
            .status-label-container { 
                display: flex; 
                align-items: center; 
                justify-content: flex-end;
                flex: 1;
                min-width: 0;
            }
            .status-text { 
                font-size: 14px; /* Kleinerer Text laut Wunsch */
                font-weight: 500; 
                color: rgba(255, 255, 255, 0.7); 
                letter-spacing: 0.3px;
                text-align: right;
                line-height: 1.3;
                word-break: break-word; /* Verhindert das Herausragen bei engen Screens */
            }
        `;
    }
}

customElements.define('ev-wallbox-card', EvWallboxCard);
