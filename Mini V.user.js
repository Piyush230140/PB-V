// ==UserScript==
// @name         Pixel Buddy
// @namespace    http://tampermonkey.net/
// @version      3.12.1
// @description  Desktop companion -- real GIF animations, speech bubbles, smart reminders
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';
  if (window !== window.top) return;
  if (document.getElementById('pb-pet')) return;

  // DEFAULT MESSAGE POOLS (fallback when user has no custom messages saved)
  const DEFAULT_GREETING_POOL = [
    "You're beautiful! 💙",
    "Have a wonderful day! ☀️",
    "You've got this! 💪",
    "Hello there! 👋",
    "Great to see you! 😊",
    "Hope you're having a good day!",
    "You're doing amazing! ✨",
    "Keep up the great work! 🌟",
    "Smile! You deserve it! 😄",
    "Today is your day! 🎉"
  ];
  const DEFAULT_DRINK_POOL = [
    "Drink some water! 💧",
    "Stay hydrated! 💦",
    "Time for a water break! 🥤",
    "Don't forget to drink water!",
    "Your body needs water! 💧",
    "Hydration is key! 🌊",
    "Take a sip! 💦"
  ];
  const DEFAULT_SLEEP_POOL = [
    "Time to rest your eyes! 😴",
    "Take a break! 🌙",
    "Maybe it's time to sleep? 💤",
    "Rest is important too! 🌛",
    "Your eyes need rest! 👀"
  ];

  // DEFAULT SETTINGS
  const DEFAULT_SETTINGS = {
    general:    { enabled: true, name: 'Pixel Buddy', showOnAllSites: true, shortcut: 'Alt+V' },
    timings:    { greetingInterval: 30, drinkInterval: 60, animationDuration: 9.5, bubbleDuration: 7 },
    messages:   {
      greetingEnabled: true, drinkEnabled: true, sleepEnabled: true,
      greetingPool: DEFAULT_GREETING_POOL.slice(),
      drinkPool:    DEFAULT_DRINK_POOL.slice(),
      sleepPool:    DEFAULT_SLEEP_POOL.slice()
    },
    animations: { wave: true, headtilt: true, happybounce: true, drinkwater: true },
    behaviour:  { soundEnabled: false, showOnStartup: true }
  };
  // STORAGE MANAGER
  class StorageManager {
    static KEY = 'pb_settings_v4';
    static load() {
      try {
        const raw = GM_getValue(StorageManager.KEY, null);
        if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        const saved = JSON.parse(raw);
        const out   = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        for (const k of Object.keys(DEFAULT_SETTINGS))
          if (saved[k] && typeof saved[k] === 'object') Object.assign(out[k], saved[k]);
        const anyAnim = Object.keys(DEFAULT_SETTINGS.animations).some(k => out.animations[k]);
        if (!anyAnim) {
          console.warn('[PixelBuddy] all animations disabled — resetting to defaults');
          Object.assign(out.animations, DEFAULT_SETTINGS.animations);
        }
        // Ensure pools are arrays (old saves had only booleans in messages)
        if (!Array.isArray(out.messages.greetingPool)) out.messages.greetingPool = DEFAULT_GREETING_POOL.slice();
        if (!Array.isArray(out.messages.drinkPool))    out.messages.drinkPool    = DEFAULT_DRINK_POOL.slice();
        if (!Array.isArray(out.messages.sleepPool))    out.messages.sleepPool    = DEFAULT_SLEEP_POOL.slice();
        console.log('[PixelBuddy] settings loaded');
        return out;
      } catch(e) { return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
    }
    static save(s) { GM_setValue(StorageManager.KEY, JSON.stringify(s)); }
  }

  // MESSAGE MANAGER
  // Reads from live settings.messages.*Pool so custom messages work without restart.
  class MessageManager {
    constructor(settings) {
      this._s       = settings;
      this._recent  = {};
      this._maxRecent = 3;
    }
    _pick(cat) {
      const pool = (this._s.messages[cat + 'Pool'] || []).filter(m => m && m.trim());
      const src0 = pool.length ? pool :
                   (cat === 'drink' ? DEFAULT_DRINK_POOL :
                    cat === 'sleep' ? DEFAULT_SLEEP_POOL : DEFAULT_GREETING_POOL);
      if (!this._recent[cat]) this._recent[cat] = [];
      const avail = src0.filter(m => !this._recent[cat].includes(m));
      const src   = avail.length ? avail : src0;
      const msg   = src[Math.floor(Math.random() * src.length)];
      this._recent[cat].push(msg);
      if (this._recent[cat].length > this._maxRecent) this._recent[cat].shift();
      return msg;
    }
    getGreetingMessage() { return this._pick('greeting'); }
    getDrinkMessage()    { return this._pick('drink'); }
    getSleepMessage()    { return this._pick('sleep'); }
  }

  // WATER TRACKER
  // Daily drink count; resets automatically at midnight.
  class WaterTracker {
    static KEY = 'pb_water_v1';
    static _today() { return new Date().toISOString().slice(0, 10); }
    static getCount() {
      try {
        const raw = GM_getValue(WaterTracker.KEY, null);
        if (!raw) return 0;
        const d = JSON.parse(raw);
        return d.date === WaterTracker._today() ? (d.count || 0) : 0;
      } catch(e) { return 0; }
    }
    static increment() {
      const count = WaterTracker.getCount() + 1;
      GM_setValue(WaterTracker.KEY, JSON.stringify({ date: WaterTracker._today(), count }));
      return count;
    }
  }

  // ANIMATION MANAGER
  class AnimationManager {
    static REGISTRY = {
      wave:        { label: 'Greeting Wave',  category: 'greeting' },
      headtilt:    { label: 'Head Tilt',      category: 'greeting' },
      happybounce: { label: 'Happy Bounce',   category: 'greeting' },
      drinkwater:  { label: 'Drink Water',    category: 'drink'    },
    };
    static DIRECT_URLS = {
      wave:        'https://raw.githubusercontent.com/Piyush230140/PB-V/main/pb-wave.webp',
      headtilt:    'https://raw.githubusercontent.com/Piyush230140/PB-V/main/pb-headtilt.webp',
      happybounce: 'https://raw.githubusercontent.com/Piyush230140/PB-V/main/pb-happybounce.webp',
      drinkwater:  'https://raw.githubusercontent.com/Piyush230140/PB-V/main/pb-drinkwater.webp',
    };
    constructor(settings, onReady) {
      this._s       = settings;
      this._urls    = {};
      this._timer   = null;
      this._current = null;
      const keys  = Object.keys(AnimationManager.REGISTRY);
      let loaded  = 0;
      const total = keys.length;
      for (const key of keys) {
        this._urls[key] = null;
        GM_xmlhttpRequest({
          method: 'GET',
          url: AnimationManager.DIRECT_URLS[key],
          responseType: 'blob',
          onload: (r) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              this._urls[key] = reader.result;
              console.log('[PixelBuddy] ready:', key);
              if (++loaded === total && onReady) onReady();
            };
            reader.readAsDataURL(r.response);
          },
          onerror: () => {
            console.warn('[PixelBuddy] failed:', key);
            if (++loaded === total && onReady) onReady();
          },
        });
      }
    }
    getByCategory(cat) {
      return Object.entries(AnimationManager.REGISTRY)
        .filter(([k, v]) => v.category === cat && this._s.animations[k])
        .map(([k]) => k);
    }
    pickRandom(keys) { return keys[Math.floor(Math.random() * keys.length)]; }
    play(key, imgEl, onDone, duration) {
      this.stop();
      const url = this._urls[key];
      const ms  = (duration || 9.5) * 1000;
      if (!url) { this._timer = setTimeout(() => { if (onDone) onDone(); }, ms); return; }
      this._current = key;
      // Hide the img briefly while swapping src — prevents broken-image white-dot flash
      imgEl.style.visibility = 'hidden';
      imgEl.removeAttribute('src');
      setTimeout(() => {
        imgEl.src = url;
        imgEl.style.visibility = '';
        this._timer = setTimeout(() => { this._current = null; if (onDone) onDone(); }, ms);
      }, 50);
    }
    stop() {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      this._current = null;
    }
  }

  // SPEECH BUBBLE MANAGER
  class SpeechBubbleManager {
    constructor(el) { this._el = el; this._timer = null; }
    // Plain text bubble (greetings)
    show(text, duration) {
      clearTimeout(this._timer);
      this._el.classList.remove('pb-bubble--interactive');
      this._el.textContent = text;
      this._el.classList.add('pb-bubble--visible');
      if (duration > 0) this._timer = setTimeout(() => this.hide(), duration * 1000);
    }
    // Rich HTML bubble with action buttons (drink reminders)
    showWithActions(html, duration) {
      clearTimeout(this._timer);
      this._el.innerHTML = html;
      this._el.classList.add('pb-bubble--visible', 'pb-bubble--interactive');
      if (duration > 0) this._timer = setTimeout(() => this.hide(), duration * 1000);
    }
    hide() {
      clearTimeout(this._timer);
      this._el.classList.remove('pb-bubble--visible', 'pb-bubble--interactive');
      setTimeout(() => { this._el.innerHTML = ''; }, 350);
    }
  }

  // REMINDER MANAGER
  class ReminderManager {
    constructor(settings, onGreet, onDrink) {
      this._s = settings; this._onGreet = onGreet; this._onDrink = onDrink;
      this._gt = null; this._dt = null; this._running = false;
    }
    start() { if (this._running) return; this._running = true; this._sg(); this._sd(); }
    stop()  { this._running = false; clearTimeout(this._gt); clearTimeout(this._dt); }
    _sg() {
      if (!this._running) return;
      this._gt = setTimeout(() => { if (this._s.messages.greetingEnabled) this._onGreet(); this._sg(); },
        this._s.timings.greetingInterval * 60000);
    }
    _sd() {
      if (!this._running) return;
      this._dt = setTimeout(() => { if (this._s.messages.drinkEnabled) this._onDrink(); this._sd(); },
        this._s.timings.drinkInterval * 60000);
    }
  }

  // SETTINGS PANEL
  class SettingsPanel {
    constructor(settings, onSave, onClose, onTestDrink) {
      this._s = settings; this._onSave = onSave; this._onClose = onClose; this._onTestDrink = onTestDrink;
      this._el = null; this._build();
    }
    _build() {
      this._el = document.createElement('div');
      this._el.id = 'pb-settings';
      document.body.appendChild(this._el);
    }
    _html() {
      const s = this._s;
      const c = (v) => v ? 'checked' : '';
      const esc = (arr) => (arr || []).join('\n').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return `<div class='pb-si'>
        <div class='pb-sh'>
          <span class='pb-st'>⚙️ Pixel Buddy Settings</span>
          <button class='pb-sc' id='pb-close-btn'>✕</button>
        </div>
        <div class='pb-tabs'>
          <button class='pb-tab active' data-tab='general'>General</button>
          <button class='pb-tab' data-tab='timings'>Timings</button>
          <button class='pb-tab' data-tab='messages'>Messages</button>
          <button class='pb-tab' data-tab='animations'>Animations</button>
          <button class='pb-tab' data-tab='behaviour'>Behaviour</button>
          <button class='pb-tab' data-tab='shortcuts'>Shortcuts</button>
        </div>
        <div class='pb-tc'>
          <div class='pb-panel active' id='tab-general'>
            <label class='pb-row'><span>Enabled</span>
              <input type='checkbox' id='s-enabled' ${c(s.general.enabled)}></label>
            <label class='pb-row'><span>Name</span>
              <input type='text' id='s-name' value="${s.general.name}"></label>
            <label class='pb-row'><span>Show on all sites</span>
              <input type='checkbox' id='s-allsites' ${c(s.general.showOnAllSites)}></label>
          </div>
          <div class='pb-panel' id='tab-timings'>
            <label class='pb-row'><span>Greeting every (min)</span>
              <input type='number' id='s-greet-int' value="${s.timings.greetingInterval}" min='1' max='120'></label>
            <label class='pb-row'><span>Drink reminder every (min)</span>
              <input type='number' id='s-drink-int' value="${s.timings.drinkInterval}" min='1' max='240'></label>
            <label class='pb-row'><span>Animation duration (sec)</span>
              <input type='number' id='s-anim-dur' value="${s.timings.animationDuration}" min='1' max='60' step='0.5'></label>
            <label class='pb-row'><span>Bubble duration (sec)</span>
              <input type='number' id='s-bubble-dur' value="${s.timings.bubbleDuration}" min='1' max='30'></label>
          </div>
          <div class='pb-panel' id='tab-messages'>
            <label class='pb-row'><span>Greeting messages</span>
              <input type='checkbox' id='s-greet-on' ${c(s.messages.greetingEnabled)}></label>
            <label class='pb-row'><span>Drink reminders</span>
              <input type='checkbox' id='s-drink-on' ${c(s.messages.drinkEnabled)}></label>
            <label class='pb-row'><span>Sleep reminders</span>
              <input type='checkbox' id='s-sleep-on' ${c(s.messages.sleepEnabled)}></label>
            <div class='pb-msg-section'>
              <div class='pb-msg-label'>Greeting messages <span class='pb-msg-hint'>(one per line)</span></div>
              <textarea id='s-greet-pool' class='pb-textarea'>${esc(s.messages.greetingPool)}</textarea>
            </div>
            <div class='pb-msg-section'>
              <div class='pb-msg-label'>Drink messages <span class='pb-msg-hint'>(one per line)</span></div>
              <textarea id='s-drink-pool' class='pb-textarea'>${esc(s.messages.drinkPool)}</textarea>
            </div>
            <div class='pb-msg-section'>
              <div class='pb-msg-label'>Sleep messages <span class='pb-msg-hint'>(one per line)</span></div>
              <textarea id='s-sleep-pool' class='pb-textarea'>${esc(s.messages.sleepPool)}</textarea>
            </div>
          </div>
          <div class='pb-panel' id='tab-animations'>
            <label class='pb-row'><span>Greeting Wave</span>
              <input type='checkbox' id='s-anim-wave' ${c(s.animations.wave)}></label>
            <label class='pb-row'><span>Head Tilt</span>
              <input type='checkbox' id='s-anim-headtilt' ${c(s.animations.headtilt)}></label>
            <label class='pb-row'><span>Happy Bounce</span>
              <input type='checkbox' id='s-anim-happybounce' ${c(s.animations.happybounce)}></label>
            <label class='pb-row'><span>Drink Water</span>
              <input type='checkbox' id='s-anim-drinkwater' ${c(s.animations.drinkwater)}></label>
          </div>
          <div class='pb-panel' id='tab-behaviour'>
            <label class='pb-row'><span>Show on startup</span>
              <input type='checkbox' id='s-startup' ${c(s.behaviour.showOnStartup)}></label>
            <label class='pb-row'><span>Sound effects</span>
              <input type='checkbox' id='s-sound' ${c(s.behaviour.soundEnabled)}></label>
            <div class='pb-row'><span>Test drink reminder</span>
              <button class='pb-btn-test' id='s-test-drink'>Trigger now</button></div>
          </div>
          <div class='pb-panel' id='tab-shortcuts'>
            <p class='pb-hint'>Click the field below, then press your key combo to change the summon shortcut.</p>
            <div class='pb-row'><span>Summon shortcut</span>
              <input type='text' id='s-shortcut' value="${s.general.shortcut || 'Alt+V'}" readonly></div>
            <p class='pb-hint'>Alt + any key recommended. Press Escape to cancel capture.</p>
          </div>
        </div>
        <div class='pb-sf'>
          <button class='pb-btn pb-btn-save' id='pb-save-btn'>Save</button>
          <button class='pb-btn pb-btn-reset' id='pb-reset-btn'>Reset</button>
        </div>
      </div>`;
    }
    _wire() {
      this._el.querySelectorAll('.pb-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          this._el.querySelectorAll('.pb-tab').forEach(b => b.classList.remove('active'));
          this._el.querySelectorAll('.pb-panel').forEach(p => p.classList.remove('active'));
          btn.classList.add('active');
          this._el.querySelector('#tab-' + btn.dataset.tab).classList.add('active');
        });
      });
      this._el.querySelector('#pb-close-btn').addEventListener('click', () => this.close());
      this._el.querySelector('#pb-save-btn').addEventListener('click', () => this._save());
      this._el.querySelector('#pb-reset-btn').addEventListener('click', () => this._reset());
      const sc = this._el.querySelector('#s-shortcut');
      if (sc) {
        sc.addEventListener('focus', () => { sc.value = 'Press keys...'; sc.style.color = '#8b6cf7'; });
        sc.addEventListener('blur',  () => { sc.style.color = ''; sc.value = this._s.general.shortcut || 'Alt+V'; });
        sc.addEventListener('keydown', (e) => {
          e.preventDefault();
          if (e.key === 'Escape') { sc.blur(); return; }
          const p = [];
          if (e.ctrlKey)  p.push('Ctrl');
          if (e.altKey)   p.push('Alt');
          if (e.shiftKey) p.push('Shift');
          if (!['Control','Alt','Shift'].includes(e.key)) p.push(e.key);
          if (p.length > 1 || (p.length === 1 && !['Ctrl','Alt','Shift'].includes(p[0]))) {
            sc.value = p.join('+');
            sc.style.color = '';
            sc.blur();
          }
        });
      }
      const td = this._el.querySelector('#s-test-drink');
      if (td) td.addEventListener('click', () => {
        this.close();
        setTimeout(() => { if (this._onTestDrink) this._onTestDrink(); }, 350);
      });
    }

    _save() {
      const s = this._s;
      s.general.enabled           = document.getElementById('s-enabled').checked;
      s.general.name              = document.getElementById('s-name').value.trim() || 'Pixel Buddy';
      s.general.showOnAllSites    = document.getElementById('s-allsites').checked;
      s.timings.greetingInterval  = +document.getElementById('s-greet-int').value  || 30;
      s.timings.drinkInterval     = +document.getElementById('s-drink-int').value  || 60;
      s.timings.animationDuration = +document.getElementById('s-anim-dur').value   || 9.5;
      s.timings.bubbleDuration    = +document.getElementById('s-bubble-dur').value || 7;
      s.messages.greetingEnabled  = document.getElementById('s-greet-on').checked;
      s.messages.drinkEnabled     = document.getElementById('s-drink-on').checked;
      s.messages.sleepEnabled     = document.getElementById('s-sleep-on').checked;
      const parsePool = (id) =>
        (document.getElementById(id).value || '').split('\n').map(l => l.trim()).filter(Boolean);
      const gp = parsePool('s-greet-pool');
      const dp = parsePool('s-drink-pool');
      const sp = parsePool('s-sleep-pool');
      s.messages.greetingPool = gp.length ? gp : DEFAULT_GREETING_POOL.slice();
      s.messages.drinkPool    = dp.length ? dp : DEFAULT_DRINK_POOL.slice();
      s.messages.sleepPool    = sp.length ? sp : DEFAULT_SLEEP_POOL.slice();
      s.animations.wave           = document.getElementById('s-anim-wave').checked;
      s.animations.headtilt       = document.getElementById('s-anim-headtilt').checked;
      s.animations.happybounce    = document.getElementById('s-anim-happybounce').checked;
      s.animations.drinkwater     = document.getElementById('s-anim-drinkwater').checked;
      s.behaviour.showOnStartup   = document.getElementById('s-startup').checked;
      s.behaviour.soundEnabled    = document.getElementById('s-sound').checked;
      const scEl = document.getElementById('s-shortcut');
      if (scEl && scEl.value && scEl.value !== 'Press keys...')
        s.general.shortcut = scEl.value;
      this._onSave(s);
    }

    _reset() {
      if (!confirm('Reset all settings to defaults?')) return;
      this._onSave(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
    }

    open() {
      this._el.innerHTML = this._html();
      this._wire();
      this._el.classList.add('pb-settings--open');
    }
    close() { this._el.classList.remove('pb-settings--open'); this._onClose(); }
  }

  // PIXEL BUDDY
  class PixelBuddy {
    constructor() {
      this._s         = StorageManager.load();
      this._msgs      = new MessageManager(this._s);
      this._anim      = null;
      this._bubble    = null;
      this._reminders = null;
      this._panel     = null;
      this._busy      = false;
      this._panelOpen = false;
    }

    init() {
      console.log('[PixelBuddy] v3.12.1 starting, enabled:', this._s.general.enabled);
      if (!this._s.general.enabled) return;
      this._buildDOM();
      this._injectStyles();
      this._bubble    = new SpeechBubbleManager(document.getElementById('pb-bubble'));
      this._reminders = new ReminderManager(this._s,
        () => this._doGreeting(), () => this._doDrink(true));
      document.addEventListener('keydown', (e) => this._onKey(e), true);
      document.getElementById('pb-gif-wrap').addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        this._openSettings();
      });
      this._anim = new AnimationManager(this._s, () => {
        console.log('[PixelBuddy] all animations ready');
        if (this._s.behaviour.showOnStartup) this._doGreeting();
        this._reminders.start();
      });
    }

    _doGreeting() {
      console.log('[PixelBuddy] _doGreeting called, busy=' + this._busy);
      if (this._busy) return;
      if (!this._anim) { console.warn('[PixelBuddy] _anim not ready yet'); return; }
      let keys = this._anim.getByCategory('greeting');
      let msg  = this._msgs.getGreetingMessage();
      if (!keys.length) {
        const allKeys = Object.keys(AnimationManager.REGISTRY)
          .filter(k => this._s.animations[k] && this._anim._urls[k]);
        if (!allKeys.length) return;
        keys = allKeys;
        if (this._anim.getByCategory('drink').some(k => keys.includes(k)))
          msg = this._msgs.getDrinkMessage();
      }
      this._play(this._anim.pickRandom(keys), msg);
    }

    _doDrink(force) {
      console.log('[PixelBuddy] _doDrink called, busy=' + this._busy + ' force=' + !!force);
      if (force && this._busy) this._dismissNow();
      if (this._busy) return;
      if (!this._anim) return;
      const keys = this._anim.getByCategory('drink');
      if (!keys.length) { console.warn('[PixelBuddy] drinkwater disabled'); return; }

      const todayCount = WaterTracker.getCount();
      const msg        = this._msgs.getDrinkMessage();

      const actions = [
        {
          label: 'Done ✅',
          cls:   'pb-act-done',
          cb:    () => {
            const n = WaterTracker.increment();
            this._bubble.show(`💧 ${n} today — great job!`, 3);
            setTimeout(() => this._dismissNow(), 3100);
          }
        },
        {
          label: '⏰ 5 min',
          cls:   'pb-act-snooze',
          cb:    () => {
            this._dismissNow();
            setTimeout(() => this._doDrink(true), 5 * 60000);
          }
        }
      ];

      this._play(this._anim.pickRandom(keys), msg, todayCount, actions);
    }

    _onKey(e) {
      if (e.altKey && !['Alt','Control','Shift','Meta'].includes(e.key))
        console.log('[PixelBuddy] keydown — altKey=true key=' + e.key + ' busy=' + this._busy);
      const combo  = (this._s.general.shortcut || 'Alt+V');
      const parts  = combo.toLowerCase().split('+').map(p => p.trim());
      const key    = parts[parts.length - 1];
      const needAlt   = parts.includes('alt');
      const needCtrl  = parts.includes('ctrl') || parts.includes('control');
      const needShift = parts.includes('shift');
      const match = (e.altKey === needAlt && e.ctrlKey === needCtrl && e.shiftKey === needShift
                     && e.key.toLowerCase() === key);
      if (match) {
        e.preventDefault(); e.stopPropagation();
        console.log('[PixelBuddy] SHORTCUT MATCHED');
        if (this._busy) this._dismissNow();
        this._doGreeting();
      }
    }

    _play(key, msg, waterCount, actions) {
      console.log('[PixelBuddy] _play key=' + key + ' busy=' + this._busy);
      if (this._busy) return;
      this._busy = true;
      if (!document.getElementById('pb-pet')) {
        console.warn('[PixelBuddy] pet missing — rebuilding DOM');
        this._buildDOM();
        this._bubble = new SpeechBubbleManager(document.getElementById('pb-bubble'));
      }
      const pet = document.getElementById('pb-pet');
      const img = document.getElementById('pb-gif');
      if (!pet || !img) { console.error('[PixelBuddy] DOM missing'); this._busy = false; return; }
      // Ensure pet has a rendered layout before triggering the CSS transition.
      // display:none prevents any pixel from painting while the pet is idle.
      pet.style.display = 'flex';
      void pet.offsetWidth; // force synchronous layout so transition fires from opacity:0
      pet.classList.add('pb-pet--visible');

      if (actions && actions.length) {
        setTimeout(() => {
          const countHtml = (waterCount !== null && waterCount !== undefined)
            ? `<div class='pb-water-count'>💧 ${waterCount} today</div>` : '';
          const btnsHtml = actions.map(a =>
            `<button class='pb-action ${a.cls}'>${a.label}</button>`).join('');
          this._bubble.showWithActions(
            `<div class='pb-bubble-msg'>${msg}</div>${countHtml}<div class='pb-bubble-btns'>${btnsHtml}</div>`,
            0
          );
          actions.forEach(a => {
            const btn = this._bubble._el.querySelector('.' + a.cls);
            if (btn) btn.addEventListener('click', () => a.cb());
          });
        }, 400);
      } else {
        setTimeout(() => this._bubble.show(msg, this._s.timings.bubbleDuration), 400);
      }

      this._anim.play(key, img, () => {
        this._bubble.hide();
        pet.style.transition = 'opacity 0.5s ease';
        pet.style.opacity    = '0';
        setTimeout(() => {
          pet.classList.remove('pb-pet--visible');
          pet.style.display    = 'none';   // fully remove from paint tree — no ghost pixels
          pet.style.transition = '';
          pet.style.opacity    = '';
          img.removeAttribute('src');      // clear src so no decoded frame stays in memory/GPU
          this._busy = false;
        }, 550);
      }, this._s.timings.animationDuration);
    }

    _dismissNow() {
      this._busy = false;           // release immediately so next action can proceed
      this._anim && this._anim.stop();
      this._bubble && this._bubble.hide();
      const pet = document.getElementById('pb-pet');
      if (pet) {
        pet.style.transition = 'opacity 0.5s ease';
        pet.style.opacity    = '0';
        setTimeout(() => {
          pet.classList.remove('pb-pet--visible');
          pet.style.display    = 'none';
          pet.style.transition = '';
          pet.style.opacity    = '';
          const imgEl = document.getElementById('pb-gif');
          if (imgEl) imgEl.removeAttribute('src');
        }, 550);
      }
    }

    _openSettings() {
      if (this._panelOpen) return;
      this._panelOpen = true;
      if (!this._panel) {
        this._panel = new SettingsPanel(
          this._s,
          (newS) => {
            this._s          = newS;
            StorageManager.save(newS);
            this._anim._s    = newS;
            this._msgs._s    = newS;
            this._panel._s   = newS;
            this._reminders.stop();
            this._reminders = new ReminderManager(newS,
              () => this._doGreeting(), () => this._doDrink(true));
            this._reminders.start();
            this._panel.close();
          },
          () => { this._panelOpen = false; },
          () => this._doDrink(true)
        );
      }
      this._panel.open();
    }

    _buildDOM() {
      const pet    = document.createElement('div'); pet.id = 'pb-pet';
      const bubble = document.createElement('div'); bubble.id = 'pb-bubble';
      const wrap   = document.createElement('div'); wrap.id = 'pb-gif-wrap';
      const img    = document.createElement('img');
      img.id = 'pb-gif'; img.alt = ''; img.draggable = false;
      wrap.appendChild(img);
      pet.appendChild(bubble);
      pet.appendChild(wrap);
      pet.style.display = 'none'; // hidden until first animation plays
      document.body.appendChild(pet);
    }

    _injectStyles() {
      const css = [
        '#pb-pet,#pb-bubble,#pb-gif-wrap,#pb-gif,#pb-settings,#pb-settings *{box-sizing:border-box;font-family:Segoe UI,system-ui,sans-serif;}',
        '#pb-pet{position:fixed;bottom:0;right:12px;display:flex;flex-direction:column;align-items:flex-end;z-index:2147483639;pointer-events:none;transform:translateY(220px);opacity:0;transition:transform .45s cubic-bezier(.34,1.56,.64,1),opacity .35s ease;}',
        '#pb-pet.pb-pet--visible{transform:translateY(0);opacity:1;}',
        '#pb-bubble{position:relative;background:#1e1e32;color:#e8e6f0;border:1px solid #3a3a58;border-radius:16px;padding:11px 18px;font-size:13.5px;font-weight:500;line-height:1.45;max-width:min(240px,calc(100vw - 32px));text-align:center;box-shadow:0 6px 20px rgba(0,0,0,.45);margin-bottom:6px;opacity:0;transform:translateY(10px) scale(.96);transition:opacity .3s ease,transform .3s cubic-bezier(.34,1.56,.64,1);pointer-events:none;}',
        '#pb-bubble.pb-bubble--visible{opacity:1;transform:translateY(0) scale(1);}',
        '#pb-bubble.pb-bubble--interactive{pointer-events:auto;}',
        '#pb-bubble::after{content:\'\';position:absolute;bottom:-9px;right:26px;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:9px solid #1e1e32;}',
        '.pb-bubble-msg{margin-bottom:5px;}',
        '.pb-water-count{font-size:11.5px;color:#7ecfff;margin-bottom:9px;letter-spacing:.3px;}',
        '.pb-bubble-btns{display:flex;gap:8px;justify-content:center;margin-top:2px;}',
        '.pb-action{background:#252540;border:1px solid #3a3a5a;color:#e8e6f0;font-size:12px;font-weight:600;padding:5px 13px;border-radius:8px;cursor:pointer;transition:background .2s,border-color .2s,transform .1s;line-height:1.4;}',
        '.pb-action:hover{transform:scale(1.04);}',
        '.pb-act-done:hover{background:#2a5c3a;border-color:#4a9c6a;color:#90ffb8;}',
        '.pb-act-snooze:hover{background:#2a2a5c;border-color:#6a6abf;color:#b8b8ff;}',
        '#pb-gif-wrap{display:flex;align-items:flex-end;background:none;pointer-events:auto;cursor:context-menu;}',
        '#pb-gif{height:160px;width:auto;display:block;image-rendering:-webkit-optimize-contrast;image-rendering:auto;transform:translateZ(0);will-change:transform;backface-visibility:hidden;}',
        '#pb-settings{position:fixed;top:0;right:0;width:380px;height:100vh;background:#0d0d1c;border-left:1px solid #2a2a4a;z-index:2147483641;transform:translateX(100%);transition:transform .35s cubic-bezier(.4,0,.2,1);overflow-y:auto;pointer-events:none;}',
        '#pb-settings.pb-settings--open{transform:translateX(0);pointer-events:all;}',
        '.pb-si{padding:20px;}',
        '.pb-sh{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;}',
        '.pb-st{font-size:17px;font-weight:700;color:#c9b8ff;}',
        '.pb-sc{background:none;border:none;color:#888;font-size:20px;cursor:pointer;line-height:1;padding:4px 8px;border-radius:6px;transition:color .2s,background .2s;}',
        '.pb-sc:hover{color:#fff;background:#2a2a4a;}',
        '.pb-tabs{display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap;}',
        '.pb-tab{background:#16162a;border:1px solid #2a2a4a;color:#888;font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;cursor:pointer;transition:all .2s;}',
        '.pb-tab:hover{color:#c9b8ff;border-color:#8b6cf7;}',
        '.pb-tab.active{background:#8b6cf7;border-color:#8b6cf7;color:#fff;}',
        '.pb-tc{min-height:180px;}',
        '.pb-panel{display:none;}',
        '.pb-panel.active{display:block;}',
        '.pb-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1e1e38;color:#b0aac8;font-size:14px;cursor:default;}',
        '.pb-row input[type=text],.pb-row input[type=number]{background:#16162a;border:1px solid #2a2a4a;color:#e8e6f0;padding:5px 10px;border-radius:8px;width:110px;font-size:13px;outline:none;}',
        '.pb-row input[type=text]:focus,.pb-row input[type=number]:focus{border-color:#8b6cf7;}',
        '.pb-row input[type=checkbox]{width:18px;height:18px;cursor:pointer;accent-color:#8b6cf7;}',
        '.pb-msg-section{margin-top:14px;}',
        '.pb-msg-label{color:#b0aac8;font-size:13px;font-weight:600;margin-bottom:6px;}',
        '.pb-msg-hint{color:#6a6a8a;font-size:11px;font-weight:400;}',
        '.pb-textarea{width:100%;background:#16162a;border:1px solid #2a2a4a;color:#e8e6f0;padding:8px 10px;border-radius:8px;font-size:12px;font-family:Segoe UI,system-ui,sans-serif;resize:vertical;min-height:82px;outline:none;line-height:1.55;display:block;}',
        '.pb-textarea:focus{border-color:#8b6cf7;}',
        '.pb-sf{display:flex;gap:10px;margin-top:24px;}',
        '.pb-btn{flex:1;padding:10px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:none;transition:all .2s;}',
        '.pb-btn-save{background:#8b6cf7;color:#fff;}',
        '.pb-btn-save:hover{background:#7c5ef5;}',
        '.pb-btn-reset{background:#16162a;color:#888;border:1px solid #2a2a4a;}',
        '.pb-btn-reset:hover{color:#e88;border-color:#e88;}',
        '.pb-hint{color:#6a6a8a;font-size:12px;line-height:1.6;margin:8px 0 4px;padding:0 2px;}',
        '.pb-btn-test{background:#16162a;border:1px solid #2a2a4a;color:#8b6cf7;font-size:12px;font-weight:600;padding:5px 14px;border-radius:8px;cursor:pointer;transition:all .2s;}',
        '.pb-btn-test:hover{background:#8b6cf7;color:#fff;border-color:#8b6cf7;}',
        '#s-shortcut{cursor:pointer;text-align:center;font-weight:700;letter-spacing:.5px;}'
      ].join('\n');
      const style = document.createElement('style');
      style.id = 'pb-styles';
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  // BOOTSTRAP
  new PixelBuddy().init();

})();
