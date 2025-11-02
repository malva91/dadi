/* ===========================
   Registry Adapters (robusti)
   =========================== */

function adaptLaunchTypesData(data) {
  // Supporta Map, Array di {id,name,icon,category,variants}, o Object { id: def }
  let list = [];
  if (data instanceof Map) {
    list = Array.from(data.values());
  } else if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === 'object') {
    list = Object.values(data);
  } else {
    list = [];
  }

  const byId = new Map(list.filter(Boolean).map(t => [t.id, t]));
  return {
    getType(id) {
      return byId.get(id) || null;
    },
    getTypesByCategory(category) {
      return list.filter(t => t?.category === category);
    },
    getAll() {
      return list.slice();
    }
  };
}

function getLaunchTypesRegistry(ctx = window) {
  // 1) Istanza già pronta con metodi
  if (ctx.launchTypesRegistry && typeof ctx.launchTypesRegistry.getType === 'function') {
    return ctx.launchTypesRegistry;
  }
  // 2) Costruttore (se esiste davvero)
  if (typeof ctx.LaunchTypesRegistry === 'function') {
    try { return new ctx.LaunchTypesRegistry(); } catch {}
  }
  // 3) Dati grezzi
  if (ctx.launchTypes) return adaptLaunchTypesData(ctx.launchTypes);
  if (typeof ctx.getLaunchTypes === 'function') return adaptLaunchTypesData(ctx.getLaunchTypes());
  // 4) Vuoto
  return adaptLaunchTypesData([]);
}

function adaptColorTypesData(data) {
  // Supporta Map(id -> {label,emoji}), Array di {id,label,emoji}, o Object
  let list = [];
  if (data instanceof Map) {
    list = Array.from(data.entries()).map(([id, v]) => ({
      id,
      label: v?.label ?? id,
      emoji: v?.emoji ?? ''
    }));
  } else if (Array.isArray(data)) {
    list = data.map(c => c && c.id ? c : null).filter(Boolean);
  } else if (data && typeof data === 'object') {
    list = Object.keys(data).map(id => ({
      id,
      label: data[id]?.label ?? id,
      emoji: data[id]?.emoji ?? ''
    }));
  } else {
    list = [];
  }

  return {
    // Se il tuo registry ha "visible", filtra qui; default = tutti
    getVisibleColors() { return list; },
    getAllColors() { return list; }
  };
}

function getColorTypesRegistry(ctx = window) {
  // Istanza già pronta
  if (ctx.colorTypesRegistry && typeof ctx.colorTypesRegistry.getVisibleColors === 'function') {
    return ctx.colorTypesRegistry;
  }
  // Costruttore
  if (typeof ctx.ColorTypesRegistry === 'function') {
    try { return new ctx.ColorTypesRegistry(); } catch {}
  }
  // Dati grezzi (proviamo più nomi)
  const raw =
    ctx.colorTypes ?? ctx.colors ?? ctx.COLOR_TYPES ??
    (typeof ctx.getColorTypes === 'function' ? ctx.getColorTypes() : null);
  if (raw) return adaptColorTypesData(raw);

  // Fallback minimo
  return adaptColorTypesData([{ id: 'base', label: 'Base', emoji: '' }]);
}

/* ===========================
   AdminPanel (completo)
   =========================== */

class AdminPanel {
  constructor() {
    this.firestore = window.firestore;
    this.effectsEngine = new EffectsEngine();

    // Registry robusti
    this.launchTypesRegistry = getLaunchTypesRegistry(window);
    this.colorTypesRegistry  = getColorTypesRegistry(window);

    // Cache iniziale (può essere vuota, verrà aggiornata lazy)
    this.classicVariants = this._resolveClassicVariants();
    this.specialTypes = this._resolveSpecialTypes();

    // NON cachiamo i colori in modo rigido: li leggiamo lazy quando servono
    this.rules = [];
    this.presets = [];

    this._injectAntiClippingCSS();
    this.initializeElements();
    this.bindEvents();

    // Carica prima le regole, poi i preset
    this.initializeData();
  }

  async initializeData() {
    this._isInitializing = true;
    await this.loadConfiguration();
    await this.loadPresets();
    this._isInitializing = false;

    this.renderRules();
    this.renderPresets();
  }

  /* ---------- Helpers Registry ---------- */

  _resolveClassicVariants() {
    try {
      const diceType = this.launchTypesRegistry?.getType?.('dice');
      if (Array.isArray(diceType?.variants) && diceType.variants.length) {
        return diceType.variants;
      }
    } catch {}
    return [
      { value: '4', label: 'D4' },
      { value: '6', label: 'D6' },
      { value: '8', label: 'D8' },
      { value: '10', label: 'D10' },
      { value: '12', label: 'D12' },
      { value: '20', label: 'D20' },
      { value: '100', label: 'D100' },
    ];
  }

