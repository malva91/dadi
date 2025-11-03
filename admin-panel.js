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
    // FASE 3: Test & Validazione
    this.testResults = null;
    this.testState = 'idle'; // idle | testing | success | warning | error
    this.testLogs = [];


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

  // Metodo helper per validare e sanitizzare ID
  _validateAndSanitizeId(rawId, items, currentItem, inputElement, hintElement) {
    const sanitizedId = rawId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (rawId !== sanitizedId) inputElement.value = sanitizedId;

    const currentIndex = items.findIndex(item => item === currentItem);
    if (currentIndex !== -1) items[currentIndex].id = sanitizedId;
    currentItem.id = sanitizedId;

    if (items.filter(item => item.id === sanitizedId).length > 1) {
      inputElement.style.borderColor = '#ff4444';
      inputElement.title = 'ID duplicato!';
      hintElement.textContent = '❌ ID duplicato!';
      hintElement.style.color = '#ff4444';
    } else if (!sanitizedId) {
      inputElement.style.borderColor = '#ff4444';
      inputElement.title = 'ID obbligatorio!';
      hintElement.textContent = '⚠️ L\'ID è obbligatorio per salvare. Deve essere univoco.';
      hintElement.style.color = '#ff9800';
    } else {
      inputElement.style.borderColor = '#4CAF50';
      inputElement.title = 'ID valido';
      hintElement.textContent = '✅ ID configurato correttamente';
      hintElement.style.color = '#4CAF50';
    }
  }

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
  
    // FASE 3: Elementi di test
    this.testExtractionButton = document.getElementById('testExtraction');
    this.runMultipleTestsButton = document.getElementById('runMultipleTests');
    this.testResultsContainer = document.getElementById('testResults');
    this.testLogsContainer = document.getElementById('testLogs');
    this.testStateIndicator = document.getElementById('testStateIndicator');

    // Elementi UI sistema estrazione (se presenti in pagina)
    this.extractionSystemVisibleCheckbox = document.getElementById('extractionSystemVisible');
    this.deckElements = document.getElementById('deckElements');
    this.deckPreview = document.getElementById('deckPreview');
    this.deckCount = document.getElementById('deckCount');
    this.extractionSaveStatus = document.getElementById('extractionSaveStatus');

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
      
    // FASE 3: Eventi di test
    this.testExtractionButton?.addEventListener('click', () => this.runDryRunTest());
    this.runMultipleTestsButton?.addEventListener('click', () => this.runMultipleTests());

    // Validazione live durante la digitazione
    this.deckElements?.addEventListener('input', () => {
      this.updateExtractionPreview();
      this.validateInputLive();
    });

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
      this._validateAndSanitizeId(idInput.value, this.rules, rule, idInput, idHint);
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
      this._validateAndSanitizeId(idInput.value, this.presets, preset, idInput, idHint);
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
    this._refreshTypesIfEmpty();
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

  
  // ========== VALIDAZIONI INPUT ==========

  validateInputLive() {
    if (!this.deckElements || !this.deckPreview) return;

    const text = this.deckElements.value || '';
    const elements = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    const duplicates = this.findDuplicates(elements);
    const emptyLines = this.findEmptyLines(text);
    const invalidLines = this.findInvalidLines(elements);

    this.highlightErrors(duplicates, emptyLines, invalidLines);
    this.showValidationFeedback(elements, duplicates, emptyLines, invalidLines);
  }

  findDuplicates(elements) {
    const seen = new Map();
    const duplicates = [];
    elements.forEach((element, index) => {
      const normalized = element.toLowerCase();
      if (seen.has(normalized)) {
        duplicates.push({
          line: index + 1,
          value: element,
          firstOccurrence: seen.get(normalized) + 1
        });
      } else {
        seen.set(normalized, index);
      }
    });
    return duplicates;
  }

  findEmptyLines(text) {
    const lines = text.split('\n');
    const emptyLines = [];
    lines.forEach((line, index) => {
      if (line.trim().length === 0 && line.length > 0) {
        emptyLines.push(index + 1);
      }
    });
    return emptyLines;
  }

  findInvalidLines(elements) {
    const invalidLines = [];
    const MAX_LENGTH = 200;
    elements.forEach((element, index) => {
      if (element.length > MAX_LENGTH) {
        invalidLines.push({
          line: index + 1,
          value: element,
          reason: `Troppo lungo (${element.length}/${MAX_LENGTH} caratteri)`
        });
      }
    });
    return invalidLines;
  }

  highlightErrors(duplicates, emptyLines, invalidLines) {
    if (!this.deckPreview || !this.deckElements) return;

    const text = this.deckElements.value || '';
    const elements = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (elements.length === 0) {
      this.deckPreview.innerHTML = '<span class="preview-placeholder">Inserisci elementi per vedere l\'anteprima</span>';
      return;
    }

    const errorLines = new Set();
    const warningLines = new Set();
    duplicates.forEach(d => errorLines.add(d.line - 1));
    invalidLines.forEach(i => errorLines.add(i.line - 1));
    emptyLines.forEach(l => warningLines.add(l - 1));

    this.deckPreview.innerHTML = elements
      .map((element, index) => {
        const isError = errorLines.has(index);
        const isWarning = warningLines.has(index);
        const className = isError ? 'preview-item-error' : isWarning ? 'preview-item-warning' : 'preview-item';
        const icon = isError ? '🔴' : isWarning ? '🟠' : '';
        return `<span class="${className}">${icon} ${this.escapeHtml(element)}</span>`;
      })
      .join('');
  }

  showValidationFeedback(elements, duplicates, emptyLines, invalidLines) {
    const MAX_ELEMENTS = 1000;
    const messages = [];

    if (elements.length > MAX_ELEMENTS) {
      messages.push({
        type: 'error',
        text: `🔴 ERRORE: Troppi elementi (${elements.length}/${MAX_ELEMENTS}). Rimuovi ${elements.length - MAX_ELEMENTS} elementi.`
      });
    }

    if (duplicates.length > 0) {
      const dupsText = duplicates.slice(0, 3).map(d =>
        `Riga ${d.line}: "${d.value}" (duplicato della riga ${d.firstOccurrence})`
      ).join(', ');
      const more = duplicates.length > 3 ? ` e altri ${duplicates.length - 3} duplicati` : '';
      messages.push({ type: 'error', text: `🔴 DUPLICATI: ${dupsText}${more}` });
    }

    if (invalidLines.length > 0) {
      const invText = invalidLines.slice(0, 2).map(i =>
        `Riga ${i.line}: ${i.reason}`
      ).join(', ');
      const more = invalidLines.length > 2 ? ` e altri ${invalidLines.length - 2} errori` : '';
      messages.push({ type: 'error', text: `🔴 ERRORI: ${invText}${more}` });
    }

    if (emptyLines.length > 0 && emptyLines.length < 5) {
      messages.push({ type: 'warning', text: `🟠 Righe vuote: ${emptyLines.join(', ')}` });
    }

    this.showValidationMessages(messages);
  }

  showValidationMessages(messages) {
    if (!this.extractionSaveStatus) return;
    if (messages.length === 0) {
      this.extractionSaveStatus.textContent = '';
      this.extractionSaveStatus.className = 'save-status';
      return;
    }
    const errorMessages = messages.filter(m => m.type === 'error');
    const warningMessages = messages.filter(m => m.type === 'warning');
    if (errorMessages.length > 0) {
      this.extractionSaveStatus.textContent = errorMessages[0].text;
      this.extractionSaveStatus.className = 'save-status error';
    } else if (warningMessages.length > 0) {
      this.extractionSaveStatus.textContent = warningMessages[0].text;
      this.extractionSaveStatus.className = 'save-status warning';
    }
  }

  // ========== DRY-RUN TEST ESTRAZIONE ==========

  async runDryRunTest() {
    console.log('🧪 [FASE 3] Avvio Dry-Run Test Estrazione');
    console.time('⏱️ Dry-Run Test');

    this.testState = 'testing';
    this.updateTestStateUI();

    const startTime = performance.now();
    const testLog = {
      timestamp: new Date().toISOString(),
      type: 'dry-run',
      elements: [],
      errors: [],
      warnings: [],
      success: false,
      duration: 0
    };

    try {
      const text = this.deckElements?.value || '';
      const elements = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      testLog.elements = elements;
      console.log(`📦 Elementi nel deck: ${elements.length}`);

      const validationErrors = this.validateExtractionDeck(elements);
      testLog.errors = validationErrors;

      if (validationErrors.length > 0) {
        console.error('❌ Errori di validazione:', validationErrors);
        this.testState = 'error';
        this.testResults = {
          success: false,
          message: `Test fallito: ${validationErrors.length} errori trovati`,
          errors: validationErrors,
          elementCount: elements.length,
          duration: performance.now() - startTime
        };
        this.showTestResults();
        this.logTest(testLog);
        return;
      }

      const extractionResults = this.simulateExtractions(elements, 5);
      console.log('🎲 Simulazione estrazioni:', extractionResults);

      const distributionCheck = this.checkDistribution(extractionResults, elements.length);
      if (!distributionCheck.isValid) {
        testLog.warnings.push('Distribuzione casuale non uniforme');
        console.warn('⚠️ ' + testLog.warnings[0]);
      }

      this.testState = distributionCheck.isValid ? 'success' : 'warning';
      testLog.success = true;
      testLog.duration = performance.now() - startTime;

      this.testResults = {
        success: true,
        message: `✅ Test superato! ${elements.length} elementi configurati correttamente`,
        elementCount: elements.length,
        sampleExtractions: extractionResults,
        distribution: distributionCheck,
        duration: testLog.duration,
        warnings: testLog.warnings
      };

      console.log('✅ Test completato con successo');
      console.log('📊 Risultati:', this.testResults);
    } catch (error) {
      console.error('❌ Errore durante il test:', error);
      this.testState = 'error';
      testLog.errors.push(`Errore interno: ${error.message}`);
      testLog.duration = performance.now() - startTime;

      this.testResults = {
        success: false,
        message: `Test fallito: ${error.message}`,
        errors: [error.message],
        duration: testLog.duration
      };
    } finally {
      console.timeEnd('⏱️ Dry-Run Test');
      this.logTest(testLog);
      this.updateTestStateUI();
      this.showTestResults();
    }
  }

  simulateExtractions(elements, count = 5) {
    const results = [];
    for (let i = 0; i < Math.min(count, elements.length); i++) {
      const randomIndex = Math.floor(Math.random() * elements.length);
      results.push({ index: randomIndex + 1, value: elements[randomIndex] });
    }
    return results;
  }

  checkDistribution(extractions, totalElements) {
    const uniqueIndices = new Set(extractions.map(e => e.index));
    const uniqueRatio = uniqueIndices.size / (extractions.length || 1);
    return {
      isValid: uniqueRatio > 0.6,
      uniqueRatio,
      message: uniqueRatio > 0.6 ? 'Distribuzione casuale accettabile' : 'Troppe ripetizioni nella simulazione'
    };
  }

  // ========== FASE 3 - Step 2: Testing Avanzato & Log Diagnostici ==========

  async runMultipleTests() {
    console.log('🧪 [FASE 3] Avvio Test Multipli');
    console.time('⏱️ Test Multipli');

    this.testState = 'testing';
    this.updateTestStateUI();

    const NUM_TESTS = 10;
    const startTime = performance.now();
    const testLog = {
      timestamp: new Date().toISOString(),
      type: 'multiple-runs',
      numTests: NUM_TESTS,
      results: [],
      aggregated: {},
      duration: 0,
      success: false
    };

    try {
      const text = this.deckElements?.value || '';
      const elements = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      if (elements.length === 0) {
        throw new Error('Mazzo vuoto');
      }

      console.log(`🔄 Esecuzione di ${NUM_TESTS} test...`);

      const allExtractions = [];
      for (let i = 0; i < NUM_TESTS; i++) {
        const runStart = performance.now();
        const extractions = this.simulateExtractions(elements, Math.min(5, elements.length));
        const runDuration = performance.now() - runStart;

        testLog.results.push({ run: i + 1, extractions, duration: runDuration });
        allExtractions.push(...extractions);
        console.log(`  ✓ Test ${i + 1}/${NUM_TESTS} completato in ${runDuration.toFixed(2)}ms`);
      }

      const analysis = this.analyzeMultipleExtractions(allExtractions, elements);
      testLog.aggregated = analysis;
      testLog.duration = performance.now() - startTime;
      testLog.success = true;

      console.log('📊 Analisi aggregata:', analysis);

      this.testState = analysis.qualityScore > 0.7 ? 'success' : 'warning';
      this.testResults = {
        success: true,
        message: `✅ ${NUM_TESTS} test completati`,
        elementCount: elements.length,
        numTests: NUM_TESTS,
        analysis,
        duration: testLog.duration
      };

      console.log('✅ Test multipli completati');
    } catch (error) {
      console.error('❌ Errore durante i test multipli:', error);
      this.testState = 'error';
      testLog.duration = performance.now() - startTime;

      this.testResults = {
        success: false,
        message: `Test falliti: ${error.message}`,
        errors: [error.message],
        duration: testLog.duration
      };
    } finally {
      console.timeEnd('⏱️ Test Multipli');
      this.logTest(testLog);
      this.updateTestStateUI();
      this.showTestResults();
    }
  }

  analyzeMultipleExtractions(allExtractions, elements) {
    const frequencies = new Map();
    allExtractions.forEach(e => {
      const count = frequencies.get(e.value) || 0;
      frequencies.set(e.value, count + 1);
    });

    const avgFreq = allExtractions.length / (frequencies.size || 1);
    const maxFreq = Math.max(...frequencies.values());
    const minFreq = Math.min(...frequencies.values());

    const uniqueRatio = frequencies.size / Math.min(elements.length, allExtractions.length || 1);
    const distributionScore = 1 - ((maxFreq - avgFreq) / (avgFreq || 1));
    const qualityScore = (uniqueRatio + distributionScore) / 2;

    return {
      totalExtractions: allExtractions.length,
      uniqueElements: frequencies.size,
      uniqueRatio,
      avgFrequency: Number.isFinite(avgFreq) ? avgFreq.toFixed(2) : '0.00',
      maxFrequency: Number.isFinite(maxFreq) ? maxFreq : 0,
      minFrequency: Number.isFinite(minFreq) ? minFreq : 0,
      distributionScore: Number.isFinite(distributionScore) ? distributionScore.toFixed(2) : '0.00',
      qualityScore: Number.isFinite(qualityScore) ? qualityScore.toFixed(2) : '0.00',
      message: qualityScore > 0.8 ? 'Eccellente' : qualityScore > 0.6 ? 'Buona' : 'Da migliorare',
      topElements: Array.from(frequencies.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value, count }))
    };
  }

  // ========== LOG DIAGNOSTICI ==========

  logTest(testLog) {
    this.testLogs.unshift(testLog);
    if (this.testLogs.length > 50) {
      this.testLogs = this.testLogs.slice(0, 50);
    }
    console.group(`📋 Log Test ${testLog.type}`);
    console.log('🕐 Timestamp:', testLog.timestamp);
    console.log('⏱️ Durata:', `${(testLog.duration ?? 0).toFixed(2)}ms`);
    if (testLog.elements) console.log('📦 Elementi:', testLog.elements.length);
    if (testLog.errors && testLog.errors.length > 0) console.error('❌ Errori:', testLog.errors);
    if (testLog.warnings && testLog.warnings.length > 0) console.warn('⚠️ Warning:', testLog.warnings);
    if (testLog.aggregated) console.log('📊 Analisi:', testLog.aggregated);
    console.groupEnd();
    this.updateTestLogsUI();
  }

  updateTestLogsUI() {
    if (!this.testLogsContainer) return;
    const recentLogs = this.testLogs.slice(0, 10);
    if (recentLogs.length === 0) {
      this.testLogsContainer.innerHTML = '<p class="no-logs">Nessun log di test disponibile</p>';
      return;
    }
    this.testLogsContainer.innerHTML = recentLogs.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString('it-IT');
      const typeIcon = log.type === 'dry-run' ? '🧪' : '🔄';
      const statusIcon = log.success ? '✅' : '❌';
      const duration = log.duration ? `${log.duration.toFixed(0)}ms` : 'N/A';
      return `
        <div class="test-log-entry">
          <span class="log-time">${time}</span>
          <span class="log-type">${typeIcon} ${log.type}</span>
          <span class="log-status">${statusIcon}</span>
          <span class="log-duration">⏱️ ${duration}</span>
        </div>
      `;
    }).join('');
  }

  // ========== UI FEEDBACK ==========

  updateTestStateUI() {
    if (!this.testStateIndicator) return;
    const states = {
      idle: { icon: '⚪', text: 'Nessun test eseguito', className: 'test-state-idle' },
      testing: { icon: '🔄', text: 'Test in corso...', className: 'test-state-testing' },
      success: { icon: '🟢', text: 'Test superato', className: 'test-state-success' },
      warning: { icon: '🟠', text: 'Test con warning', className: 'test-state-warning' },
      error: { icon: '🔴', text: 'Test fallito', className: 'test-state-error' }
    };
    const state = states[this.testState] || states.idle;
    this.testStateIndicator.innerHTML = `
      <span class="${state.className}">
        ${state.icon} ${state.text}
      </span>
    `;
  }

  showTestResults() {
    if (!this.testResultsContainer || !this.testResults) return;

    const { success, message, elementCount, errors, warnings, sampleExtractions, distribution, analysis, duration, numTests } = this.testResults;

    let html = `
      <div class="test-results-card ${success ? 'success' : 'error'}">
        <h4>${message}</h4>
        <div class="test-stats">
    `;

    if (elementCount !== undefined) {
      html += `<p>📦 <strong>Elementi nel mazzo:</strong> ${elementCount}</p>`;
    }
    if (duration !== undefined) {
      html += `<p>⏱️ <strong>Durata:</strong> ${Number(duration).toFixed(2)}ms</p>`;
    }
    if (errors && errors.length > 0) {
      html += `
        <div class="test-errors">
          <h5>❌ Errori (${errors.length})</h5>
          <ul>
            ${errors.slice(0, 5).map(e => `<li>${e}</li>`).join('')}
            ${errors.length > 5 ? `<li><em>... e altri ${errors.length - 5} errori</em></li>` : ''}
          </ul>
        </div>
      `;
    }
    if (warnings && warnings.length > 0) {
      html += `
        <div class="test-warnings">
          <h5>⚠️ Warning</h5>
          <ul>
            ${warnings.map(w => `<li>${w}</li>`).join('')}
          </ul>
        </div>
      `;
    }
    if (sampleExtractions && sampleExtractions.length > 0) {
      html += `
        <div class="test-extractions">
          <h5>🎲 Estrazioni di prova</h5>
          <div class="extraction-samples">
            ${sampleExtractions.map(e => `<span class="extraction-badge">#${e.index}: ${this.escapeHtml(e.value)}</span>`).join('')}
          </div>
        </div>
      `;
    }
    if (distribution) {
      html += `
        <div class="test-distribution">
          <h5>📊 Distribuzione</h5>
          <p><strong>Valori unici:</strong> ${(Number(distribution.uniqueRatio) * 100).toFixed(0)}%</p>
          <p><strong>Qualità:</strong> ${distribution.message}</p>
        </div>
      `;
    }
    if (analysis && numTests) {
      html += `
        <div class="test-analysis">
          <h5>📈 Analisi su ${numTests} test</h5>
          <p><strong>Elementi unici estratti:</strong> ${analysis.uniqueElements}</p>
          <p><strong>Frequenza media:</strong> ${analysis.avgFrequency}</p>
          <p><strong>Score qualità:</strong> ${(Number(analysis.qualityScore) * 100).toFixed(0)}% (${analysis.message})</p>
          ${analysis.topElements && analysis.topElements.length > 0 ? `
            <div class="top-elements">
              <h6>Top 5 elementi estratti:</h6>
              ${analysis.topElements.map(e => `
                <div class="top-element">
                  <span>${this.escapeHtml(e.value)}</span>
                  <span class="count-badge">×${e.count}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }

    html += `
        </div>
      </div>
    `;

    this.testResultsContainer.innerHTML = html;
    this.testResultsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ========== OVERRIDE METODO ESISTENTE ==========
  testExtraction() { this.runDryRunTest(); }


  /* ---------- Extraction System ---------- */

  async loadExtractionConfiguration() {
    try {
      const configDoc = await this.firestore.collection('effectsConfig').doc('config').get();
      const configData = configDoc.exists ? configDoc.data() : {};

      this.extractionSystemVisible = configData.extractionSystemVisible || false;
      this.extractionDeck = configData.extractionDeck || ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

      this.updateExtractionUI();
      this.updateExtractionPreview();
    } catch (error) {
      console.error('Errore nel caricamento configurazione sistema estrazione:', error);
      this.showExtractionStatus('Errore nel caricamento della configurazione', 'error');
      this.extractionSystemVisible = false;
      this.extractionDeck = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
      this.updateExtractionUI();
      this.updateExtractionPreview();
    }
  }

  updateExtractionUI() {
    if (this.extractionSystemVisibleCheckbox) {
      this.extractionSystemVisibleCheckbox.checked = this.extractionSystemVisible;
    }

    if (this.deckElements && Array.isArray(this.extractionDeck)) {
      this.deckElements.value = this.extractionDeck.join('\n');
    }
  }

  updateExtractionPreview() {
    if (!this.deckElements || !this.deckPreview || !this.deckCount) return;

    const text = this.deckElements.value || '';
    const elements = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (elements.length === 0) {
      this.deckPreview.innerHTML = '<span class="preview-placeholder">Inserisci elementi per vedere l\'anteprima</span>';
      this.deckCount.textContent = '0';
      return;
    }

    this.deckCount.textContent = elements.length;

    this.deckPreview.innerHTML = elements
      .map(element => `<span class="preview-item">${this.escapeHtml(element)}</span>`)
      .join('');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  validateExtractionDeck(elements) {
    const errors = [];

    if (!Array.isArray(elements) || elements.length === 0) {
      errors.push('Il mazzo deve contenere almeno un elemento');
      return errors;
    }

    if (elements.length > 1000) {
      errors.push('Il mazzo non può contenere più di 1000 elementi');
      return errors;
    }

    const seen = new Set();
    elements.forEach((element, index) => {
      if (!element || typeof element !== 'string' || element.trim().length === 0) {
        errors.push(`Riga ${index + 1}: Elemento vuoto`);
      } else if (element.length > 200) {
        errors.push(`Riga ${index + 1}: Elemento troppo lungo (max 200 caratteri)`);
      } else if (seen.has(element.toLowerCase())) {
        errors.push(`Riga ${index + 1}: Elemento duplicato`);
      } else {
        seen.add(element.toLowerCase());
      }
    });

    return errors;
  }

  async saveExtractionConfiguration() {
    try {
      const text = this.deckElements?.value || '';
      const elements = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      const validationErrors = this.validateExtractionDeck(elements);
      if (validationErrors.length > 0) {
        const message = validationErrors.slice(0, 3).join('\n') +
                       (validationErrors.length > 3 ? `\n... e altri ${validationErrors.length - 3} errori` : '');
        this.showExtractionStatus(`Errori di validazione:\n${message}`, 'error');
        return;
      }

      const configRef = this.firestore.collection('effectsConfig').doc('config');
      const currentConfig = (await configRef.get()).data() || {};

      await configRef.set({
        ...currentConfig,
        extractionSystemVisible: this.extractionSystemVisible,
        extractionDeck: elements
      });

      this.extractionDeck = elements;
      this.showExtractionStatus(`✅ Configurazione salvata (${elements.length} elementi)`, 'success');

      if (window.extractionSystem) {
        try {
          await window.extractionSystem.setDefaultDeck(elements);
        } catch (error) {
          console.warn('Errore sincronizzazione extraction-system:', error);
        }
      }
    } catch (error) {
      console.error('Errore nel salvataggio configurazione estrazione:', error);
      this.showExtractionStatus('Errore nel salvataggio della configurazione', 'error');
    }
  }

  testExtraction() {
    if (!this.extractionDeck || this.extractionDeck.length === 0) {
      this.showExtractionStatus('Mazzo vuoto. Aggiungi elementi prima di testare', 'warning');
      return;
    }

    const randomIndex = Math.floor(Math.random() * this.extractionDeck.length);
    const extracted = this.extractionDeck[randomIndex];

    const message = `Estratto: "${extracted}" (${randomIndex + 1}/${this.extractionDeck.length})`;
    this.showExtractionStatus(message, 'success');
  }

  showExtractionStatus(message, type) {
    if (!this.extractionSaveStatus) return;
    this.extractionSaveStatus.textContent = message;
    this.extractionSaveStatus.className = `save-status ${type}`;
    setTimeout(() => {
      this.extractionSaveStatus.className = 'save-status';
      this.extractionSaveStatus.textContent = '';
    }, 5000);
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
