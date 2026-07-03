/**
 * EV Wallbox Custom Dashboard Card for Home Assistant
 * Designed to match the high-end UI shown in 1000017650.png / 1000017652.png
 */

var LitElement = LitElement || Object.getPrototypeOf(customElements.get("ha-panel-lovelace"));
var html = LitElement.prototype.html;
var css = LitElement.prototype.css;

class EvWallboxCard extends LitElement {
    static get properties() {
        return {
            hass: {},
            config: {}
        };
    }

    render() {
        if (!this.hass || !this.config) return html``;

        // Entitäten aus der Konfiguration laden
        const stateConnected = this.hass.states[this.config.charger_connected];
        const stateEnergy = this.hass.states[this.config.charger_energy];
        const statePower = this.hass.states[this.config.charger_power];
        const stateStatus = this.hass.states[this.config.charger_status];
        const stateGreenPower = this.hass.states[this.config.green_power_status];

        // Werte auslesen und konvertieren
        const connectedVal = stateConnected ? stateConnected.state : 'wurde ausgesteckt';
        const isConnected = connectedVal === 'wurde eingesteckt' || connectedVal === 'on' || connectedVal === 'true';
        
        const energyVal = stateEnergy ? parseFloat(stateEnergy.state) : 0;
        const powerVal = statePower ? parseFloat(statePower.state) : 0;
        const statusText = stateStatus ? stateStatus.state : 'Standby';
        
        // Eco Modus Status überprüfen
        const isGreenActive = stateGreenPower ? (stateGreenPower.state === 'on' || stateGreenPower.state === 'true' || stateGreenPower.state === 'enabled') : false;

        // Konfigurations-Grenzwerte holen (Auto & Wallbox)
        const maxCapacity = parseFloat(this.config.max_capacity) || 77;
        const maxReach = parseFloat(this.config.max_reach) || 500;
        const maxPower = parseFloat(this.config.max_power) || 11; // Neues dynamisches Limit für die Leistungskurve

        // Berechnungen für den Graphen und die Reichweite
        const pct = Math.min(100, Math.max(0, (energyVal / maxCapacity) * 100));
        const currentKm = Math.round((pct / 100) * maxReach);

        // Prüfen, ob aktiv geladen wird
        const isCharging = powerVal > 0.1 || statusText.toLowerCase() === 'charging' || statusText.toLowerCase() === 'laden';

        return html`
            <ha-card class="wallbox-card">

                <!-- Haupt-Bargraph mit Ladefortschritt -->
                <div class="graph-container">
                    <div class="progress-bar-bg">
                        <div class="progress-bar-fill" style="width: ${pct}%;"></div>
                    </div>
                    
                    <!-- SVG Overlay-Kurve skaliert anhand von maxPower -->
                    <svg class="power-curve-svg" viewBox="0 0 600 120" preserveAspectRatio="none">
                        <path d="${this._generateWavePath(powerVal, maxPower)}" fill="none" stroke="${isCharging ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.15)'}" stroke-width="2.5" />
                        
                        <!-- Messpunkte bauen sich nur auf/leuchten, wenn aktiv geladen wird -->
                        ${isCharging ? html`
                            <circle cx="200" cy="${this._getWaveY(200, powerVal, maxPower)}" r="4" fill="rgba(255,255,255,0.4)" />
                            <circle cx="350" cy="${this._getWaveY(350, powerVal, maxPower)}" r="5" fill="#66bb6a" />
                            <circle cx="480" cy="${this._getWaveY(480, powerVal, maxPower)}" r="3" fill="rgba(255,255,255,0.4)" />
                        ` : ''}
                    </svg>
                </div>

                <!-- Werte-Anzeige (km / Prozent) -->
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

                <!-- Untere Steuerungs-Buttons -->
                <div class="controls-row">
                    <div class="pill-buttons-group">
                        <!-- Stecker-Status Button -->
                        <button class="btn-pill ${isConnected ? 'connected' : 'disconnected'}">
                            <ha-icon icon="${isConnected ? 'mdi:ev-plug-type2' : 'mdi:power-plug-off'}"></ha-icon>
                        </button>

                        <!-- Eco Modus Umschalt-Button (Green Power) -->
                        <button class="btn-pill mode-toggle ${isGreenActive ? 'eco' : 'full-power'}" @click=${() => this._toggleGreenPower(isGreenActive)}>
                            <ha-icon icon="${isGreenActive ? 'mdi:leaf' : 'mdi:earth'}"></ha-icon>
                        </button>

                        <!-- Start/Stop Lade-Button -->
                        <button class="btn-pill action-toggle ${isCharging ? 'charging' : 'idle'}" @click=${() => this._toggleCharge(isCharging)}>
                            <ha-icon icon="${isCharging ? 'mdi:stop' : 'mdi:play'}"></ha-icon>
                        </button>
                    </div>

                    <!-- Live Arbeitsstatus-Text -->
                    <div class="status-label-container">
                        <span class="status-text">${statusText}</span>
                    </div>
                </div>
            </ha-card>
        `;
    }