 _resolveSpecialTypes() {
  try {
    // supporta più etichette di categoria: 'array', 'special', 'specials', 'extra'
    const catNames = ['array', 'special', 'specials', 'extra'];
    let list = [];

    if (this.launchTypesRegistry?.getTypesByCategory) {
      catNames.forEach(cat => {
        const chunk = this.launchTypesRegistry.getTypesByCategory(cat) || [];
        list.push(...chunk);
      });
    }

    // fallback: prendi tutto e filtra per category ∈ catNames
    if (!list.length && this.launchTypesRegistry?.getAll) {
      const all = this.launchTypesRegistry.getAll() || [];
      list = all.filter(t => catNames.includes(t?.category));
    }

    // normalizza e ordina
    list = list
      .filter(t => t && t.id && (t.name || t.label))
      .map(t => ({
        ...t,
        name: t.name || t.label,   // copre registri che usano 'label'
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return list;
  } catch {
    return [];
  }
}


  _getVisibleColorsLazy() {
    // Prova i metodi del registry; se vuoto, riprendi il registry (arrivato in ritardo), poi fallback
    let colors = [];
    try {
      colors = (this.colorTypesRegistry?.getVisibleColors?.() || this.colorTypesRegistry?.getAllColors?.() || []);
      if (!colors.length) {
        this.colorTypesRegistry = getColorTypesRegistry(window);
        colors = (this.colorTypesRegistry?.getVisibleColors?.() || this.colorTypesRegistry?.getAllColors?.() || []);
      }
    } catch {
      colors = [];
    }
    if (!colors.length) colors = [{ id: 'base', label: 'Base', emoji: '' }];
    return colors;
  }

  _refreshTypesIfEmpty() {
    let updated = false;

    if (!Array.isArray(this.classicVariants) || !this.classicVariants.length) {
      this.launchTypesRegistry = getLaunchTypesRegistry(window);
      this.classicVariants = this._resolveClassicVariants();
      updated = true;
    }

    if (!Array.isArray(this.specialTypes) || !this.specialTypes.length) {
      this.launchTypesRegistry = getLaunchTypesRegistry(window);
      this.specialTypes = this._resolveSpecialTypes();
      updated = true;
    }

    return updated;
  }

  _injectAntiClippingCSS() {
    const css = `
      .preset-card, .preset-body, .dice-builder, .dice-input-inline { overflow: visible !important; }
      .preset-card, .preset-body, .dice-builder { position: static !important; }
      select.dice-type-preset, select.dice-color-preset, select.dice-count-preset { position: relative; z-index: 9999; }
      .admin-panel, .preset-card, .preset-body, .dice-builder, .dice-input-inline {
        transform: none !important; filter: none !important; perspective: none !important;
      }
    `;
    const tag = document.createElement('style');
    tag.setAttribute('data-admin-panel-fix', 'select-anticlipping');
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  /* ---------- UI wiring ---------- */

  initializeElements() {
    this.saveButton = document.getElementById('saveEffects');
    this.resetButton = document.getElementById('resetEffects');
    this.addRuleButton = document.getElementById('addEffectRule');
    this.rulesList = document.getElementById('effectRulesList');
    this.saveStatus = document.getElementById('saveStatus');
    this.testArea = document.getElementById('testArea');
    this.diceRollerVisibleCheckbox = document.getElementById('diceRollerVisible');
    this.groupFilter = document.getElementById('groupFilter');
    this.presetTagFilter = document.getElementById('presetTagFilter');
    this.addPresetButton = document.getElementById('addPreset');
    this.presetsList = document.getElementById('presetsList');
    this.savePresetsButton = document.getElementById('savePresets');
    this.presetSaveStatus = document.getElementById('presetSaveStatus');
  }

  _log(message, type = 'info', data = null) {
    return;
  }

  bindEvents() {
    this.saveButton?.addEventListener('click', () => this.saveConfiguration());
    this.resetButton?.addEventListener('click', () => this.resetConfiguration());
    this.addRuleButton?.addEventListener('click', () => this.addEffectRule());

    if (this.diceRollerVisibleCheckbox) {
      this.diceRollerVisibleCheckbox.addEventListener('change', async (e) => {
        this.diceRollerVisible = e.target.checked;
        this.showStatus(this.diceRollerVisible ? '✅ Tiradadi visibile' : '🔒 Tiradadi nascosto', 'success');
        await this.saveDiceRollerVisibility();
      });
    }

    this.groupFilter?.addEventListener('change', () => this.renderRules());

    this.addPresetButton?.addEventListener('click', () => this.addPreset());
    this.savePresetsButton?.addEventListener('click', () => this.savePresets());

    document.querySelectorAll('.btn-preview-effect').forEach(btn => {
      btn.addEventListener('click', (e) => this.previewEffect(e.target.dataset.effect));
    });

    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-tag-active') || e.target.classList.contains('btn-tag-inactive')) {
        const tag = e.target.dataset.tag;
        if (tag) this.toggleRulesByTag(tag);
      }
      if (e.target.classList.contains('btn-tag-preset-active') || e.target.classList.contains('btn-tag-preset-inactive')) {
        const tag = e.target.dataset.tag;
        if (tag) this.togglePresetsByTag(tag);
      }
    });

    this.presetTagFilter?.addEventListener('change', () => this.renderPresets());
  }

  /* ---------- Load & Save ---------- */

  async loadConfiguration() {
    try {
      const configDoc = await this.firestore.collection('effectsConfig').doc('config').get();
      const configData = configDoc.exists ? configDoc.data() : {};
      this.diceRollerVisible = configData.diceRollerVisible !== false;

      const rulesSnapshot = await this.firestore.collection('effectRules').get();
      this.rules = rulesSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          diceCondition: data.condition || data.diceCondition || '',
          priority: typeof data.priority === 'number' ? data.priority : 0
        };
      });

