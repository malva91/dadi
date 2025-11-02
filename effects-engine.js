class EffectsEngine {
    constructor() {
        this.firestore = window.firestore;
        this.fsConfigDoc = this.firestore.collection('effectsConfig').doc('config');
        // (opzionale) stats su RTDB/Firestore: disabilitato qui
        this.config = null;
        this.rules = [];
        this.configLoaded = false;
        this.configLoadPromise = null;
        this.particlePool = new window.ParticlePool();
        this.activeParticles = 0;

        this.configLoadPromise = this.loadConfiguration();
    }

    // Log helper - solo errori e warning
    _log(message, type = 'info', data = null) {
        if (type === 'error' || type === 'warning') {
            const timestamp = new Date().toLocaleTimeString('it-IT');
            const logPrefix = type === 'error' ? '❌' : '⚠️';
            console.log(`${logPrefix} [${timestamp}] ${message}`, data || '');
        }
    }

    // Metodo helper per ordinare le regole
    _sortRules(rules) {
        return rules
            .filter(r => r && r.enabled && (r.condition || r.diceCondition))
            .sort((a, b) => {
                // Prima ordina per presenza di FILTRA (con FILTRA vengono prima)
                const aHasFilter = (a.condition || a.diceCondition || '').toUpperCase().includes('FILTRA');
                const bHasFilter = (b.condition || b.diceCondition || '').toUpperCase().includes('FILTRA');
                if (aHasFilter && !bHasFilter) return -1;
                if (!aHasFilter && bHasFilter) return 1;
                // Se entrambi hanno FILTRA o nessuno ce l'ha, ordina per priorità
                return (a.priority || 999) - (b.priority || 999);
            });
    }

    async loadConfiguration(retryCount = 0) {
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 2000;
        const FALLBACK_RULES = [];

        try {
            const configSnap = await this.fsConfigDoc.get();
            const config = configSnap.exists ? configSnap.data() : {};
            const rulesSnap = await this.firestore.collection('effectRules').get();
            const allRules = rulesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            this._log(`📦 Regole grezze dal database: ${allRules.length}`, 'info', {
                rawRules: allRules.map(r => ({
                    id: r.id,
                    enabled: r.enabled,
                    condition: r.condition,
                    diceCondition: r.diceCondition,
                    hasCondition: !!(r.condition || r.diceCondition)
                }))
            });

            this.rules = this._sortRules(allRules);

            this.configLoaded = true;
            console.log('📊 CONFIGURAZIONE REGOLE CARICATA:');
            this.rules.forEach((r, idx) => {
                console.log(`  ${idx + 1}. "${r.name}" - priorità: ${r.priority || 'non impostata'} - condizione: ${r.condition || r.diceCondition}`);
            });
            this._log(`✅ Configurazione caricata: ${this.rules.length} regole trovate`, 'success', {
                rules: this.rules.map(r => ({ id: r.id, name: r.name, condition: r.condition }))
            });

            this.firestore.collection('effectRules').onSnapshot((snap) => {
                try {
                    if (snap && snap.docs) {
                        const allRules = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                        this.rules = this._sortRules(allRules);
                        this._log(`🔄 Regole aggiornate: ${this.rules.length} regole attive`, 'info', {
                            total: allRules.length,
                            enabled: allRules.filter(r => r.enabled).length
                        });
                    }
                } catch (error) {
                    this._log('Errore aggiornamento regole snapshot', 'error', error);
                }
            }, (error) => {
                this._log('Errore listener effectRules', 'error', error);
            });
        } catch (error) {
            this._log('Errore EffectsEngine.loadConfiguration (Firestore)', 'error', error);

            if (retryCount < MAX_RETRIES) {
                this._log(`Tentativo ${retryCount + 1}/${MAX_RETRIES} caricamento configurazione...`, 'warning');
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
                return this.loadConfiguration(retryCount + 1);
            }

            this._log('Utilizzo configurazione fallback', 'warning');
            this.rules = FALLBACK_RULES;
            this.configLoaded = true;
        }
    }

    parseDiceCondition(condition) {
        condition = condition.trim().toUpperCase();

        // Controlla se termina con "FILTRA"
        const hasFilter = condition.endsWith(' FILTRA') || condition.endsWith('FILTRA');
        const cleanCondition = hasFilter ? condition.replace(/\s*FILTRA\s*$/, '').trim() : condition;

        // Regole matematiche semplificate: "2D6=ALTO", "2D6=BASSO"
        const topBottomMatch = cleanCondition.match(/(\d+)D(\d+)=(ALTO|BASSO)/);
        if (topBottomMatch) {
            return {
                type: 'math',
                count: parseInt(topBottomMatch[1]),
                sides: parseInt(topBottomMatch[2]),
                operation: topBottomMatch[3] === 'ALTO' ? 'HIGHEST' : 'LOWEST',
                comparison: null,
                value: parseInt(topBottomMatch[1]),
                filter: hasFilter
            };
        }

        // Tutti i dadi: "D*=1"
        const allDiceMatch = cleanCondition.match(/D\*=(\d+)/);
        if (allDiceMatch) {
            return {
                type: 'all',
                value: parseInt(allDiceMatch[1]),
                filter: hasFilter
            };
        }

        // Regole multi-dado: "D6=1 + D6=1"
        if (cleanCondition.includes('+')) {
            const parts = cleanCondition.split('+').map(p => p.trim());
            const diceResults = [];

            for (const part of parts) {
                const match = part.match(/D(\d+)=(\d+)/);
                if (match) {
                    diceResults.push({
                        sides: parseInt(match[1]),
                        value: parseInt(match[2])
                    });
                }
            }

            return diceResults.length > 0 ? { type: 'multi', dice: diceResults, filter: hasFilter } : null;
        }

        // Regola singola: "D20=20"
        const match = cleanCondition.match(/D(\d+)=(\d+)/);
        if (match) {
            return {
                type: 'single',
                sides: parseInt(match[1]),
                value: parseInt(match[2]),
                filter: hasFilter
            };
        }

        return null;
    }

    async ensureConfigLoaded() {
        if (!this.configLoaded && this.configLoadPromise) {
            await this.configLoadPromise;
        }
    }

checkForEffects(diceArray, presetRules = null) {
    if (!this.configLoaded || !this.rules || this.rules.length === 0) {
        this._log('⚠️ Nessuna regola configurata o caricata', 'warning', {
            configLoaded: this.configLoaded,
            rulesCount: this.rules ? this.rules.length : 0
        });
        return null;
    }
    if (!diceArray || (Array.isArray(diceArray) && diceArray.length === 0)) {
        return null;
    }
    if (!Array.isArray(diceArray)) diceArray = [diceArray];


    let activeRules = this.rules;


    // Se sono specificate regole del preset, usa SOLO quelle
    if (presetRules && Array.isArray(presetRules) && presetRules.length > 0) {
        this._log('🎲 LANCIO CON PRESET - Cerco regole specifiche', 'info', {
            presetRules,
            availableRules: this.rules.map(r => r.id)
        });


        activeRules = this.rules.filter(rule => {
            return presetRules.some(presetRuleId => {
                const ruleIdStr = String(rule.id).trim().toLowerCase();
                const presetRuleIdStr = String(presetRuleId).trim().toLowerCase();
                const match = ruleIdStr === presetRuleIdStr;
                if (match) {
                    this._log(`✅ Regola trovata: ${rule.id} (preset richiedeva: ${presetRuleId})`, 'success');
                }
                return match;
            });
        });

        // IMPORTANTE: Riordina le regole filtrate con lo stesso criterio
        activeRules = this._sortRules(activeRules.map(r => ({ ...r, enabled: true })));

        this._log(`Regole attive trovate: ${activeRules.length}`, activeRules.length > 0 ? 'success' : 'warning');


        if (activeRules.length === 0) {
            this._log('⚠️ NESSUNA REGOLA TROVATA!', 'error', {
                presetRulesRequested: presetRules,
                availableRuleIds: this.rules.map(r => r.id),
                hint: 'Verifica che gli ID nel preset corrispondano agli ID delle regole nel database'
            });
            return null;
        }
    } else {
        this._log(`🎲 LANCIO NORMALE - Uso tutte le regole attive (${this.rules.length})`, 'info');
    }


    // GERARCHIA: Raggruppa per priorità e applica FILTRA progressivamente tra i gruppi
    const allMatchedRules = [];

    // Raggruppa regole per priorità
    const rulesByPriority = new Map();
    activeRules.forEach(rule => {
        const priority = rule.priority || 999;
        if (!rulesByPriority.has(priority)) {
            rulesByPriority.set(priority, []);
        }
        rulesByPriority.get(priority).push(rule);
    });

    // Ordina le priorità
    const sortedPriorities = Array.from(rulesByPriority.keys()).sort((a, b) => a - b);

    console.log('🎲 INIZIO VALUTAZIONE REGOLE');
    console.log('Dadi totali:', diceArray.map((d, i) => `[${i}] D${d.sides}=${d.value}`).join(', '));
    console.log('🔢 GRUPPI DI PRIORITÀ:', sortedPriorities.map(p => `Priorità ${p}: ${rulesByPriority.get(p).length} regole`).join(', '));

    // Mantieni traccia dei dadi disponibili tra i gruppi di priorità
    let globalAvailableDiceIndices = diceArray.map((_, idx) => idx);

    for (const priority of sortedPriorities) {
        const rulesInPriority = rulesByPriority.get(priority);
        console.log(`\n⚡ VALUTO GRUPPO PRIORITÀ ${priority} (${rulesInPriority.length} regole)`);

        // Usa i dadi che sono stati passati dal gruppo precedente
        let availableDiceIndices = [...globalAvailableDiceIndices];
        let filterAppliedInThisGroup = false;

        for (const rule of rulesInPriority) {
            if (!rule || !rule.enabled) continue;

            const conditionStr = rule.condition || rule.diceCondition;
            if (!conditionStr) continue;

            const condition = this.parseDiceCondition(conditionStr);
            if (!condition) continue;

            console.log(`\n📋 Valuto regola: "${rule.name}" (${conditionStr})`);
            console.log('Dadi disponibili prima:', availableDiceIndices.map(idx => `[${idx}] D${diceArray[idx].sides}=${diceArray[idx].value}`).join(', '));

            // Filtra solo i dadi ancora disponibili
            const availableDice = availableDiceIndices.map(idx => ({ dice: diceArray[idx], index: idx }));

            let matched = false;
            let specificity = 0;
            let matchedDiceIndices = [];

            if (condition.type === 'all') {
                for (const item of availableDice) {
                    if (item && item.dice && item.dice.type === 'numeric' && item.dice.value === condition.value) {
                        matched = true;
                        specificity = 1;
                        matchedDiceIndices.push(item.index);
                    }
                }
            } else if (condition.type === 'multi') {
                if (availableDice.length >= condition.dice.length) {
                    const multiResult = this.checkMultiDiceConditionFiltered(availableDice, condition.dice);
                    if (multiResult.matched) {
                        matched = true;
                        specificity = condition.dice.length * 10;
                        matchedDiceIndices = multiResult.indices;
                    }
                }
            } else if (condition.type === 'single') {
                for (const item of availableDice) {
                    if (item && item.dice && item.dice.type === 'numeric' && item.dice.sides === condition.sides && item.dice.value === condition.value) {
                        matched = true;
                        specificity = 1;
                        matchedDiceIndices.push(item.index);
                    }
                }
            } else if (condition.type === 'math') {
                const matchingDice = availableDice.filter(item =>
                    item && item.dice && item.dice.type === 'numeric' && item.dice.sides === condition.sides
                );

                if (matchingDice.length >= condition.count) {
                    const mathResult = this.checkMathCondition(matchingDice, condition);
                    if (mathResult.matched) {
                        matched = true;
                        specificity = condition.count * 5;
                        matchedDiceIndices = mathResult.indices;
                    }
                }
            }

            if (matched && matchedDiceIndices.length > 0) {
                console.log(`✅ MATCH! Dadi matchati:`, matchedDiceIndices.map(idx => `[${idx}] D${diceArray[idx].sides}=${diceArray[idx].value}`).join(', '));

                allMatchedRules.push({
                    rule,
                    specificity,
                    condition,
                    matchedDiceIndices
                });

                // IMPORTANTE: Se la regola ha "filtra", mantieni SOLO i dadi matchati
                if (condition.filter) {
                    console.log(`🔍 Regola con FILTRA - Seleziono SOLO i dadi matchati, scarto gli altri`);
                    // FILTRA significa: mantieni SOLO i dadi matchati, scarta tutti gli altri
                    availableDiceIndices = [...matchedDiceIndices];
                    filterAppliedInThisGroup = true;
                    console.log('Dadi selezionati dal FILTRA:', availableDiceIndices.map(idx => `[${idx}] D${diceArray[idx].sides}=${diceArray[idx].value}`).join(', '));
                    this._log(`🔍 Regola "${rule.name}" con FILTRA: ${matchedDiceIndices.length} dadi selezionati, tutti gli altri scartati`, 'info');
                } else {
                    console.log(`📊 Regola SENZA filtra - I dadi restano invariati`);
                    this._log(`📊 Regola "${rule.name}" applicata: ${matchedDiceIndices.length} dadi selezionati`, 'info');
                }

                // Se non ci sono più dadi disponibili, interrompi il gruppo corrente
                if (availableDiceIndices.length === 0) {
                    console.log('✋ Nessun dado rimanente in questo gruppo');
                    break;
                }
            } else {
                console.log(`❌ Nessun match per questa regola`);
            }
        }

        // Se un filtro è stato applicato in questo gruppo, aggiorna i dadi globali per i gruppi successivi
        if (filterAppliedInThisGroup) {
            globalAvailableDiceIndices = [...availableDiceIndices];
            console.log(`🔄 Aggiorno dadi globali dopo FILTRA: ${globalAvailableDiceIndices.length} dadi disponibili per i gruppi successivi`);
        }

        // Se non ci sono più dadi, interrompi la valutazione
        if (globalAvailableDiceIndices.length === 0) {
            console.log('✋ Nessun dado disponibile per i gruppi successivi');
            break;
        }
    }


    if (allMatchedRules.length === 0) return null;


    // Restituisci tutte le regole matchate con i loro dadi specifici
    return allMatchedRules.map(mr => ({
        type: mr.rule.effectType,
        config: mr.rule,
        matchedDiceIndices: mr.matchedDiceIndices
    }));
}


    checkMultiDiceCondition(diceArray, requiredDice) {
        const availableDice = diceArray
            .map((d, index) => ({
                sides: d.sides,
                value: d.value,
                type: d.type,
                used: false,
                originalIndex: index
            }))
            .filter(d => d.type === 'numeric');

        const matchedIndices = [];

        for (const required of requiredDice) {
            const found = availableDice.find(d =>
                !d.used &&
                d.sides === required.sides &&
                d.value === required.value
            );

            if (!found) return { matched: false, indices: [] };
            found.used = true;
            matchedIndices.push(found.originalIndex);
        }

        return { matched: true, indices: matchedIndices };
    }

    checkMultiDiceConditionFiltered(availableDiceItems, requiredDice) {
        console.log('🔍 checkMultiDiceConditionFiltered chiamato');
        console.log('  Dadi disponibili ricevuti:', availableDiceItems.map(item => `[${item.index}] D${item.dice.sides}=${item.dice.value}`).join(', '));
        console.log('  Dadi richiesti:', requiredDice.map(r => `D${r.sides}=${r.value}`).join(' + '));

        const availableDice = availableDiceItems
            .filter(item => item.dice.type === 'numeric')
            .map(item => ({
                sides: item.dice.sides,
                value: item.dice.value,
                type: item.dice.type,
                used: false,
                originalIndex: item.index
            }));

        console.log('  Dadi numerici filtrati:', availableDice.map(d => `[${d.originalIndex}] D${d.sides}=${d.value}`).join(', '));

        const matchedIndices = [];

        for (const required of requiredDice) {
            console.log(`  Cerco D${required.sides}=${required.value}...`);
            const found = availableDice.find(d =>
                !d.used &&
                d.sides === required.sides &&
                d.value === required.value
            );

            if (!found) {
                console.log(`  ❌ Non trovato!`);
                return { matched: false, indices: [] };
            }
            console.log(`  ✅ Trovato [${found.originalIndex}]`);
            found.used = true;
            matchedIndices.push(found.originalIndex);
        }

        console.log('  ✅ Tutti i dadi richiesti trovati:', matchedIndices);
        return { matched: true, indices: matchedIndices };
    }

    checkMathCondition(matchingDice, condition) {
        // matchingDice = [{dice: {}, index: 0}, ...]
        const values = matchingDice.map(item => item.dice.value);
        const indices = matchingDice.map(item => item.index);

        let selectedIndices = [];
        let result;

        switch (condition.operation) {
            case 'HIGHEST':
                // Prendi i N più alti
                const highest = matchingDice
                    .sort((a, b) => b.dice.value - a.dice.value)
                    .slice(0, condition.value || condition.count);
                selectedIndices = highest.map(item => item.index);
                result = true;
                break;

            case 'LOWEST':
                // Prendi i N più bassi
                const lowest = matchingDice
                    .sort((a, b) => a.dice.value - b.dice.value)
                    .slice(0, condition.value || condition.count);
                selectedIndices = lowest.map(item => item.index);
                result = true;
                break;

            case 'SUM':
                // Somma valori e confronta
                const sum = values.reduce((acc, v) => acc + v, 0);
                result = this.compareValues(sum, condition.comparison, condition.value);
                selectedIndices = result ? indices : [];
                break;

            case 'AVG':
                // Media valori e confronta
                const avg = values.reduce((acc, v) => acc + v, 0) / values.length;
                result = this.compareValues(avg, condition.comparison, condition.value);
                selectedIndices = result ? indices : [];
                break;

            default:
                return { matched: false, indices: [] };
        }

        return { matched: result && selectedIndices.length > 0, indices: selectedIndices };
    }

    compareValues(value, comparison, target) {
        if (!comparison || target === null) return true;

        switch (comparison) {
            case '>': return value > target;
            case '<': return value < target;
            case '>=': return value >= target;
            case '<=': return value <= target;
            default: return true;
        }
    }


    applyEffects(element, rule) {
        if (!element || !rule) {
            this._log('applyEffects: elemento o regola non validi', 'warning');
            return;
        }

        const rect = element.getBoundingClientRect();
        if (!rect) return;

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        if (rule.particleEffect && rule.particleEffect !== 'none') {
            this.applyParticleEffect(centerX, centerY, rule.particleEffect);
        }

        if (rule.glowEffect && rule.glowEffect !== 'none') {
            this.applyGlowEffect(element, rule.glowEffect);
        }

        if (rule.windowEffect && rule.windowEffect !== 'none') {
            this.applyWindowEffect(element, rule.windowEffect);
        }
    }

    applyParticleEffect(x, y, effectType) {
        switch (effectType) {
            case 'particles-gold':
                this.createParticles(x, y, ['#FFD700', '#FFA500', '#FF6347', '#FFE66D']);
                break;
            case 'particles-silver':
                this.createParticles(x, y, ['#C0C0C0', '#E0E0E0', '#A8A8A8', '#F5F5F5']);
                break;
            case 'particles-fire':
                this.createFireParticles(x, y);
                break;
            case 'particles-ice':
                this.createParticles(x, y, ['#B0E0E6', '#87CEEB', '#ADD8E6', '#E0FFFF']);
                break;
            case 'particles-green':
                this.createParticles(x, y, ['#00FF00', '#32CD32', '#00FA9A', '#90EE90']);
                break;
            case 'particles-purple':
                this.createParticles(x, y, ['#9B59B6', '#8E44AD', '#C39BD3', '#D7BDE2']);
                break;
            case 'particles-rainbow':
                this.createRainbowParticles(x, y);
                break;
            case 'smoke-dark':
                this.createSmoke(x, y, ['#333333', '#555555']);
                break;
            case 'smoke-white':
                this.createSmoke(x, y, ['#CCCCCC', '#FFFFFF']);
                break;
            case 'smoke-colored':
                this.createColoredSmoke(x, y);
                break;
            case 'smoke-spiral':
                this.createSpiralSmoke(x, y);
                break;
            case 'smoke-explosion':
                this.createExplosionSmoke(x, y);
                break;
        }
    }

    applyGlowEffect(element, effectType) {
        switch (effectType) {
            case 'glow-gold':
                this.createGlow(element, '#FFD700', window.CONSTANTS.EFFECTS.GLOW_INTENSITY_NORMAL);
                break;
            case 'glow-red':
                this.createGlow(element, '#FF4444', window.CONSTANTS.EFFECTS.GLOW_INTENSITY_NORMAL);
                break;
            case 'glow-red-pulse':
                this.createPulseGlow(element, '#FF4444');
                break;
            case 'glow-blue':
                this.createGlow(element, '#4169E1', window.CONSTANTS.EFFECTS.GLOW_INTENSITY_NORMAL);
                break;
            case 'glow-green':
                this.createGlow(element, '#00FF00', window.CONSTANTS.EFFECTS.GLOW_INTENSITY_NORMAL);
                break;
            case 'glow-purple':
                this.createGlow(element, '#9B59B6', window.CONSTANTS.EFFECTS.GLOW_INTENSITY_NORMAL);
                break;
            case 'glow-rainbow':
                this.createRainbowGlow(element);
                break;
            case 'glow-intense':
                this.createGlow(element, '#FFFFFF', window.CONSTANTS.EFFECTS.GLOW_INTENSITY_INTENSE);
                break;
        }
    }

    applyWindowEffect(element, effectType) {
        switch (effectType) {
            case 'shake':
                this.createShake(element, window.CONSTANTS.EFFECTS.SHAKE_INTENSITY_NORMAL, window.CONSTANTS.EFFECTS.SHAKE_DURATION_NORMAL);
                break;
            case 'shake-hard':
                this.createShake(element, window.CONSTANTS.EFFECTS.SHAKE_INTENSITY_HARD, window.CONSTANTS.EFFECTS.SHAKE_DURATION_HARD);
                break;
            case 'bounce':
                this.createBounce(element);
                break;
            case 'bounce-high':
                this.createBounceHigh(element);
                break;
            case 'spin':
                this.createSpin(element);
                break;
            case 'spin-fast':
                this.createSpinFast(element);
                break;
            case 'scale-pulse':
                this.createScalePulse(element);
                break;
            case 'wobble':
                this.createWobble(element);
                break;
            case 'flip':
                this.createFlip(element);
                break;
        }
    }

    createParticles(x, y, colors) {
        if (typeof x !== 'number' || typeof y !== 'number' || isNaN(x) || isNaN(y)) {
            this._log('createParticles: coordinate non valide', 'warning');
            return;
        }

        if (!colors || colors.length === 0) {
            colors = ['#FFD700', '#FFA500'];
        }

        const maxParticles = window.CONSTANTS.ANIMATIONS.MAX_SIMULTANEOUS_PARTICLES || 100;
        const requestedCount = window.CONSTANTS.ANIMATIONS.PARTICLE_EXPLOSION_COUNT || 30;
        const availableSlots = Math.max(0, maxParticles - this.activeParticles);
        const particleCount = Math.min(requestedCount, availableSlots);

        for (let i = 0; i < particleCount; i++) {
            const particle = this.particlePool.getParticle();
            this.activeParticles++;

            const randomArray = new Uint32Array(5);
            crypto.getRandomValues(randomArray);

            const size = (randomArray[0] / 0xFFFFFFFF) * (window.CONSTANTS.EFFECTS.PARTICLE_MAX_SIZE - window.CONSTANTS.EFFECTS.PARTICLE_MIN_SIZE) + window.CONSTANTS.EFFECTS.PARTICLE_MIN_SIZE;
            const colorIndex = Math.floor((randomArray[1] / 0xFFFFFFFF) * colors.length);
            const color = colors[colorIndex];
            const angle = (randomArray[2] / 0xFFFFFFFF) * Math.PI * 2;
            const velocity = (randomArray[3] / 0xFFFFFFFF) * (window.CONSTANTS.EFFECTS.PARTICLE_MAX_VELOCITY - window.CONSTANTS.EFFECTS.PARTICLE_MIN_VELOCITY) + window.CONSTANTS.EFFECTS.PARTICLE_MIN_VELOCITY;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity;
            const rotation = (randomArray[4] / 0xFFFFFFFF) * 360;

            const durationArray = new Uint32Array(2);
            crypto.getRandomValues(durationArray);
            const duration = (durationArray[0] / 0xFFFFFFFF) * (window.CONSTANTS.EFFECTS.PARTICLE_MAX_DURATION - window.CONSTANTS.EFFECTS.PARTICLE_MIN_DURATION) + window.CONSTANTS.EFFECTS.PARTICLE_MIN_DURATION;
            const borderRadius = (durationArray[1] / 0xFFFFFFFF) > 0.5 ? '50%' : '0';

            particle.style.cssText = `
                position: fixed;
                width: ${size}px;
                height: ${size}px;
                background: ${color};
                border-radius: ${borderRadius};
                left: ${x}px;
                top: ${y}px;
                pointer-events: none;
                z-index: 10000;
                box-shadow: 0 0 ${size * 2}px ${color};
                transform: rotate(${rotation}deg);
            `;

            document.body.appendChild(particle);

            const startTime = performance.now();
            const animate = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = elapsed / duration;

                if (progress < 1) {
                    const currentX = x + vx * (elapsed / 1000);
                    const currentY = y + vy * (elapsed / 1000) + (0.5 * 500 * Math.pow(elapsed / 1000, 2));
                    const opacity = 1 - progress;
                    const scale = 1 - progress * 0.5;

                    particle.style.left = `${currentX}px`;
                    particle.style.top = `${currentY}px`;
                    particle.style.opacity = opacity;
                    particle.style.transform = `rotate(${rotation + progress * 720}deg) scale(${scale})`;

                    requestAnimationFrame(animate);
                } else {
                    this.particlePool.releaseParticle(particle);
                    this.activeParticles--;
                }
            };

            requestAnimationFrame(animate);
        }
    }

    createExplosion(x, y) {
        const ring = document.createElement('div');
        ring.style.cssText = `
            position: fixed;
            width: 20px;
            height: 20px;
            border: 3px solid #FFD700;
            border-radius: 50%;
            left: ${x - 10}px;
            top: ${y - 10}px;
            pointer-events: none;
            z-index: 10000;
        `;
        document.body.appendChild(ring);

        ring.animate([
            { width: '20px', height: '20px', opacity: 1, left: `${x - 10}px`, top: `${y - 10}px` },
            { width: '300px', height: '300px', opacity: 0, left: `${x - 150}px`, top: `${y - 150}px` }
        ], {
            duration: 800,
            easing: 'ease-out'
        }).onfinish = () => ring.remove();
    }

    createSparkles(x, y) {
        for (let i = 0; i < 8; i++) {
            const sparkle = document.createElement('div');
            const angle = (Math.PI * 2 * i) / 8;
            const distance = 30;
            const endX = x + Math.cos(angle) * distance;
            const endY = y + Math.sin(angle) * distance;

            sparkle.style.cssText = `
                position: fixed;
                width: 3px;
                height: 3px;
                background: white;
                border-radius: 50%;
                left: ${x}px;
                top: ${y}px;
                pointer-events: none;
                z-index: 10000;
                box-shadow: 0 0 10px #fff;
            `;

            document.body.appendChild(sparkle);

            sparkle.animate([
                { left: `${x}px`, top: `${y}px`, opacity: 1 },
                { left: `${endX}px`, top: `${endY}px`, opacity: 0 }
            ], {
                duration: 600,
                easing: 'ease-out'
            }).onfinish = () => sparkle.remove();
        }
    }

    createGlow(element, color, intensity = window.CONSTANTS.EFFECTS.GLOW_INTENSITY_NORMAL) {
        if (!element || !color) return;

        const originalBoxShadow = element.style.boxShadow;
        const animation = element.animate([
            { boxShadow: originalBoxShadow },
            { boxShadow: `0 0 ${intensity}px ${color}, 0 0 ${intensity * 2}px ${color}` },
            { boxShadow: originalBoxShadow }
        ], {
            duration: 1000,
            easing: 'ease-in-out'
        });

        animation.onfinish = () => {
            if (element) element.style.boxShadow = originalBoxShadow;
        };
    }

    createPulseGlow(element, color) {
        const originalBoxShadow = element.style.boxShadow;
        element.animate([
            { boxShadow: originalBoxShadow },
            { boxShadow: `0 0 20px ${color}, 0 0 40px ${color}` },
            { boxShadow: originalBoxShadow },
            { boxShadow: `0 0 20px ${color}, 0 0 40px ${color}` },
            { boxShadow: originalBoxShadow }
        ], {
            duration: 1500,
            easing: 'ease-in-out'
        });
    }

    createRainbowGlow(element) {
        const originalBoxShadow = element.style.boxShadow;
        element.animate([
            { boxShadow: originalBoxShadow },
            { boxShadow: '0 0 30px #FF0000, 0 0 60px #FF0000' },
            { boxShadow: '0 0 30px #00FF00, 0 0 60px #00FF00' },
            { boxShadow: '0 0 30px #0000FF, 0 0 60px #0000FF' },
            { boxShadow: originalBoxShadow }
        ], {
            duration: 1500,
            easing: 'ease-in-out'
        });
    }

    createShake(element, intensity = window.CONSTANTS.EFFECTS.SHAKE_INTENSITY_NORMAL, duration = window.CONSTANTS.EFFECTS.SHAKE_DURATION_NORMAL) {
        element.animate([
            { transform: 'translateX(0)' },
            { transform: `translateX(-${intensity}px)` },
            { transform: `translateX(${intensity}px)` },
            { transform: `translateX(-${intensity}px)` },
            { transform: `translateX(${intensity}px)` },
            { transform: 'translateX(0)' }
        ], {
            duration: duration,
            easing: 'ease-in-out'
        });
    }

    createBounce(element) {
        element.animate([
            { transform: 'translateY(0)' },
            { transform: 'translateY(-30px)' },
            { transform: 'translateY(0)' },
            { transform: 'translateY(-15px)' },
            { transform: 'translateY(0)' }
        ], {
            duration: 800,
            easing: 'ease-out'
        });
    }

    createSpin(element) {
        element.animate([
            { transform: 'rotate(0deg) scale(1)' },
            { transform: 'rotate(180deg) scale(1.1)' },
            { transform: 'rotate(360deg) scale(1)' }
        ], {
            duration: 1000,
            easing: 'ease-in-out'
        });
    }

    createScalePulse(element) {
        element.animate([
            { transform: 'scale(1)' },
            { transform: 'scale(1.15)' },
            { transform: 'scale(1)' },
            { transform: 'scale(1.15)' },
            { transform: 'scale(1)' }
        ], {
            duration: 1000,
            easing: 'ease-in-out'
        });
    }

    createSmoke(x, y, colors = ['#666666', '#888888']) {
        for (let i = 0; i < window.CONSTANTS.ANIMATIONS.SMOKE_PARTICLE_COUNT; i++) {
            const smoke = document.createElement('div');
            const randomArray = new Uint32Array(3);
            crypto.getRandomValues(randomArray);
            const size = (randomArray[0] / 0xFFFFFFFF) * 30 + 15;
            const offsetX = ((randomArray[1] / 0xFFFFFFFF) - 0.5) * 60;
            const color = colors[Math.floor((randomArray[2] / 0xFFFFFFFF) * colors.length)];

            smoke.style.cssText = `
                position: fixed;
                width: ${size}px;
                height: ${size}px;
                background: ${color};
                border-radius: 50%;
                left: ${x + offsetX}px;
                top: ${y}px;
                pointer-events: none;
                z-index: 10000;
                filter: blur(8px);
                opacity: 0.6;
            `;

            document.body.appendChild(smoke);

            smoke.animate([
                { top: `${y}px`, opacity: 0.6, transform: 'scale(0.5)' },
                { top: `${y - 120}px`, opacity: 0, transform: 'scale(2)' }
            ], {
                duration: 2000,
                easing: 'ease-out',
                delay: i * 50
            }).onfinish = () => smoke.remove();
        }
    }

    createFireParticles(x, y) {
        const particleCount = window.CONSTANTS.ANIMATIONS.FIRE_PARTICLE_COUNT;
        const colors = ['#FF4500', '#FF6347', '#FFA500', '#FFD700', '#FF0000'];

        for (let i = 0; i < particleCount; i++) {
            const particle = this.particlePool.getParticle();
            const randomArray = new Uint32Array(4);
            crypto.getRandomValues(randomArray);
            const size = (randomArray[0] / 0xFFFFFFFF) * 6 + 3;
            const color = colors[Math.floor((randomArray[1] / 0xFFFFFFFF) * colors.length)];
            const angle = (randomArray[2] / 0xFFFFFFFF) * Math.PI * 2;
            const velocity = (randomArray[3] / 0xFFFFFFFF) * 100 + 80;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity - 50;

            particle.style.cssText = `
                position: fixed;
                width: ${size}px;
                height: ${size}px;
                background: ${color};
                border-radius: 50%;
                left: ${x}px;
                top: ${y}px;
                pointer-events: none;
                z-index: 10000;
                box-shadow: 0 0 ${size * 3}px ${color};
            `;

            document.body.appendChild(particle);

            const startTime = performance.now();
            const duration = 1200;

            const animate = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = elapsed / duration;

                if (progress < 1) {
                    const currentX = x + vx * (elapsed / 1000);
                    const currentY = y + vy * (elapsed / 1000) + (0.5 * 300 * Math.pow(elapsed / 1000, 2));
                    const opacity = 1 - progress;

                    particle.style.left = `${currentX}px`;
                    particle.style.top = `${currentY}px`;
                    particle.style.opacity = opacity;

                    requestAnimationFrame(animate);
                } else {
                    this.particlePool.releaseParticle(particle);
                }
            };

            requestAnimationFrame(animate);
        }
    }

    createColoredSmoke(x, y) {
        const colors = ['#9400D3', '#4B0082', '#0000FF', '#00FF00', '#FFFF00', '#FF7F00', '#FF0000'];

        for (let i = 0; i < window.CONSTANTS.ANIMATIONS.COLORED_SMOKE_COUNT; i++) {
            const smoke = document.createElement('div');
            const randomArray = new Uint32Array(3);
            crypto.getRandomValues(randomArray);
            const size = (randomArray[0] / 0xFFFFFFFF) * 40 + 20;
            const offsetX = ((randomArray[1] / 0xFFFFFFFF) - 0.5) * 70;
            const color = colors[Math.floor((randomArray[2] / 0xFFFFFFFF) * colors.length)];

            smoke.style.cssText = `
                position: fixed;
                width: ${size}px;
                height: ${size}px;
                background: ${color};
                border-radius: 50%;
                left: ${x + offsetX}px;
                top: ${y}px;
                pointer-events: none;
                z-index: 10000;
                filter: blur(10px);
                opacity: 0.5;
            `;

            document.body.appendChild(smoke);

            smoke.animate([
                { top: `${y}px`, opacity: 0.5, transform: 'scale(0.5) rotate(0deg)' },
                { top: `${y - 150}px`, opacity: 0, transform: 'scale(2.5) rotate(360deg)' }
            ], {
                duration: 2500,
                easing: 'ease-out',
                delay: i * 100
            }).onfinish = () => smoke.remove();
        }
    }

    createSpiralSmoke(x, y) {
        for (let i = 0; i < window.CONSTANTS.ANIMATIONS.SPIRAL_SMOKE_COUNT; i++) {
            const smoke = document.createElement('div');
            const randomArray = new Uint32Array(1);
            crypto.getRandomValues(randomArray);
            const size = (randomArray[0] / 0xFFFFFFFF) * 25 + 10;
            const angle = (i / 10) * Math.PI * 4;

            smoke.style.cssText = `
                position: fixed;
                width: ${size}px;
                height: ${size}px;
                background: #888888;
                border-radius: 50%;
                left: ${x}px;
                top: ${y}px;
                pointer-events: none;
                z-index: 10000;
                filter: blur(6px);
                opacity: 0.7;
            `;

            document.body.appendChild(smoke);

            const radius = 50;
            const endX = x + Math.cos(angle) * radius;
            const endY = y - 100 + Math.sin(angle) * radius;

            smoke.animate([
                { left: `${x}px`, top: `${y}px`, opacity: 0.7, transform: 'scale(0.5)' },
                { left: `${endX}px`, top: `${endY}px`, opacity: 0, transform: 'scale(1.8)' }
            ], {
                duration: 1800,
                easing: 'ease-out',
                delay: i * 80
            }).onfinish = () => smoke.remove();
        }
    }

    createExplosionSmoke(x, y) {
        for (let i = 0; i < window.CONSTANTS.ANIMATIONS.EXPLOSION_SMOKE_COUNT; i++) {
            const smoke = document.createElement('div');
            const randomArray = new Uint32Array(2);
            crypto.getRandomValues(randomArray);
            const size = (randomArray[0] / 0xFFFFFFFF) * 50 + 20;
            const angle = (i / 12) * Math.PI * 2;
            const distance = (randomArray[1] / 0xFFFFFFFF) * 100 + 50;

            smoke.style.cssText = `
                position: fixed;
                width: ${size}px;
                height: ${size}px;
                background: #555555;
                border-radius: 50%;
                left: ${x}px;
                top: ${y}px;
                pointer-events: none;
                z-index: 10000;
                filter: blur(10px);
                opacity: 0.8;
            `;

            document.body.appendChild(smoke);

            const endX = x + Math.cos(angle) * distance;
            const endY = y + Math.sin(angle) * distance;

            smoke.animate([
                { left: `${x}px`, top: `${y}px`, opacity: 0.8, transform: 'scale(0.3)' },
                { left: `${endX}px`, top: `${endY}px`, opacity: 0, transform: 'scale(2.5)' }
            ], {
                duration: 1500,
                easing: 'ease-out'
            }).onfinish = () => smoke.remove();
        }
    }

    createRainbowParticles(x, y) {
        const particleCount = window.CONSTANTS.ANIMATIONS.RAINBOW_PARTICLE_COUNT;
        const colors = ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#9400D3'];

        for (let i = 0; i < particleCount; i++) {
            const particle = this.particlePool.getParticle();
            const randomArray = new Uint32Array(3);
            crypto.getRandomValues(randomArray);
            const size = (randomArray[0] / 0xFFFFFFFF) * 10 + 5;
            const color = colors[i % colors.length];
            const angle = (randomArray[1] / 0xFFFFFFFF) * Math.PI * 2;
            const velocity = (randomArray[2] / 0xFFFFFFFF) * 200 + 100;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity;

            particle.style.cssText = `
                position: fixed;
                width: ${size}px;
                height: ${size}px;
                background: ${color};
                border-radius: 50%;
                left: ${x}px;
                top: ${y}px;
                pointer-events: none;
                z-index: 10000;
                box-shadow: 0 0 ${size * 3}px ${color};
            `;

            document.body.appendChild(particle);

            const startTime = performance.now();
            const duration = 1500;

            const animate = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = elapsed / duration;

                if (progress < 1) {
                    const currentX = x + vx * (elapsed / 1000);
                    const currentY = y + vy * (elapsed / 1000) + (0.5 * 400 * Math.pow(elapsed / 1000, 2));
                    const opacity = 1 - progress;
                    const scale = 1 - progress * 0.3;

                    particle.style.left = `${currentX}px`;
                    particle.style.top = `${currentY}px`;
                    particle.style.opacity = opacity;
                    particle.style.transform = `scale(${scale}) rotate(${progress * 360}deg)`;

                    requestAnimationFrame(animate);
                } else {
                    this.particlePool.releaseParticle(particle);
                }
            };

            requestAnimationFrame(animate);
        }
    }

    createBounceHigh(element) {
        element.animate([
            { transform: 'translateY(0)' },
            { transform: 'translateY(-50px)' },
            { transform: 'translateY(0)' },
            { transform: 'translateY(-25px)' },
            { transform: 'translateY(0)' },
            { transform: 'translateY(-10px)' },
            { transform: 'translateY(0)' }
        ], {
            duration: 1200,
            easing: 'ease-out'
        });
    }

    createSpinFast(element) {
        element.animate([
            { transform: 'rotate(0deg) scale(1)' },
            { transform: 'rotate(360deg) scale(1.2)' },
            { transform: 'rotate(720deg) scale(1)' }
        ], {
            duration: 800,
            easing: 'ease-in-out'
        });
    }

    createWobble(element) {
        element.animate([
            { transform: 'rotate(0deg) translateX(0)' },
            { transform: 'rotate(-10deg) translateX(-5px)' },
            { transform: 'rotate(10deg) translateX(5px)' },
            { transform: 'rotate(-10deg) translateX(-5px)' },
            { transform: 'rotate(10deg) translateX(5px)' },
            { transform: 'rotate(0deg) translateX(0)' }
        ], {
            duration: 1000,
            easing: 'ease-in-out'
        });
    }

    createFlip(element) {
        element.animate([
            { transform: 'rotateY(0deg) scale(1)' },
            { transform: 'rotateY(180deg) scale(1.1)' },
            { transform: 'rotateY(360deg) scale(1)' }
        ], {
            duration: 1000,
            easing: 'ease-in-out'
        });
    }

    createCrack(x, y) {
        const crack = document.createElement('div');
        crack.style.cssText = `
            position: fixed;
            width: 2px;
            height: 50px;
            background: linear-gradient(to bottom, #FF4444, transparent);
            left: ${x}px;
            top: ${y}px;
            pointer-events: none;
            z-index: 10000;
            transform-origin: top center;
        `;

        document.body.appendChild(crack);

        crack.animate([
            { opacity: 1, transform: 'scaleY(0)' },
            { opacity: 1, transform: 'scaleY(1)' },
            { opacity: 0, transform: 'scaleY(1)' }
        ], {
            duration: 800,
            easing: 'ease-out'
        }).onfinish = () => crack.remove();
    }


    showTextEffect(element, text, emoji) {
        this.showTextEffectWithOffset(element, text, emoji, -50);
    }

    showTextEffectWithOffset(element, text, emoji, yOffset = null, customConfig = null) {
        if (yOffset === null) {
            yOffset = window.CONSTANTS.UI.EFFECT_Y_OFFSET_BASE;
        }
        if (!text && !emoji && !customConfig) return;

        const textElement = document.createElement('div');
        const rect = element.getBoundingClientRect();

        let displayText = '';
        let textColor = '#FFD700';
        let fontWeight = '700';

        // Se è personalizzato, usa customText, customBold e customColor
        if (customConfig && customConfig.customText) {
            displayText = customConfig.customText;
            textColor = customConfig.customColor || '#FFD700';
            fontWeight = customConfig.customBold ? '700' : '500';
        } else {
            // Altrimenti usa text ed emoji
            displayText = `${emoji || ''} ${text || ''}`;
        }

        textElement.style.cssText = `
            position: fixed;
            left: ${rect.left + rect.width / 2}px;
            top: ${rect.top + yOffset}px;
            transform: translateX(-50%);
            font-size: 1.5rem;
            font-weight: ${fontWeight};
            color: ${textColor};
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
            pointer-events: none;
            z-index: 10001;
            white-space: nowrap;
        `;

        textElement.textContent = displayText;
        document.body.appendChild(textElement);

        textElement.animate([
            { opacity: 0, transform: 'translateX(-50%) translateY(0) scale(0.5)' },
            { opacity: 1, transform: 'translateX(-50%) translateY(-20px) scale(1)' },
            { opacity: 1, transform: 'translateX(-50%) translateY(-40px) scale(1)' },
            { opacity: 0, transform: 'translateX(-50%) translateY(-60px) scale(0.8)' }
        ], {
            duration: 2000,
            easing: 'ease-out'
        }).onfinish = () => textElement.remove();
    }

    cleanup() {
        if (this.effectsRef) {
            this.effectsRef.off();
        }
        if (this.particlePool) {
            this.particlePool.cleanup();
        }
    }
}

window.EffectsEngine = EffectsEngine;