    // Generiert die S-Kurve basierend auf kW-Leistung und maxPower (Höhenlimit)
    _generateWavePath(power, maxPower) {
        const floorY = 105; // Bodenlinie des Graphen
        const ceilingY = 25; // Die Kurve steigt maximal bis Y=25 (nahe dem oberen Rand des Graphen)
        const maxAmplitude = floorY - ceilingY; // Maximaler Spielraum für den Ausschlag (80px)

        if (power <= 0.1) {
            return `M 0,${floorY} L 600,${floorY}`; // Flache Linie am Boden bei 0 kW
        }
        
        // Verhältnis der aktuellen Leistung zur maximalen Leistung (Wert zwischen 0 und 1)
        const normalizedPower = Math.min(1, power / maxPower); 
        
        // Dynamische Y-Punkte berechnen
        const startY = floorY;
        const midY = floorY - (normalizedPower * (maxAmplitude * 0.6));
        const endY = floorY - (normalizedPower * maxAmplitude);
        
        return `M 0,${startY} C 150,${startY} 250,${midY} 400,${midY} C 500,${midY} 550,${endY} 600,${endY}`;
    }

    // Berechnet exakt synchrone Y-Punkte für die runden Punkte auf der Kurve
    _getWaveY(x, power, maxPower) {
        const floorY = 105;
        const ceilingY = 25;
        const maxAmplitude = floorY - ceilingY;

        if (power <= 0.1) return floorY;
        
        const normalizedPower = Math.min(1, power / maxPower);
        const startY = floorY;
        const midY = floorY - (normalizedPower * (maxAmplitude * 0.6));
        const endY = floorY - (normalizedPower * maxAmplitude);
        
        if (x < 220) return startY;
        if (x < 420) return midY;
        return endY;
    }

    // Steuerung des Eco-Modus über Buttons
    _toggleGreenPower(isGreenActive) {
        const serviceEntity = isGreenActive ? this.config.button_disable_green_power : this.config.button_enable_green_power;
        if (!serviceEntity) return;
        
        const domain = serviceEntity.split('.')[0];
        const service = domain === 'button' ? 'press' : 'turn_on';
        this.hass.callService(domain, service, { entity_id: serviceEntity });
    }

    // Starten/Stoppen des Ladens über Buttons
    _toggleCharge(isCharging) {
        const serviceEntity = isCharging ? this.config.button_stop_charge : this.config.button_start_charge;
        if (!serviceEntity) return;

        const domain = serviceEntity.split('.')[0];
        const service = domain === 'button' ? 'press' : 'turn_on';
        this.hass.callService(domain, service, { entity_id: serviceEntity });
    }