      this.updateDiceRollerVisibilityUI();
      if (!this._isInitializing) {
        this.renderRules();
      }
    } catch (error) {
      console.error('Errore nel caricamento della configurazione:', error);
      this.showStatus('Errore nel caricamento della configurazione', 'error');
      this.rules = [];
      this.diceRollerVisible = true;
      if (!this._isInitializing) {
        this.renderRules();
      }
    }
  }

  async loadPresets() {
    try {
      const snapshot = await this.firestore.collection('presets').get();
      this.presets = snapshot.empty ? [] : snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));

      if (!this._isInitializing) {
        this.renderPresets();
      }
    } catch (error) {
      console.error('Errore nel caricamento dei preset:', error);
      this.presets = [];
      if (!this._isInitializing) {
        this.renderPresets();
      }
    }
  }

  async saveConfiguration() {
    const errors = this.validateRules();
    if (errors.length > 0) {
      alert('❌ Impossibile salvare:\n\n' + errors.join('\n'));
      this.showStatus('❌ Errori di validazione. Controlla le regole.', 'error');
      return;
    }

    try {
      await this.firestore.collection('effectsConfig').doc('config').set({
        diceRollerVisible: this.diceRollerVisible
      });

      const rulesRef = this.firestore.collection('effectRules');
      const existing = await rulesRef.get();
      const batch = this.firestore.batch();
      existing.docs.forEach(doc => batch.delete(doc.ref));

      this.rules.forEach(rule => {
        const { id, diceCondition, ...ruleData } = rule;
        // Salva come 'condition' invece di 'diceCondition'
        if (id) {
          batch.set(rulesRef.doc(id), {
            ...ruleData,
            condition: diceCondition
          });
        }
      });

      await batch.commit();
      this.showStatus('✅ Configurazione salvata con successo!', 'success');
    } catch (error) {
      console.error('Errore nel salvataggio:', error);
      this.showStatus('❌ Errore nel salvataggio della configurazione', 'error');
    }
  }

  async savePresets() {
    const errors = this.validatePresets();
    if (errors.length > 0) {
      alert('❌ Impossibile salvare:\n\n' + errors.join('\n'));
      this.showPresetStatus('❌ Errori di validazione. Controlla i preset.', 'error');
      return;
    }

    try {
      const batch = this.firestore.batch();
      const existing = await this.firestore.collection('presets').get();
      existing.docs.forEach(doc => batch.delete(doc.ref));

      this.presets.forEach(preset => {
        const { id, ...presetData } = preset;
        batch.set(this.firestore.collection('presets').doc(id), presetData);
      });

      await batch.commit();
      this.showPresetStatus('✅ Preset salvati con successo!', 'success');
    } catch (error) {
      console.error('Errore nel salvataggio dei preset:', error);
      this.showPresetStatus('❌ Errore nel salvataggio dei preset', 'error');
    }
  }

  async resetConfiguration() {
    if (!confirm('⚠️ Sei sicuro di voler eliminare tutte le regole? Questa azione non può essere annullata.')) return;
    try {
      this.rules = [];
      const rulesRef = this.firestore.collection('effectRules');
      const existing = await rulesRef.get();
      const batch = this.firestore.batch();
      existing.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      await this.firestore.collection('effectsConfig').doc('config').set({
        diceRollerVisible: this.diceRollerVisible
      });

      this.renderRules();
      this.showStatus('🔄 Configurazione ripristinata ai valori predefiniti', 'success');
    } catch (error) {
      console.error('Errore nel ripristino:', error);
      this.showStatus('❌ Errore nel ripristino della configurazione', 'error');
    }
  }

  async saveRuleToFirestore(rule) {
    if (!rule.id) return;
    try {
      const { id, ...ruleData } = rule;
      await this.firestore.collection('effectRules').doc(id).set(ruleData);
    } catch (error) {
      console.error('Errore salvataggio regola:', error);
    }
  }

  async savePresetToFirestore(preset) {
    if (!preset.id) return;
    try {
      const { id, ...presetData } = preset;
      await this.firestore.collection('presets').doc(id).set(presetData);
    } catch (error) {
      console.error('Errore salvataggio preset:', error);
    }
  }

  async saveDiceRollerVisibility() {
    try {
      await this.firestore.collection('effectsConfig').doc('config').set({
        diceRollerVisible: this.diceRollerVisible
      });
    } catch (error) {
      console.error('Errore salvataggio visibilità tiradadi:', error);
    }
  }

  /* ---------- Helpers UI ---------- */

  showStatus(message, type) {
    this.saveStatus.textContent = message;
    this.saveStatus.className = `save-status ${type}`;
    setTimeout(() => {
      this.saveStatus.className = 'save-status';
      this.saveStatus.textContent = '';
    }, 5000);
  }

  showPresetStatus(message, type) {
    if (!this.presetSaveStatus) return;
    this.presetSaveStatus.textContent = message;
    this.presetSaveStatus.className = `save-status ${type}`;
    setTimeout(() => {
      this.presetSaveStatus.className = 'save-status';
      this.presetSaveStatus.textContent = '';
    }, 5000);
  }

  getAllTags() {
    const tagsSet = new Set();
    this.rules.forEach(rule => {
      if (rule.tags && Array.isArray(rule.tags)) {
        rule.tags.forEach(tag => tagsSet.add(tag));
      }
    });
    return Array.from(tagsSet).sort();
  }

  getAllGroups() {
    const groupsSet = new Set();
    this.rules.forEach(rule => {
      const group = rule.group || 'Senza Gruppo';
      groupsSet.add(group);
    });
    return Array.from(groupsSet).sort();
  }

  updateGroupFilter() {
    if (!this.groupFilter) return;
    const currentValue = this.groupFilter.value;
    const groups = this.getAllGroups();
    this.groupFilter.innerHTML = '<option value="all">Tutti i Gruppi</option>';
    groups.forEach(group => {
      const option = document.createElement('option');
      option.value = group;
      option.textContent = group;
      if (group === currentValue) option.selected = true;
      this.groupFilter.appendChild(option);
    });
  }

  async toggleRulesByTag(tag) {
    const rulesWithTag = this.rules.filter(r => r.tags && r.tags.includes(tag));
    if (rulesWithTag.length === 0) {
      this.showStatus(`⚠️ Nessuna regola con tag "${tag}"`, 'warning');
      return;
    }
    const allEnabled = rulesWithTag.every(r => r.enabled);
    rulesWithTag.forEach(rule => { rule.enabled = !allEnabled; });
    this.renderRules();
    this.showStatus(`🏷️ Tag "${tag}": ${allEnabled ? 'disattivato' : 'attivato'}`, 'success');
    for (const rule of rulesWithTag) {
      await this.saveRuleToFirestore(rule);
    }
  }

  updateDiceRollerVisibilityUI() {
    if (this.diceRollerVisibleCheckbox) {
      this.diceRollerVisibleCheckbox.checked = this.diceRollerVisible;
    }
  }

  validateRules() {
    const errors = [];
    const ids = new Set();
    this.rules.forEach((rule) => {
      if (!rule.id || rule.id.trim() === '') {
        errors.push(`⚠️ Regola "${rule.name}" non ha un ID`);
      } else if (ids.has(rule.id)) {
        errors.push(`⚠️ ID duplicato: "${rule.id}"`);
      } else {
        ids.add(rule.id);
      }
    });
    return errors;
  }

  /* ---------- Rules rendering ---------- */

  renderRules() {
    if (this._isInitializing) return;

    if (this._renderRulesTimeout) {
      clearTimeout(this._renderRulesTimeout);
    }

    this._renderRulesTimeout = setTimeout(() => {
      this._renderRulesNow();
    }, 50);
  }

  _renderRulesNow() {
    this.rulesList.innerHTML = '';

    if (this.rules.length === 0) {
      this.rulesList.innerHTML = '<p class="no-rules">Nessuna regola configurata. Clicca su "Aggiungi Regola" per iniziare.</p>';
      return;
    }

    // NON ordinare le regole per evitare spostamenti delle card
    // L'ordine di applicazione è gestito dal campo priority

    const selectedGroup = this.groupFilter ? this.groupFilter.value : 'all';
    const filteredRules = selectedGroup === 'all'
      ? this.rules
      : this.rules.filter(r => r.group === selectedGroup);

    if (filteredRules.length === 0) {
      this.rulesList.innerHTML = '<p class="no-rules">Nessuna regola in questo gruppo.</p>';
      return;
    }

    const priorityInfo = document.createElement('div');
    priorityInfo.className = 'priority-info-section';
    priorityInfo.innerHTML = `
      <h4>⚠️ Ordine di Applicazione (Gerarchia)</h4>
      <p>Le regole vengono applicate in ordine di <strong>priorità crescente</strong> (0, 1, 2, ...).
      Le regole con priorità 0 vengono applicate per prime, poi quelle con priorità 1, e così via.
      Se una regola con FILTRA matcha dei dadi, solo quei dadi saranno disponibili per le regole successive.</p>
      <small>💡 Usa i pulsanti ⬆️ ⬇️ per modificare la priorità. Le card NON si riordinano automaticamente.</small>
    `;
    this.rulesList.appendChild(priorityInfo);

    const allTags = this.getAllTags();
    if (allTags.length > 0) {
      const tagsSection = document.createElement('div');
      tagsSection.className = 'tags-section';
      tagsSection.innerHTML = '<h4>🏷️ Gestione Tag Regole:</h4><div class="tags-container"></div>';
      const tagsContainer = tagsSection.querySelector('.tags-container');

      allTags.forEach(tag => {
        const rulesWithTag = this.rules.filter(r => r.tags && r.tags.includes(tag));
        const allEnabled = rulesWithTag.every(r => r.enabled);
        const tagBtn = document.createElement('button');
        tagBtn.className = allEnabled ? 'btn-tag-active' : 'btn-tag-inactive';
        tagBtn.dataset.tag = tag;
        tagBtn.textContent = `${allEnabled ? '✓' : '○'} ${tag}`;
        tagBtn.title = `${rulesWithTag.length} regola/e - Clicca per attivare/disattivare`;
        tagsContainer.appendChild(tagBtn);
      });

      this.rulesList.appendChild(tagsSection);
    }

    this.updateGroupFilter();

    filteredRules.forEach((rule, index) => {
      const ruleCard = this.createRuleCard(rule, index);
      this.rulesList.appendChild(ruleCard);
    });
  }

  createRuleCard(rule, index) {
    const card = document.createElement('div');
    card.className = 'rule-card';
    card.dataset.ruleId = rule.id || `temp-${index}`;
    card.dataset.ruleIndex = index;
    card.dataset.collapsed = 'true';

    card.innerHTML = `
      <div class="rule-header">
        <div class="rule-title">
          <button class="btn-collapse" title="Espandi/Comprimi regola">▼</button>
          <div class="priority-controls">
            <button class="btn-priority-down" title="Diminuisci priorità (applica prima)">⬇️</button>
            <input type="number" class="priority-input" value="${rule.priority || 0}" min="0" title="Priorità: 0 = prima, 1 = dopo, 2 = ancora dopo...">
            <button class="btn-priority-up" title="Aumenta priorità (applica dopo)">⬆️</button>
          </div>
          <input type="checkbox" class="rule-enabled" ${rule.enabled ? 'checked' : ''}>
          <input type="text" class="rule-name" value="${rule.name}" placeholder="Nome regola">
        </div>
        <div class="rule-actions">
          <button class="btn-copy-id" data-rule-id="${rule.id}" title="Copia ID">📋</button>
          <button class="btn-duplicate-rule" title="Duplica regola">📑</button>
          <button class="btn-delete-rule" title="Elimina regola">🗑️</button>
        </div>
      </div>

      <div class="rule-id-section">
        <label>🆔 ID Regola (obbligatorio):</label>
        <input type="text" class="rule-id" value="${rule.id || ''}" placeholder="es: successo, fallimento, critico_d20" maxlength="50">
        <small class="rule-id-hint">${rule.id ? '✅ ID configurato' : '⚠️ L' + "'ID è obbligatorio per salvare. Deve essere univoco."}</small>
      </div>

      <div class="rule-body">
        <div class="form-group">
          <label>🎲 Condizione Dadi:</label>
          <input type="text" class="rule-dice-condition" value="${rule.diceCondition || ''}" placeholder="D6=1, D6=1 + D6=1, D*=1, 2D6=alto, 2D6=basso">
          <small>Sintassi: <strong>D6=1</strong> (singolo), <strong>D6=1 + D6=1</strong> (multipli), <strong>D*=1</strong> (qualsiasi dado=1), <strong>2D6=alto</strong> (i 2 D6 più alti), <strong>2D6=basso</strong> (i 2 D6 più bassi)</small>
        </div>

        <div class="form-group">
          <label>🎯 Tipo Effetto:</label>
          <select class="rule-effect-type">
            <option value="success" ${rule.effectType === 'success' ? 'selected' : ''}>✅ Successo</option>
            <option value="failure" ${rule.effectType === 'failure' ? 'selected' : ''}>❌ Fallimento</option>
            <option value="custom" ${rule.effectType === 'custom' ? 'selected' : ''}>🎨 Personalizzato</option>
          </select>
        </div>

        <div class="effects-row">
          <div class="effects-section">
            <h4>💫 Particelle / Fumo</h4>
            <select class="rule-particle-effect">
              <option value="none" ${!rule.particleEffect || rule.particleEffect==='none' ? 'selected' : ''}>Nessuno</option>
              <optgroup label="✨ Successo">
                <option value="particles-gold" ${rule.particleEffect === 'particles-gold' ? 'selected' : ''}>⭐ Particelle Dorate</option>
                <option value="particles-silver" ${rule.particleEffect === 'particles-silver' ? 'selected' : ''}>⚪ Particelle Argentate</option>
                <option value="particles-rainbow" ${rule.particleEffect === 'particles-rainbow' ? 'selected' : ''}>🌈 Particelle Arcobaleno</option>
                <option value="particles-fire" ${rule.particleEffect === 'particles-fire' ? 'selected' : ''}>🔥 Fuoco</option>
                <option value="particles-ice" ${rule.particleEffect === 'particles-ice' ? 'selected' : ''}>❄️ Ghiaccio</option>
                <option value="particles-green" ${rule.particleEffect === 'particles-green' ? 'selected' : ''}>💚 Particelle Verdi</option>
                <option value="particles-purple" ${rule.particleEffect === 'particles-purple' ? 'selected' : ''}>💜 Particelle Viola</option>
              </optgroup>
              <optgroup label="💨 Fallimento">
                <option value="smoke-dark" ${rule.particleEffect === 'smoke-dark' ? 'selected' : ''}>⚫ Fumo Scuro</option>
                <option value="smoke-white" ${rule.particleEffect === 'smoke-white' ? 'selected' : ''}>⚪ Fumo Bianco</option>
                <option value="smoke-colored" ${rule.particleEffect === 'smoke-colored' ? 'selected' : ''}>🎨 Fumo Colorato</option>
                <option value="smoke-spiral" ${rule.particleEffect === 'smoke-spiral' ? 'selected' : ''}>🌀 Fumo Spirale</option>
                <option value="smoke-explosion" ${rule.particleEffect === 'smoke-explosion' ? 'selected' : ''}>💥 Fumo Esplosione</option>
              </optgroup>
            </select>
          </div>

          <div class="effects-section">
            <h4>✨ Bagliore</h4>
            <select class="rule-glow-effect">
              <option value="none" ${!rule.glowEffect || rule.glowEffect==='none' ? 'selected' : ''}>Nessuno</option>
              <optgroup label="✨ Successo">
                <option value="glow-gold" ${rule.glowEffect === 'glow-gold' ? 'selected' : ''}>⭐ Bagliore Dorato</option>
                <option value="glow-blue" ${rule.glowEffect === 'glow-blue' ? 'selected' : ''}>🔵 Bagliore Blu</option>
                <option value="glow-green" ${rule.glowEffect === 'glow-green' ? 'selected' : ''}>💚 Bagliore Verde</option>
                <option value="glow-purple" ${rule.glowEffect === 'glow-purple' ? 'selected' : ''}>💜 Bagliore Viola</option>
                <option value="glow-rainbow" ${rule.glowEffect === 'glow-rainbow' ? 'selected' : ''}>🌈 Bagliore Arcobaleno</option>
                <option value="glow-intense" ${rule.glowEffect === 'glow-intense' ? 'selected' : ''}>💥 Bagliore Intenso</option>
              </optgroup>
              <optgroup label="💀 Fallimento">
                <option value="glow-red" ${rule.glowEffect === 'glow-red' ? 'selected' : ''}>🔴 Bagliore Rosso</option>
                <option value="glow-red-pulse" ${rule.glowEffect === 'glow-red-pulse' ? 'selected' : ''}>❤️‍🔥 Bagliore Rosso Pulsante</option>
              </optgroup>
            </select>
          </div>

          <div class="effects-section">
            <h4>🎪 Movimento</h4>
            <select class="rule-window-effect">
              <option value="none" ${!rule.windowEffect || rule.windowEffect==='none' ? 'selected' : ''}>Nessuno</option>
              <optgroup label="✨ Successo">
                <option value="bounce" ${rule.windowEffect === 'bounce' ? 'selected' : ''}>🎾 Rimbalzo</option>
                <option value="bounce-high" ${rule.windowEffect === 'bounce-high' ? 'selected' : ''}>🚀 Rimbalzo Alto</option>
                <option value="spin" ${rule.windowEffect === 'spin' ? 'selected' : ''}>🔄 Rotazione</option>
                <option value="spin-fast" ${rule.windowEffect === 'spin-fast' ? 'selected' : ''}>⚡ Rotazione Veloce</option>
                <option value="scale-pulse" ${rule.windowEffect === 'scale-pulse' ? 'selected' : ''}>💓 Pulsazione</option>
                <option value="flip" ${rule.windowEffect === 'flip' ? 'selected' : ''}>🔃 Flip</option>
              </optgroup>
              <optgroup label="💀 Fallimento">
                <option value="shake" ${rule.windowEffect === 'shake' ? 'selected' : ''}>😰 Scossa Leggera</option>
                <option value="shake-hard" ${rule.windowEffect === 'shake-hard' ? 'selected' : ''}>💀 Scossa Forte</option>
                <option value="wobble" ${rule.windowEffect === 'wobble' ? 'selected' : ''}>🤢 Oscillazione</option>
              </optgroup>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>💬 Messaggio:</label>
            <input type="text" class="rule-text" value="${rule.text || ''}" placeholder="Testo da mostrare" maxlength="50">
          </div>

          <div class="form-group">
            <label>📝 Emoji:</label>
            <input type="text" class="rule-emoji" value="${rule.emoji || ''}" placeholder="🎯" maxlength="10">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>🏷️ Tag (separati da virgola):</label>
            <input type="text" class="rule-tags" value="${(rule.tags || []).join(', ')}" placeholder="d20, critico, successo">
            <div class="tags-display">
              ${(rule.tags || []).map(tag => `<span class="tag-chip tag-chip-active">${tag}</span>`).join('')}
            </div>
          </div>

          <div class="form-group">
            <label>📁 Gruppo:</label>
            <input type="text" class="rule-group" value="${rule.group || ''}" placeholder="Nome del gruppo">
          </div>
        </div>

        <div class="form-group custom-text-editor" style="display: ${rule.effectType === 'custom' ? 'block' : 'none'};">
          <label>🎨 Stile Dadi Personalizzato:</label>
          <div class="custom-text-controls">
            <small>Quando questa regola si attiva, i dadi che matchano appaiono in grassetto e col colore scelto.</small>
            <div class="custom-text-options">
              <label>Colore Dado: <input type="color" class="rule-dice-color" value="${rule.diceColor || '#FFD700'}"></label>
            </div>
          </div>
        </div>
      </div>
    `;

    const enabledCheckbox = card.querySelector('.rule-enabled');
    const nameInput = card.querySelector('.rule-name');
    const collapseBtn = card.querySelector('.btn-collapse');
    const deleteBtn = card.querySelector('.btn-delete-rule');
    const duplicateBtn = card.querySelector('.btn-duplicate-rule');
    const copyIdBtn = card.querySelector('.btn-copy-id');
    const priorityUpBtn = card.querySelector('.btn-priority-up');
    const priorityDownBtn = card.querySelector('.btn-priority-down');
    const priorityInput = card.querySelector('.priority-input');
    const ruleBody = card.querySelector('.rule-body');

    enabledCheckbox.addEventListener('change', async (e) => {
      rule.enabled = e.target.checked;
      this.showStatus(rule.enabled ? '✅ Regola attivata' : '⏸️ Regola disattivata', 'success');
      await this.saveRuleToFirestore(rule);
    });

    nameInput.addEventListener('input', (e) => { rule.name = e.target.value; });

    const idInput = card.querySelector('.rule-id');
    const idHint = card.querySelector('.rule-id-hint');
    const updateRuleId = () => {
      const rawId = idInput.value.trim();
      const sanitizedId = rawId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      if (rawId !== sanitizedId) idInput.value = sanitizedId;

      const currentIndex = this.rules.findIndex(r => r === rule);
      if (currentIndex !== -1) this.rules[currentIndex].id = sanitizedId;
      rule.id = sanitizedId;

      if (this.rules.filter(r => r.id === sanitizedId).length > 1) {
        idInput.style.borderColor = '#ff4444';
        idInput.title = 'ID duplicato!';
        idHint.textContent = '❌ ID duplicato!';
        idHint.style.color = '#ff4444';
      } else if (!sanitizedId) {
        idInput.style.borderColor = '#ff4444';
        idInput.title = 'ID obbligatorio!';
        idHint.textContent = '⚠️ L\'ID è obbligatorio per salvare. Deve essere univoco.';
        idHint.style.color = '#ff9800';
      } else {
        idInput.style.borderColor = '#4CAF50';
        idInput.title = 'ID valido';
        idHint.textContent = '✅ ID configurato correttamente';
        idHint.style.color = '#4CAF50';
      }
    };
    idInput.addEventListener('input', updateRuleId);
    idInput.addEventListener('blur', updateRuleId);
    updateRuleId();

    collapseBtn.addEventListener('click', () => {
      const isCollapsed = card.dataset.collapsed === 'true';
      card.dataset.collapsed = !isCollapsed;
      collapseBtn.textContent = isCollapsed ? '▲' : '▼';
      ruleBody.style.display = isCollapsed ? 'flex' : 'none';
    });

    deleteBtn.addEventListener('click', () => this.deleteRule(rule.id));
    duplicateBtn.addEventListener('click', () => this.duplicateRule(rule));
    copyIdBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(rule.id)
        .then(() => this.showStatus(`📋 ID copiato: ${rule.id}`, 'success'))
        .catch(() => this.showStatus('❌ Errore nella copia dell\'ID', 'error'));
    });

    priorityUpBtn.addEventListener('click', () => this.changePriority(rule, 1));
    priorityDownBtn.addEventListener('click', () => this.changePriority(rule, -1));

    priorityInput.addEventListener('change', (e) => {
      const newPriority = parseInt(e.target.value);
      if (!isNaN(newPriority) && newPriority >= 0) {
        rule.priority = newPriority;
        // NON chiamare renderRules per evitare spostamenti delle card
        this.showStatus(`🔢 Priorità impostata: ${newPriority}`, 'success');
      } else {
        e.target.value = rule.priority || 0;
        this.showStatus('⚠️ Inserisci un numero valido maggiore o uguale a 0', 'warning');
      }
    });

    ruleBody.style.display = 'none';

    const effectTypeSelect = card.querySelector('.rule-effect-type');
    effectTypeSelect.addEventListener('change', (e) => {
      const customTextEditor = card.querySelector('.custom-text-editor');
      customTextEditor.style.display = e.target.value === 'custom' ? 'block' : 'none';
      this.updateRuleFromCard(rule, card);
    });

    card.querySelectorAll('input, select').forEach(input => {
      if (!input.classList.contains('rule-enabled') && !input.classList.contains('rule-name')) {
        input.addEventListener('change', () => this.updateRuleFromCard(rule, card));
      }
    });

    const tagsInput = card.querySelector('.rule-tags');
    tagsInput?.addEventListener('input', () => this.updateRuleFromCard(rule, card));

    return card;
  }

  updateRuleFromCard(rule, card) {
    rule.diceCondition = card.querySelector('.rule-dice-condition').value;
    rule.effectType = card.querySelector('.rule-effect-type').value;
    rule.particleEffect = card.querySelector('.rule-particle-effect').value;
    rule.glowEffect = card.querySelector('.rule-glow-effect').value;
    rule.windowEffect = card.querySelector('.rule-window-effect').value;
    rule.text = card.querySelector('.rule-text').value;
    rule.emoji = card.querySelector('.rule-emoji').value;

    const tagsInput = card.querySelector('.rule-tags');
    rule.tags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t.length > 0);
    rule.group = card.querySelector('.rule-group').value || 'Senza Gruppo';

    const tagsDisplay = card.querySelector('.tags-display');
    if (tagsDisplay) {
      tagsDisplay.innerHTML = rule.tags.map(tag => `<span class="tag-chip tag-chip-active">${tag}</span>`).join('');
    }

    if (rule.effectType === 'custom') {
      const diceColorInput = card.querySelector('.rule-dice-color');
      if (diceColorInput) rule.diceColor = diceColorInput.value;
    }
  }

  addEffectRule() {
    const maxPriority = this.rules.length > 0 ? Math.max(...this.rules.map(r => r.priority || 0)) : 0;
    const newRule = {
      id: '',
      name: 'Nuova Regola',
      diceCondition: 'D20=20',
      effectType: 'success',
      particleEffect: 'particles-gold',
      glowEffect: 'glow-gold',
      windowEffect: 'bounce',
      text: 'EFFETTO SPECIALE!',
      emoji: '✨',
      enabled: true,
      tags: [],
      group: 'Senza Gruppo',
      priority: maxPriority + 1
    };
    this.rules.unshift(newRule);
    this.renderRules();
    this.showStatus('➕ Nuova regola aggiunta. Inserisci un ID prima di salvare!', 'warning');
  }

  duplicateRule(rule) {
    const maxPriority = this.rules.length > 0 ? Math.max(...this.rules.map(r => r.priority || 0)) : 0;
    const duplicatedRule = { ...rule, id: '', name: `${rule.name} (Copia)`, enabled: true, priority: maxPriority + 1 };
    this.rules.unshift(duplicatedRule);
    this.renderRules();
    this.showStatus('📑 Regola duplicata. Inserisci un ID prima di salvare!', 'warning');
  }

  changePriority(rule, delta) {
    const currentPriority = rule.priority || 0;
    const newPriority = currentPriority + delta;

    if (newPriority < 0) {
      this.showStatus('⚠️ La priorità non può essere negativa', 'warning');
      return;
    }

    rule.priority = newPriority;
    // Aggiorna solo il valore nel DOM senza re-renderizzare tutto
    const ruleIndex = this.rules.indexOf(rule);
    const cards = this.rulesList.querySelectorAll('.rule-card');
    cards.forEach(card => {
      if (parseInt(card.dataset.ruleIndex) === ruleIndex) {
        const input = card.querySelector('.priority-input');
        if (input) input.value = newPriority;
      }
    });
    this.showStatus(`🔢 Priorità aggiornata: ${newPriority}`, 'success');
  }

  deleteRule(ruleId) {
    if (!confirm('Sei sicuro di voler eliminare questa regola?')) return;
    this.rules = this.rules.filter(r => r.id !== ruleId);
    this.renderRules();
    this.showStatus('🗑️ Regola eliminata', 'success');
  }

  testRule(rule) {
    const testArea = this.testArea;
    testArea.innerHTML = `
      <h4>${rule.emoji || ''} ${rule.name || ''}</h4>
      <p><strong>Condizione:</strong> ${rule.diceCondition || ''}</p>
      <p><strong>Messaggio:</strong> ${rule.text || ''}</p>
    `;
    setTimeout(() => {
      this.effectsEngine.applyEffects(testArea, rule);
      if (rule.effectType === 'custom' && rule.customText) {
        this.effectsEngine.showTextEffectWithOffset(testArea, null, null, -50, rule);
      } else if (rule.text || rule.emoji) {
        this.effectsEngine.showTextEffect(testArea, rule.text, rule.emoji);
      }
    }, 100);
  }

  previewEffect(effectType) {
    const testArea = this.testArea;
    testArea.innerHTML = `
      <h4>🎨 Anteprima: ${effectType}</h4>
      <p>Effetto in azione!</p>
    `;
    setTimeout(() => {
      const demoRule = {
        particleEffect: (effectType || '').startsWith('particles') || (effectType || '').startsWith('smoke') ? effectType : 'none',
        glowEffect: (effectType || '').startsWith('glow') ? effectType : 'none',
        windowEffect: ['shake', 'bounce', 'spin', 'scale-pulse', 'wobble', 'flip', 'bounce-high', 'spin-fast', 'shake-hard'].includes(effectType) ? effectType : 'none'
      };
      this.effectsEngine.applyEffects(testArea, demoRule);
    }, 100);
  }

  /* ---------- Preset UI ---------- */

  renderPresets() {
    if (!this.presetsList) return;
    if (this._isInitializing) return;

    this.presetsList.innerHTML = '';

    if (!Array.isArray(this.presets) || this.presets.length === 0) {
      this.presetsList.innerHTML = '<p class="no-presets">Nessun preset configurato. Clicca su "Aggiungi Preset" per iniziare.</p>';
      return;
    }

    const allPresetTags = this.getAllPresetTags();
    if (Array.isArray(allPresetTags) && allPresetTags.length > 0) {
      const tagsSection = document.createElement('div');
      tagsSection.className = 'tags-section';
      tagsSection.innerHTML = '<h4>🏷️ Gestione Tag Preset:</h4><div class="tags-container"></div>';
      const tagsContainer = tagsSection.querySelector('.tags-container');

      allPresetTags.forEach(tag => {
        const presetsWithTag = this.presets.filter(p => Array.isArray(p.tags) && p.tags.includes(tag));
        const allVisible = presetsWithTag.length > 0 && presetsWithTag.every(p => !!p.visible);

        const tagBtn = document.createElement('button');
        tagBtn.className = allVisible ? 'btn-tag-preset-active' : 'btn-tag-preset-inactive';
        tagBtn.dataset.tag = tag;
        tagBtn.title = `${presetsWithTag.length} preset - Clicca per mostrare/nascondere`;
        tagBtn.textContent = `${allVisible ? '✓' : '○'} ${tag}`;

        tagsContainer.appendChild(tagBtn);
      });

      this.presetsList.appendChild(tagsSection);
    }

    this.presetTagFilter && this.updatePresetTagFilter();

    const selectedTag = this.presetTagFilter ? (this.presetTagFilter.value || 'all') : 'all';
    const list = (selectedTag && selectedTag !== 'all')
      ? this.presets.filter(p => Array.isArray(p.tags) && p.tags.includes(selectedTag))
      : this.presets;

    if (list.length === 0) {
      this.presetsList.innerHTML += '<p class="no-presets">Nessun preset da mostrare con il filtro corrente.</p>';
      return;
    }

    // Aggiorna i tipi se erano vuoti (può capitare al primo render se registry arriva poi)
    this._refreshTypesIfEmpty();

    list.forEach((preset, index) => {
      const presetCard = this.createPresetCard(preset, index);
      this.presetsList.appendChild(presetCard);
    });
  }

  updatePresetTagFilter() {
    if (!this.presetTagFilter) return;
    const current = this.presetTagFilter.value || 'all';
    this.presetTagFilter.innerHTML = '<option value="all">Tutti i Tag</option>';
    const tags = this.getAllPresetTags();
    tags.forEach(tag => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = tag;
      this.presetTagFilter.appendChild(opt);
    });
    const exists = Array.from(this.presetTagFilter.options).some(o => o.value === current);
    this.presetTagFilter.value = exists ? current : 'all';
  }

  createPresetCard(preset, index) {
    const card = document.createElement('div');
    card.className = 'preset-card';
    card.dataset.presetId = preset.id;
    card.dataset.collapsed = 'true';

    const diceDisplay = (preset.dice || []).map(d => `${d.count}d${d.type}`).join(' + ');
    const rulesDisplay = (preset.rules || []).join(', ') || 'Nessuna';

    card.innerHTML = `
      <div class="preset-header">
        <div class="preset-title">
          <button class="btn-collapse-preset" title="Espandi/Comprimi preset">▼</button>
          <input type="checkbox" class="preset-visible" ${preset.visible ? 'checked' : ''}>
          <input type="text" class="preset-name" value="${preset.name || ''}" placeholder="Nome preset">
        </div>
        <div class="preset-actions">
          <button class="btn-duplicate-preset" title="Duplica preset">📑</button>
          <button class="btn-delete-preset" title="Elimina preset">🗑️</button>
        </div>
      </div>

      <div class="preset-id-section">
        <label>🆔 ID Preset (obbligatorio):</label>
        <input type="text" class="preset-id" value="${preset.id || ''}" placeholder="es: attacco, danno, iniziativa" maxlength="50">
        <small class="preset-id-hint">${preset.id ? '✅ ID configurato' : '⚠️ L' + "'ID è obbligatorio per salvare. Deve essere univoco."}</small>
      </div>

      <div class="preset-body">
        <div class="form-group">
          <label>🎲 Dadi:</label>
          <div class="dice-builder" data-preset-id="${preset.id}">
            ${(preset.dice || []).map((d, i) => this.createDiceInputHTML(d, i)).join('')}
          </div>
          <button class="btn-add-dice" data-preset-id="${preset.id}">+ Aggiungi dado</button>
        </div>

        <div class="form-group">
          <label>⚔️ Modificatore:</label>
          <input type="number" class="preset-modifier" value="${preset.modifier || 0}">
        </div>

        <div class="form-group">
          <label>🎯 Regole Associate:</label>
          <div class="rules-selector-container" data-preset-id="${preset.id}">
            <small style="display: block; margin-bottom: 8px;">⚠️ IMPORTANTE: Seleziona le regole da applicare. Se non ne selezioni nessuna, verranno usate TUTTE le regole attive.</small>
            <div class="rules-selector-list">
              ${this.createRulesSelectorHTML(preset)}
            </div>
          </div>
        </div>

        <div class="form-group">
          <label>🏷️ Tag Preset (separati da virgola):</label>
          <input type="text" class="preset-tags" value="${(preset.tags || []).join(', ')}" placeholder="combattimento, attacco, magia">
          <div class="tags-display">
            ${(preset.tags || []).map(tag => `<span class="tag-chip tag-chip-active">${tag}</span>`).join('')}
          </div>
        </div>

        <div class="form-group">
          <label>🎨 Colore Sfondo Preset:</label>
          <input type="color" class="preset-bg-color" value="${preset.bgColor || '#5e81ac'}">
          <small>Questo colore verrà applicato come sfondo del pulsante preset visibile nell'index</small>
        </div>
      </div>
    `;

    const visibleCheckbox = card.querySelector('.preset-visible');
    const nameInput = card.querySelector('.preset-name');
    const collapseBtn = card.querySelector('.btn-collapse-preset');
    const deleteBtn = card.querySelector('.btn-delete-preset');
    const duplicateBtn = card.querySelector('.btn-duplicate-preset');
    const addDiceBtn = card.querySelector('.btn-add-dice');
    const presetBody = card.querySelector('.preset-body');

    presetBody.style.display = 'none';

    collapseBtn.addEventListener('click', () => {
      const isCollapsed = card.dataset.collapsed === 'true';
      card.dataset.collapsed = !isCollapsed;
      collapseBtn.textContent = isCollapsed ? '▲' : '▼';
      presetBody.style.display = isCollapsed ? 'flex' : 'none';
    });

    visibleCheckbox.addEventListener('change', async (e) => {
      preset.visible = e.target.checked;
      this.showPresetStatus(preset.visible ? '✅ Preset visibile' : '⏸️ Preset nascosto', 'success');
      await this.savePresetToFirestore(preset);
    });

    nameInput.addEventListener('input', (e) => { preset.name = e.target.value; });

    const idInput = card.querySelector('.preset-id');
    const idHint = card.querySelector('.preset-id-hint');
    const updatePresetId = () => {
      const rawId = idInput.value.trim();
      const sanitizedId = rawId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      if (rawId !== sanitizedId) idInput.value = sanitizedId;

      const currentIndex = this.presets.findIndex(p => p === preset);
      if (currentIndex !== -1) this.presets[currentIndex].id = sanitizedId;
      preset.id = sanitizedId;

      if (this.presets.filter(p => p.id === sanitizedId).length > 1) {
        idInput.style.borderColor = '#ff4444';
        idInput.title = 'ID duplicato!';
        idHint.textContent = '❌ ID duplicato!';
        idHint.style.color = '#ff4444';
      } else if (!sanitizedId) {
        idInput.style.borderColor = '#ff4444';
        idInput.title = 'ID obbligatorio!';
        idHint.textContent = '⚠️ L\'ID è obbligatorio per salvare. Deve essere univoco.';
        idHint.style.color = '#ff9800';
      } else {
        idInput.style.borderColor = '#4CAF50';
        idInput.title = 'ID valido';
        idHint.textContent = '✅ ID configurato correttamente';
        idHint.style.color = '#4CAF50';
      }
    };
    idInput.addEventListener('input', updatePresetId);
    idInput.addEventListener('blur', updatePresetId);
    updatePresetId();

    deleteBtn.addEventListener('click', () => this.deletePreset(preset.id));
    duplicateBtn.addEventListener('click', () => this.duplicatePreset(preset));

    addDiceBtn.addEventListener('click', (e) => {
      e.preventDefault();
      preset.dice = Array.isArray(preset.dice) ? preset.dice : [];
      preset.dice.push({ count: 1, type: '6', color: 'base' });
      this.updatePresetDiceUI(card, preset);
      this.showPresetStatus('➕ Dado aggiunto al preset', 'success');
    });

    card.querySelectorAll('input:not(.preset-visible):not(.preset-name), select').forEach(input => {
      input.addEventListener('change', () => this.updatePresetFromCard(preset, card));
    });

    card.querySelectorAll('.rule-selector-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        this.updatePresetFromCard(preset, card);
        this.updateRulesSelectorUI(card, preset);
      });
    });

    const presetTagsInput = card.querySelector('.preset-tags');
    presetTagsInput?.addEventListener('input', () => this.updatePresetFromCard(preset, card));

    this.attachDiceInputListeners(card, preset);

    return card;
  }

  attachDiceInputListeners(card, preset) {
    const diceBuilder = card.querySelector('.dice-builder');
    if (!diceBuilder) return;

    diceBuilder.querySelectorAll('.btn-remove-dice').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const index = parseInt(btn.dataset.index);
        preset.dice.splice(index, 1);
        if (preset.dice.length === 0) {
          preset.dice.push({ count: 1, type: '6', color: 'base' });
        }
        this.updatePresetDiceUI(card, preset);
        this.showPresetStatus('➖ Dado rimosso dal preset', 'success');
      });
    });

    diceBuilder.querySelectorAll('.dice-count-preset, .dice-type-preset, .dice-color-preset').forEach((select) => {
      select.addEventListener('change', () => this.updatePresetFromCard(preset, card));
    });
  }

  updatePresetDiceUI(card, preset) {
    const diceBuilder = card.querySelector('.dice-builder');
    if (!diceBuilder) return;
    // Aggiorna i tipi se era vuoto (lazy)
    this._refreshTypesIfEmpty();

    diceBuilder.innerHTML = preset.dice.map((d, i) => this.createDiceInputHTML(d, i)).join('');
    this.attachDiceInputListeners(card, preset);
  }

  createDiceInputHTML(dice, index) {
    // valori safe
    const safeDice = {
      count: Number.isFinite(dice?.count) ? dice.count : 1,
      type: (dice?.type ?? '6').toString(),
      color: dice?.color ?? 'base',
      launchType: dice?.launchType
    };

    // ----- TIPI (lazy: ricalcola se cache non pronta) -----
    if (!Array.isArray(this.classicVariants) || !this.classicVariants.length ||
        !Array.isArray(this.specialTypes) || !this.specialTypes.length) {
      this._refreshTypesIfEmpty();
    }
    const classicOptions = (this.classicVariants || []).map(v => {
      const selected = (safeDice.type === String(v.value)) ? 'selected' : '';
      return `<option value="${v.value}" data-launch-type="dice" ${selected}>${v.label}</option>`;
    }).join('');
    const specialOptions = (this.specialTypes || []).map(t => {
      const icon = t.icon ? `${t.icon} ` : '';
      const selected = (safeDice.type === t.id || safeDice.launchType === t.id) ? 'selected' : '';
      return `<option value="${t.id}" data-launch-type="${t.id}" ${selected}>${icon}${t.name}</option>`;
    }).join('');
    const typeOptions = `
      <optgroup label="🎲 Dadi Classici">
        ${classicOptions}
      </optgroup>
      <optgroup label="🎪 Tiri Speciali">
        ${specialOptions}
      </optgroup>
    `;

    // ----- COLORI (lazy: leggi sempre dal registry) -----
    const colors = this._getVisibleColorsLazy();
    const selectedColor = colors.some(c => c.id === safeDice.color)
      ? safeDice.color
      : (colors.find(c => c.id === 'base')?.id || colors[0].id);
    const colorOptions = colors.map(c => {
      const sel = c.id === selectedColor ? 'selected' : '';
      const icon = c.emoji ? `${c.emoji} ` : '';
      const label = c.label ?? c.id;
      return `<option value="${c.id}" ${sel}>${icon}${label}</option>`;
    }).join('');

    // ----- OUTPUT -----
    return `
      <div class="dice-input-inline">
        <select class="dice-count-preset" data-index="${index}">
          ${[...Array(12)].map((_, i) => {
            const val = i + 1;
            return `<option value="${val}" ${val === safeDice.count ? 'selected' : ''}>${val}</option>`;
          }).join('')}
        </select>
        <span>d</span>
        <select class="dice-type-preset" data-index="${index}">
          ${typeOptions}
        </select>
        <select class="dice-color-preset" data-index="${index}">
          ${colorOptions}
        </select>
        <button class="btn-remove-dice" data-index="${index}" type="button">❌</button>
      </div>
    `;
  }

  updatePresetFromCard(preset, card) {
    preset.modifier = parseInt(card.querySelector('.preset-modifier').value) || 0;

    const rulesCheckboxes = card.querySelectorAll('.rule-selector-checkbox:checked');
    preset.rules = Array.from(rulesCheckboxes).map(cb => cb.value);

    const tagsInput = card.querySelector('.preset-tags');
    if (tagsInput) {
      preset.tags = tagsInput.value.split(',').map(t => t.trim()).filter(t => t.length > 0);
      const tagsDisplay = card.querySelector('.tags-display');
      if (tagsDisplay) {
        tagsDisplay.innerHTML = preset.tags.map(tag => `<span class="tag-chip tag-chip-active">${tag}</span>`).join('');
      }
    }

    const bgColorInput = card.querySelector('.preset-bg-color');
    if (bgColorInput) {
      preset.bgColor = bgColorInput.value;
    }

    const diceBuilder = card.querySelector('.dice-builder');
    preset.dice = [];
    diceBuilder.querySelectorAll('.dice-input-inline').forEach(diceInput => {
      const count = parseInt(diceInput.querySelector('.dice-count-preset').value);
      const typeSelect = diceInput.querySelector('.dice-type-preset');
      const type = typeSelect.value;
      const launchType = typeSelect.selectedOptions[0]?.dataset.launchType;
      const color = diceInput.querySelector('.dice-color-preset').value;
      const diceData = { count, type, color };
      if (launchType) {
        diceData.launchType = launchType;
      }
      preset.dice.push(diceData);
    });
  }

  addPreset() {
    const newPreset = {
      id: '',
      name: 'Nuovo Preset',
      dice: [{ count: 1, type: '20', color: 'base' }],
      modifier: 0,
      visible: true,
      rules: [],
      tags: [],
      bgColor: '#5e81ac'
    };
    this.presets.unshift(newPreset);
    this.renderPresets();
    this.showPresetStatus('➕ Nuovo preset aggiunto. Inserisci un ID prima di salvare!', 'warning');
  }

  duplicatePreset(preset) {
    const duplicatedPreset = {
      ...preset,
      id: '',
      name: `${preset.name} (Copia)`,
      dice: (preset.dice || []).map(d => ({ ...d })),
      rules: [...(preset.rules || [])],
      tags: [...(preset.tags || [])],
      bgColor: preset.bgColor || '#5e81ac',
      visible: true
    };
    this.presets.unshift(duplicatedPreset);
    this.renderPresets();
    this.showPresetStatus('📑 Preset duplicato. Inserisci un ID prima di salvare!', 'warning');
  }

  deletePreset(presetId) {
    if (!confirm('Sei sicuro di voler eliminare questo preset?')) return;
    this.presets = this.presets.filter(p => p.id !== presetId);
    this.renderPresets();
    this.showPresetStatus('🗑️ Preset eliminato', 'success');
  }

  validatePresets() {
    const errors = [];
    const ids = new Set();
    this.presets.forEach((preset) => {
      if (!preset.id || preset.id.trim() === '') {
        errors.push(`⚠️ Preset "${preset.name || 'senza nome'}" non ha un ID`);
      } else if (ids.has(preset.id)) {
        errors.push(`⚠️ ID duplicato: "${preset.id}"`);
      } else {
        ids.add(preset.id);
      }
    });
    return errors;
  }

  createRulesSelectorHTML(preset) {
    if (!Array.isArray(this.rules) || this.rules.length === 0) {
      return '<p style="color: #888; font-style: italic;">⏳ Caricamento regole in corso...</p>';
    }

    const selectedRules = new Set((preset.rules || []).map(r => String(r).trim().toLowerCase()));
    let html = '';

    const groupedRules = {};
    this.rules.forEach(rule => {
      const group = rule.group || 'Senza Gruppo';
      if (!groupedRules[group]) {
        groupedRules[group] = [];
      }
      groupedRules[group].push(rule);
    });

    Object.keys(groupedRules).sort().forEach(group => {
      html += `<div class="rule-group-section">
        <h4 class="rule-group-title">📁 ${group}</h4>
        <div class="rule-checkboxes">`;

      groupedRules[group].forEach(rule => {
        const ruleIdLower = String(rule.id).trim().toLowerCase();
        const isChecked = selectedRules.has(ruleIdLower);
        const enabledIndicator = rule.enabled ? '✅' : '⏸️';
        const conditionPreview = rule.diceCondition ? `(${rule.diceCondition})` : '';

        html += `
          <label class="rule-checkbox-label ${isChecked ? 'selected' : ''}" title="${rule.diceCondition || 'Nessuna condizione'}">
            <input type="checkbox" class="rule-selector-checkbox" value="${rule.id}" ${isChecked ? 'checked' : ''}>
            <span class="rule-checkbox-text">
              ${enabledIndicator} <strong>${rule.name}</strong> ${conditionPreview}
              <small style="color: #888; font-size: 0.75rem; display: block; margin-top: 0.25rem;">ID: ${rule.id}</small>
            </span>
          </label>`;
      });

      html += '</div></div>';
    });

    return html;
  }

  updateRulesSelectorUI(card, preset) {
    const container = card.querySelector('.rules-selector-container');
    if (!container) return;

    const checkboxes = container.querySelectorAll('.rule-selector-checkbox');
    checkboxes.forEach(checkbox => {
      const label = checkbox.closest('.rule-checkbox-label');
      if (label) {
        if (checkbox.checked) {
          label.classList.add('selected');
        } else {
          label.classList.remove('selected');
        }
      }
    });
  }

  getAllPresetTags() {
    const tagsSet = new Set();
    this.presets.forEach(preset => {
      if (preset.tags && Array.isArray(preset.tags)) {
        preset.tags.forEach(tag => tagsSet.add(tag));
      }
    });
    return Array.from(tagsSet).sort();
  }

  async togglePresetsByTag(tag) {
    const presetsWithTag = this.presets.filter(p => Array.isArray(p.tags) && p.tags.includes(tag));
    if (presetsWithTag.length === 0) {
      this.showPresetStatus(`⚠️ Nessun preset con tag "${tag}"`, 'warning');
      return;
    }

    const allVisible = presetsWithTag.every(p => !!p.visible);
    presetsWithTag.forEach(preset => { preset.visible = !allVisible; });

    this.renderPresets();
    this.showPresetStatus(`🏷️ Tag "${tag}": ${allVisible ? 'nascosto' : 'visibile'}`, 'success');

    for (const preset of presetsWithTag) {
      await this.savePresetToFirestore(preset);
    }
  }
}

/* ===========================
   Boot
   =========================== */

document.addEventListener('DOMContentLoaded', () => {
  if (typeof firebase === 'undefined') {
    alert('❄️ Firebase non caricato. Controlla la connessione internet.');
    return;
  }
  if (!window.firestore) {
    alert('❄️ Firebase non configurato. Controlla firebase-config.js');
    return;
  }
  new AdminPanel();
});