    setConfig(config) {
        if (!config.charger_connected || !config.charger_energy || !config.charger_power || !config.charger_status) {
            throw new Error("Bitte konfigurieren Sie die Pflicht-Entitäten (charger_connected, charger_energy, charger_power, charger_status).");
        }
        this.config = config;
    }

    getCardSize() {
        return 4;
    }

    static get styles() {
        return css`
            /* (Die Styles bleiben identisch zur vorherigen Version) */
            :host { display: block; }
            .wallbox-card {
                background: linear-gradient(145deg, #1e242c, #12161a);
                border-radius: 24px;
                padding: 24px;
                color: #ffffff;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                box-shadow: 0 12px 24px rgba(0,0,0,0.4);
                border: 1px solid rgba(255,255,255,0.05);
            }
            .graph-container {
                position: relative;
                width: 100%;
                height: 115px;
                border-radius: 16px;
                overflow: hidden;
                margin-bottom: 20px;
                background: rgba(255, 255, 255, 0.02);
                border: 1px solid rgba(255, 255, 255, 0.04);
            }
            .progress-bar-bg { width: 100%; height: 100%; background: rgba(46, 125, 50, 0.08); }
            .progress-bar-fill {
                height: 100%;
                background: linear-gradient(90deg, #4caf50, #81c784);
                box-shadow: 0 0 20px rgba(76, 175, 80, 0.4);
                border-right: 2px solid #a5d6a7;
                transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .power-curve-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
            .metrics-container { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 28px; padding: 0 4px; }
            .primary-metrics { display: flex; align-items: baseline; }
            .value-large { font-size: 42px; font-weight: 400; color: #ffffff; line-height: 1; }
            .unit-large { font-size: 18px; color: rgba(255, 255, 255, 0.6); margin-left: 6px; margin-right: 12px; }
            .separator { font-size: 24px; color: rgba(255, 255, 255, 0.2); margin-right: 12px; }
            .value-percent { font-size: 24px; font-weight: 300; color: rgba(255, 255, 255, 0.6); }
            .secondary-metrics { font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, 0.3); letter-spacing: 0.5px; padding-bottom: 6px; }
            .controls-row { display: flex; justify-content: space-between; align-items: center; padding: 0 4px; }
            .pill-buttons-group { display: flex; gap: 12px; }
            .btn-pill {
                background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px;
                padding: 8px 24px; color: #ffffff; cursor: pointer; display: flex; align-items: center; justify-content: center;
                transition: all 0.3s ease; min-width: 70px; height: 38px;
            }
            .btn-pill:hover { background: rgba(255, 255, 255, 0.1); }
            .btn-pill.connected { background: rgba(76, 175, 80, 0.2); border-color: rgba(76, 175, 80, 0.4); color: #81c784; }
            .btn-pill.disconnected { background: rgba(255, 255, 255, 0.02); border-color: rgba(255, 255, 255, 0.05); color: rgba(255, 255, 255, 0.3); }
            .btn-pill.eco { background: rgba(76, 175, 80, 0.2); border-color: rgba(76, 175, 80, 0.4); color: #81c784; }
            .btn-pill.full-power { background: rgba(33, 150, 243, 0.2); border-color: rgba(33, 150, 243, 0.4); color: #64b5f6; }
            .btn-pill.charging { background: rgba(255, 167, 38, 0.2); border-color: rgba(255, 167, 38, 0.4); color: #ffb74d; animation: pulse-border 2s infinite; }
            .status-label-container { display: flex; align-items: center; }
            .status-text { font-size: 20px; font-weight: 400; color: rgba(255, 255, 255, 0.85); letter-spacing: 0.5px; }
            @keyframes pulse-border {
                0% { border-color: rgba(255, 167, 38, 0.4); }
                50% { border-color: rgba(255, 167, 38, 0.8); }
                100% { border-color: rgba(255, 167, 38, 0.4); }
            }
        `;
    }
}

customElements.define('ev-wallbox-card', EvWallboxCard);
