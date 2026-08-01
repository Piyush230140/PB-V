// ==UserScript==
// @name         Pixel Buddy
// @namespace    http://tampermonkey.net/
// @version      3.13.0
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

  const DEFAULT_GREETING_POOL = [
    "You're beautiful! \ud83d\udc99","Have a wonderful day! \u2600\ufe0f","You've got this! \ud83d\udcaa",
    "Hello there! \ud83d\udc4b","Great to see you! \ud83d\ude0a","Hope you're having a good day!",
    "You're doing amazing! \u2728","Keep up the great work! \ud83c\udf1f",
    "Smile! You deserve it! \ud83d\ude04","Today is your day! \ud83c\udf89"
  ];
  const DEFAULT_DRINK_POOL = [
    "Drink some water! \ud83d\udca7","Stay hydrated! \ud83d\udca6","Time for a water break! \ud83e\udd64",
    "Don't forget to drink water!","Your body needs water! \ud83d\udca7",
    "Hydration is key! \ud83c\udf0a","Take a sip! \ud83d\udca6"
  ];
  const DEFAULT_SLEEP_POOL = [
    "Time to rest your eyes! \ud83d\ude34","Take a break! \ud83c\udf19",
    "Maybe it's time to sleep? \ud83d\udca4","Rest is important too! \ud83c\udf1b","Your eyes need rest! \ud83d\udc40"
  ];

  const DEFAULT_SETTINGS = {
    general:    { enabled: true, name: 'Pixel Buddy', showOnAllSites: true, shortcut: 'Alt+V', bubbleEnabled: true },
    timings:    { greetingInterval: 30, drinkInterval: 60, animationDuration: 9.5, bubbleDuration: 7 },
    messages:   { greetingEnabled: true, drinkEnabled: true, sleepEnabled: true,
                  greetingPool: DEFAULT_GREETING_POOL.slice(),
                  drinkPool:    DEFAULT_DRINK_POOL.slice(),
                  sleepPool:    DEFAULT_SLEEP_POOL.slice() },
    animations: { wave: true, headtilt: true, happybounce: true, drinkwater: true },
    appearance: { petSize: 160, petOpacity: 1, position: 'bottom-right' },
    behaviour:  { soundEnabled: false, showOnStartup: false }
  };

  class StorageManager {
    static KEY = 'pb_settings_v5';
    static load() {
      try {
        const raw5 = GM_getValue(StorageManager.KEY, null);
        if (raw5) {
          const saved = JSON.parse(raw5);
          const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
          for (const k of Object.keys(DEFAULT_SETTINGS))
            if (saved[k] && typeof saved[k] === 'object') Object.assign(out[k], saved[k]);
          StorageManager._guard(out); return out;
        }
        const raw4 = GM_getValue('pb_settings_v4', null);
        if (raw4) {
          const v4 = JSON.parse(raw4);
          const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
          for (const k of ['timings','messages','animations'])
            if (v4[k]) Object.assign(out[k], v4[k]);
          if (v4.general) {
            const { name, showOnAllSites, shortcut } = v4.general;
            if (name)                          out.general.name = name;
            if (showOnAllSites !== undefined)  out.general.showOnAllSites = showOnAllSites;
            if (shortcut)                      out.general.shortcut = shortcut;
          }
          out.behaviour.showOnStartup = false;
          StorageManager._guard(out);
          StorageManager.save(out); return out;
        }
        return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      } catch(e) { return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
    }
    static _guard(out) {
      if (!out.appearance) out.appearance = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.appearance));
      if (!Array.isArray(out.messages.greetingPool)) out.messages.greetingPool = DEFAULT_GREETING_POOL.slice();
      if (!Array.isArray(out.messages.drinkPool))    out.messages.drinkPool    = DEFAULT_DRINK_POOL.slice();
      if (!Array.isArray(out.messages.sleepPool))    out.messages.sleepPool    = DEFAULT_SLEEP_POOL.slice();
      if (!Object.keys(DEFAULT_SETTINGS.animations).some(k => out.animations[k]))
        Object.assign(out.animations, DEFAULT_SETTINGS.animations);
    }
    static save(s) { GM_setValue(StorageManager.KEY, JSON.stringify(s)); }
  }

  class MessageManager {
    static Q_KEY = 'pb_msg_q_v1';
    constructor(settings) {
      this._s = settings; this._q = {};
      try { const r = GM_getValue(MessageManager.Q_KEY, null); if (r) this._q = JSON.parse(r); } catch(e) {}
    }
    _shuffle(a) {
      const b = [...a];
      for (let i = b.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [b[i],b[j]]=[b[j],b[i]]; }
      return b;
    }
    _pick(cat) {
      const pool = (this._s.messages[cat+'Pool']||[]).filter(m => m && m.trim());
      const src  = pool.length ? pool : (cat==='drink'?DEFAULT_DRINK_POOL:cat==='sleep'?DEFAULT_SLEEP_POOL:DEFAULT_GREETING_POOL);
      if (!this._q[cat] || !this._q[cat].length || !this._q[cat].some(m => src.includes(m)))
        this._q[cat] = this._shuffle(src);
      const msg = this._q[cat].shift();
      GM_setValue(MessageManager.Q_KEY, JSON.stringify(this._q));
      return msg;
    }
    getGreetingMessage() { return this._pick('greeting'); }
    getDrinkMessage()    { return this._pick('drink'); }
    getSleepMessage()    { return this._pick('sleep'); }
    resetQueues()        { this._q = {}; GM_setValue(MessageManager.Q_KEY, '{}'); }
  }

  class WaterTracker {
    static KEY = 'pb_water_v1';
    constructor() { this._count = parseInt(GM_getValue(WaterTracker.KEY,'0'),10)||0; }
    increment() { this._count++; GM_setValue(WaterTracker.KEY,String(this._count)); return this._count; }
    getCount()  { return this._count; }
    reset()     { this._count=0; GM_setValue(WaterTracker.KEY,'0'); }
  }

  class AnimationManager {
    static BASE  = 'https://raw.githubusercontent.com/Piyush230140/PB-V/main/';
    static CATS  = { greeting:['wave','headtilt','happybounce'], drink:['drinkwater'] };
    static URLS  = { wave:'pb-wave.webp', headtilt:'pb-headtilt.webp', happybounce:'pb-happybounce.webp', drinkwater:'pb-drinkwater.webp' };
    static Q_KEY = 'pb_anim_q_v1';

    constructor(settings, imgEl) {
      this._s=settings; this._img=imgEl; this._q={}; this._t=null;
      try { const r=GM_getValue(AnimationManager.Q_KEY,null); if(r) this._q=JSON.parse(r); } catch(e){}
    }
    _shuffle(a) {
      const b=[...a];
      for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}
      return b;
    }
    _enabled(cat) {
      const keys=AnimationManager.CATS[cat]||[];
      const en=keys.filter(k=>this._s.animations[k]!==false);
      return en.length?en:keys;
    }
    pickFromCategory(cat) {
      const pool=this._enabled(cat);
      if(!this._q[cat]||!this._q[cat].length||!this._q[cat].some(k=>pool.includes(k)))
        this._q[cat]=this._shuffle(pool);
      const key=this._q[cat].shift();
      GM_setValue(AnimationManager.Q_KEY,JSON.stringify(this._q));
      return key;
    }
    resetQueues() { this._q={}; GM_setValue(AnimationManager.Q_KEY,'{}'); }
    play(key, duration, onDone) {
      if(this._t){clearTimeout(this._t);this._t=null;}
      const url=AnimationManager.BASE+(AnimationManager.URLS[key]||'pb-wave.webp');
      this._img.src=url;
      this._img.style.display='block';
      this._img.style.opacity='0';
      requestAnimationFrame(()=>{ this._img.style.opacity='1'; });
      this._t=setTimeout(()=>{
        this._img.style.opacity='0';
        setTimeout(()=>{
          this._img.style.display='none'; this._img.src=''; this._t=null;
          if(onDone) onDone();
        },400);
      }, duration*1000);
    }
    stop() {
      if(this._t){clearTimeout(this._t);this._t=null;}
      this._img.style.opacity='0';
      setTimeout(()=>{this._img.style.display='none';this._img.src='';},400);
    }
  }

  class SpeechBubbleManager {
    constructor(el) { this._el=el; this._t=null; }
    show(text, duration) {
      if(this._t){clearTimeout(this._t);this._t=null;}
      this._el.innerHTML = '<span>'+text+'</span>';
      this._el.style.display='block';
      requestAnimationFrame(()=>{ this._el.style.opacity='1'; });
      this._t=setTimeout(()=>this.hide(), duration*1000);
    }
    showWithActions(text, duration, onDone, onSnooze) {
      if(this._t){clearTimeout(this._t);this._t=null;}
      this._el.innerHTML =
        '<span>'+text+'</span>'+
        '<div class="pb-bubble-actions">'+
          '<button class="pb-bubble-btn pb-btn-done">Done</button>'+
          '<button class="pb-bubble-btn pb-btn-snooze">Remind in 5</button>'+
        '</div>';
      this._el.style.display='block';
      requestAnimationFrame(()=>{ this._el.style.opacity='1'; });
      this._el.querySelector('.pb-btn-done').addEventListener('click', ()=>{
        this.hide(); if(onDone) onDone();
      });
      this._el.querySelector('.pb-btn-snooze').addEventListener('click', ()=>{
        this.hide(); if(onSnooze) onSnooze();
      });
      this._t=setTimeout(()=>this.hide(), duration*1000);
    }
    hide() {
      if(this._t){clearTimeout(this._t);this._t=null;}
      this._el.style.opacity='0';
      setTimeout(()=>{ this._el.style.display='none'; this._el.innerHTML=''; },400);
    }
  }

  class ReminderManager {
    constructor(onGreeting, onDrink) { this._og=onGreeting; this._od=onDrink; this._gt=null; this._dt=null; }
    start(s) {
      this.stop();
      this._gt=setInterval(this._og,(s.timings.greetingInterval||30)*60000);
      this._dt=setInterval(this._od,(s.timings.drinkInterval||60)*60000);
    }
    stop() { if(this._gt){clearInterval(this._gt);this._gt=null;} if(this._dt){clearInterval(this._dt);this._dt=null;} }
    restart(s) { this.stop(); this.start(s); }
  }

  class SettingsPanel {
    constructor(settings, onSave) {
      this._s=settings; this._onSave=onSave;
      this._toastT=null; this._ro=null; this._escH=null;
      this._muH=null; this._mmH=null; this._dragging=false; this._ox=0; this._oy=0;
    }

    open() {
      const existing=document.getElementById('pb-settings');
      if (existing) {
        const ov=document.getElementById('pb-overlay');
        existing.style.display='flex';
        if(ov) ov.style.display='block';
        requestAnimationFrame(()=>{
          existing.style.opacity='1'; existing.style.transform='scale(1)';
          if(ov) ov.style.opacity='1';
        });
        return;
      }
      this._build();
    }

    close() {
      const m=document.getElementById('pb-settings');
      const o=document.getElementById('pb-overlay');
      if(m){m.style.opacity='0';m.style.transform='scale(0.94)';}
      if(o) o.style.opacity='0';
      setTimeout(()=>{if(m)m.style.display='none';if(o)o.style.display='none';},220);
      if(this._escH){document.removeEventListener('keydown',this._escH);this._escH=null;}
      if(this._muH) document.removeEventListener('mouseup',this._muH);
      if(this._mmH) document.removeEventListener('mousemove',this._mmH);
    }

    _build() {
      const ov=document.createElement('div');
      ov.id='pb-overlay';
      ov.addEventListener('click',()=>this.close());
      document.body.appendChild(ov);

      const modal=document.createElement('div');
      modal.id='pb-settings';
      try {
        const pos=JSON.parse(GM_getValue('pb_panel_pos_v1','{}'));
        if(pos.left)   modal.style.left=pos.left;
        if(pos.top)    modal.style.top=pos.top;
        if(pos.width)  modal.style.width=pos.width;
        if(pos.height) modal.style.height=pos.height;
      } catch(e){}
      if(!modal.style.left){
        modal.style.left=Math.max(0,(window.innerWidth-620)/2)+'px';
        modal.style.top=Math.max(0,(window.innerHeight-540)/2)+'px';
      }
      modal.style.opacity='0'; modal.style.transform='scale(0.94)'; modal.style.display='flex';
      modal.innerHTML=this._buildHTML();
      document.body.appendChild(modal);
      requestAnimationFrame(()=>{
        modal.style.opacity='1'; modal.style.transform='scale(1)';
        ov.style.display='block';
        requestAnimationFrame(()=>{ ov.style.opacity='1'; });
      });
      this._wireDrag(modal);
      this._wireResize(modal);
      this._wireEvents(modal);
      this._wireSearch(modal);
      this._switchTab(modal,'general');
      this._escH=e=>{ if(e.key==='Escape') this.close(); };
      document.addEventListener('keydown',this._escH);
    }

    _buildHTML() {
      return this._hdr()+this._tabs()+
        '<div class="pb-body">'+
          this._bGeneral()+this._bAnimations()+this._bMessages()+
          this._bReminders()+this._bAppearance()+this._bShortcuts()+
          this._bAdvanced()+this._bAbout()+
        '</div><div id="pb-toast">\u2713 Saved</div>';
    }

    _hdr() {
      return '<div class="pb-header">'+
        '<span class="pb-title">\u2699\ufe0f Pixel Buddy Settings</span>'+
        '<input type="text" id="pb-search" placeholder="Search\u2026" autocomplete="off">'+
        '<button class="pb-close-btn" id="pb-close-btn">\u2715</button></div>';
    }
    _tabs() {
      const t=['general','animations','messages','reminders','appearance','shortcuts','advanced','about'];
      const l=['General','Animations','Messages','Reminders','Appearance','Shortcuts','Advanced','About'];
      return '<div class="pb-tab-bar">'+t.map((v,i)=>'<button class="pb-tab" data-tab="'+v+'">'+l[i]+'</button>').join('')+'</div>';
    }
    _row(lbl,desc,ctrl,tip) {
      const t=tip?' title="'+tip+'"':'';
      return '<div class="pb-row" data-label="'+lbl.toLowerCase()+'">'+
        '<div class="pb-row-info"><span class="pb-row-label"'+t+'>'+lbl+'</span>'+
        (desc?'<span class="pb-row-desc">'+desc+'</span>':'')+
        '</div><div class="pb-row-ctrl">'+ctrl+'</div></div>';
    }
    _tog(id,val) {
      return '<label class="pb-switch"><input type="checkbox" id="'+id+'"'+(val?' checked':'')+
        '><span class="pb-knob"></span></label>';
    }
    _num(id,val,mn,mx,st) {
      return '<input type="number" class="pb-num-input" id="'+id+'" value="'+val+
        '" min="'+mn+'" max="'+mx+'" step="'+(st||1)+'">';
    }
    _rng(id,val,mn,mx,st,sfx) {
      return '<div class="pb-range-wrap">'+
        '<input type="range" class="pb-range" id="'+id+'" value="'+val+
        '" min="'+mn+'" max="'+mx+'" step="'+(st||1)+'">'+
        '<span class="pb-range-val" data-for="'+id+'">'+val+(sfx||'')+'</span></div>';
    }

    _bGeneral() {
      const s=this._s;
      return '<div class="pb-panel" data-panel="general">'+
        '<div class="pb-section-title">General</div>'+
        this._row('Enable Pixel Buddy','Show or hide the companion',this._tog('pb-s-enabled',s.general.enabled))+
        this._row('Show on Startup','Play greeting animation on page load',this._tog('pb-s-startup',s.behaviour.showOnStartup),'Off by default')+
        this._row('Speech Bubbles','Show message bubbles above the pet',this._tog('pb-s-bubble',s.general.bubbleEnabled))+
        this._row('Show on All Sites','Appear on every website',this._tog('pb-s-allsites',s.general.showOnAllSites))+
        this._row('Pet Name','Name used in the UI','<input type="text" class="pb-text-input" id="pb-s-name" value="'+(s.general.name||'Pixel Buddy')+'">')+
        '</div>';
    }

    _bAnimations() {
      const s=this._s;
      return '<div class="pb-panel" data-panel="animations">'+
        '<div class="pb-section-title">Animation Pool</div>'+
        this._row('Wave','Friendly wave',this._tog('pb-s-anim-wave',s.animations.wave))+
        this._row('Head Tilt','Curious head tilt',this._tog('pb-s-anim-headtilt',s.animations.headtilt))+
        this._row('Happy Bounce','Joyful bounce',this._tog('pb-s-anim-happybounce',s.animations.happybounce))+
        this._row('Drink Water','Hydration animation',this._tog('pb-s-anim-drinkwater',s.animations.drinkwater))+
        '<div class="pb-section-title">Preview</div>'+
        '<div class="pb-btn-row">'+
        '<button class="pb-action-btn" id="pb-s-preview-greet">\u25b6 Greeting</button>'+
        '<button class="pb-action-btn" id="pb-s-preview-drink">\u25b6 Drink</button>'+
        '</div></div>';
    }

    _bMessages() {
      const s=this._s;
      const e=t=>t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const gp=e((s.messages.greetingPool||DEFAULT_GREETING_POOL).join('\n'));
      const dp=e((s.messages.drinkPool   ||DEFAULT_DRINK_POOL   ).join('\n'));
      const sp=e((s.messages.sleepPool   ||DEFAULT_SLEEP_POOL   ).join('\n'));
      return '<div class="pb-panel" data-panel="messages">'+
        '<div class="pb-section-title">Greeting Messages</div>'+
        this._row('Enable Greetings','Show greeting speech bubbles',this._tog('pb-s-greetEnabled',s.messages.greetingEnabled))+
        '<div class="pb-ta-wrap"><span class="pb-row-desc">One message per line</span>'+
        '<textarea class="pb-textarea" id="pb-s-greetPool" rows="5">'+gp+'</textarea>'+
        '<div class="pb-btn-row"><button class="pb-action-btn secondary" id="pb-s-restoreGreet">\u21ba Restore Defaults</button></div></div>'+
        '<div class="pb-section-title">Drink Messages</div>'+
        this._row('Enable Drink Reminders','Show water reminder bubbles',this._tog('pb-s-drinkEnabled',s.messages.drinkEnabled))+
        '<div class="pb-ta-wrap"><span class="pb-row-desc">One message per line</span>'+
        '<textarea class="pb-textarea" id="pb-s-drinkPool" rows="5">'+dp+'</textarea>'+
        '<div class="pb-btn-row"><button class="pb-action-btn secondary" id="pb-s-restoreDrink">\u21ba Restore Defaults</button></div></div>'+
        '<div class="pb-section-title">Sleep Messages</div>'+
        this._row('Enable Sleep Reminders','Show sleep reminder bubbles',this._tog('pb-s-sleepEnabled',s.messages.sleepEnabled))+
        '<div class="pb-ta-wrap"><span class="pb-row-desc">One message per line</span>'+
        '<textarea class="pb-textarea" id="pb-s-sleepPool" rows="5">'+sp+'</textarea>'+
        '<div class="pb-btn-row"><button class="pb-action-btn secondary" id="pb-s-restoreSleep">\u21ba Restore Defaults</button></div></div>'+
        '</div>';
    }

    _bReminders() {
      const s=this._s;
      return '<div class="pb-panel" data-panel="reminders">'+
        '<div class="pb-section-title">Intervals</div>'+
        this._row('Greeting Interval','Minutes between greeting animations',this._num('pb-s-greetInterval',s.timings.greetingInterval,1,999,1),'Minutes')+
        this._row('Drink Interval','Minutes between drink reminders',this._num('pb-s-drinkInterval',s.timings.drinkInterval,1,999,1),'Minutes')+
        '<div class="pb-section-title">Durations</div>'+
        this._row('Animation Duration','Seconds to show each animation',this._num('pb-s-animDuration',s.timings.animationDuration,1,60,0.5),'Seconds')+
        this._row('Bubble Duration','Seconds to show speech bubble',this._num('pb-s-bubbleDuration',s.timings.bubbleDuration,1,60,0.5),'Seconds')+
        '<div class="pb-section-title">Test</div>'+
        '<div class="pb-btn-row"><button class="pb-action-btn" id="pb-s-testDrink">\ud83d\udca7 Test Drink Reminder</button></div>'+
        '</div>';
    }

    _bAppearance() {
      const s=this._s;
      const sz=s.appearance.petSize||160;
      const op=s.appearance.petOpacity||1;
      const pos=s.appearance.position||'bottom-right';
      const opts=['bottom-right','bottom-left','top-right','top-left'];
      return '<div class="pb-panel" data-panel="appearance">'+
        '<div class="pb-section-title">Pet Size &amp; Opacity</div>'+
        this._row('Pet Size','Height in pixels (80\u2013240)',this._rng('pb-s-petSize',sz,80,240,4,'px'))+
        this._row('Pet Opacity','Transparency (0.3\u20131.0)',this._rng('pb-s-petOpacity',op,0.3,1,0.05,''))+
        '<div class="pb-section-title">Position</div>'+
        this._row('Screen Corner','Where the pet appears',
          '<select class="pb-select" id="pb-s-position">'+
          opts.map(v=>'<option value="'+v+'"'+(v===pos?' selected':'')+'>'+v+'</option>').join('')+
          '</select>')+
        '</div>';
    }

    _bShortcuts() {
      const s=this._s;
      return '<div class="pb-panel" data-panel="shortcuts">'+
        '<div class="pb-section-title">Keyboard Shortcut</div>'+
        this._row('Toggle Pet','Show/hide with a key combo',
          '<input type="text" class="pb-shortcut-input" id="pb-s-shortcut" value="'+(s.general.shortcut||'Alt+V')+
          '" readonly placeholder="Click then press keys\u2026">','Click field then press a combo')+
        '<p style="font-size:12px;color:rgba(255,255,255,0.4);margin:10px 0;line-height:1.6">'+
        'Click the shortcut field, then press any key combination such as Alt+P. '+
        'The shortcut instantly toggles pet visibility.</p></div>';
    }

    _bAdvanced() {
      return '<div class="pb-panel" data-panel="advanced">'+
        '<div class="pb-section-title">Data</div>'+
        '<div class="pb-btn-row">'+
        '<button class="pb-action-btn secondary" id="pb-s-exportSettings">\u2b07 Export Settings</button>'+
        '<button class="pb-action-btn secondary" id="pb-s-importSettings">\u2b06 Import Settings</button>'+
        '</div><div class="pb-section-title">History</div>'+
        '<div class="pb-btn-row">'+
        '<button class="pb-action-btn secondary" id="pb-s-resetMsgHistory">\u21ba Reset Message History</button>'+
        '<button class="pb-action-btn secondary" id="pb-s-resetAnimHistory">\u21ba Reset Anim History</button>'+
        '</div><div class="pb-section-title">Reset</div>'+
        '<div class="pb-btn-row">'+
        '<button class="pb-action-btn danger" id="pb-s-factoryReset">\u26a0\ufe0f Factory Reset</button>'+
        '</div><p style="font-size:11px;color:rgba(255,255,255,0.32);margin-top:8px;line-height:1.6">'+
        'Factory reset removes all saved settings and reloads the page.</p></div>';
    }

    _bAbout() {
      return '<div class="pb-panel" data-panel="about">'+
        '<div class="pb-about-logo">\ud83d\udc3e</div>'+
        '<div class="pb-about-title">Pixel Buddy</div>'+
        '<div class="pb-about-ver">v3.13.0</div>'+
        '<div class="pb-about-desc">Your friendly desktop companion.<br>'+
        'Plays animations, shows motivational messages,<br>'+
        'and reminds you to stay hydrated.<br><br>'+
        'All settings auto-save instantly.<br>'+
        'No server. No tracking. Just vibes.</div></div>';
    }

    _wireDrag(modal) {
      const hdr=modal.querySelector('.pb-header');
      this._mmH=e=>{
        if(!this._dragging) return;
        const nx=Math.max(0,Math.min(window.innerWidth-modal.offsetWidth,e.clientX-this._ox));
        const ny=Math.max(0,Math.min(window.innerHeight-modal.offsetHeight,e.clientY-this._oy));
        modal.style.left=nx+'px'; modal.style.top=ny+'px';
      };
      this._muH=()=>{ if(this._dragging){this._dragging=false;this._savePos(modal);} };
      hdr.addEventListener('mousedown',e=>{
        if(e.target.id==='pb-close-btn'||e.target.id==='pb-search') return;
        this._dragging=true;
        this._ox=e.clientX-modal.offsetLeft;
        this._oy=e.clientY-modal.offsetTop;
        e.preventDefault();
      });
      document.addEventListener('mousemove',this._mmH);
      document.addEventListener('mouseup',this._muH);
    }

    _wireResize(modal) {
      if(!window.ResizeObserver) return;
      let t=null;
      this._ro=new ResizeObserver(()=>{
        if(t) clearTimeout(t);
        t=setTimeout(()=>this._savePos(modal),400);
      });
      this._ro.observe(modal);
    }

    _savePos(modal) {
      GM_setValue('pb_panel_pos_v1',JSON.stringify({
        left:modal.style.left, top:modal.style.top,
        width:modal.offsetWidth+'px', height:modal.offsetHeight+'px'
      }));
    }

    _wireEvents(modal) {
      const g=id=>document.getElementById(id);

      g('pb-close-btn').addEventListener('click',()=>this.close());

      modal.querySelectorAll('.pb-tab').forEach(btn=>{
        btn.addEventListener('click',()=>this._switchTab(modal,btn.dataset.tab));
      });

      // Checkboxes + selects: immediate save
      modal.querySelectorAll('input[type=checkbox],select').forEach(el=>{
        el.addEventListener('change',()=>this._autoSave());
      });

      // Ranges: update display value + save
      modal.querySelectorAll('input[type=range]').forEach(el=>{
        el.addEventListener('input',()=>{
          const d=modal.querySelector('[data-for="'+el.id+'"]');
          if(d){ const sfx=el.id==='pb-s-petSize'?'px':''; d.textContent=el.value+sfx; }
          this._autoSave();
        });
      });

      // Number + text inputs: debounced
      let debT=null;
      const dSave=()=>{ if(debT) clearTimeout(debT); debT=setTimeout(()=>this._autoSave(),400); };
      modal.querySelectorAll('input[type=number],input[type=text]').forEach(el=>{
        if(el.id==='pb-search'||el.id==='pb-s-shortcut') return;
        el.addEventListener('input',dSave);
      });
      modal.querySelectorAll('textarea').forEach(el=>el.addEventListener('input',dSave));

      // Shortcut capture
      const sc=g('pb-s-shortcut');
      if(sc){
        sc.addEventListener('keydown',e=>{
          e.preventDefault(); e.stopPropagation();
          const p=[];
          if(e.ctrlKey)  p.push('Ctrl');
          if(e.altKey)   p.push('Alt');
          if(e.shiftKey) p.push('Shift');
          if(e.metaKey)  p.push('Meta');
          const k=e.key;
          if(!['Control','Alt','Shift','Meta'].includes(k))
            p.push(k.length===1?k.toUpperCase():k);
          if(p.length>1){ sc.value=p.join('+'); this._autoSave(); }
        });
      }

      // Preview buttons
      g('pb-s-preview-greet')?.addEventListener('click',()=>this._onSave(this._s,'preview-greeting'));
      g('pb-s-preview-drink')?.addEventListener('click',()=>this._onSave(this._s,'preview-drink'));

      // Restore defaults
      g('pb-s-restoreGreet')?.addEventListener('click',()=>{
        const ta=g('pb-s-greetPool'); if(ta){ta.value=DEFAULT_GREETING_POOL.join('\n');this._autoSave();}
      });
      g('pb-s-restoreDrink')?.addEventListener('click',()=>{
        const ta=g('pb-s-drinkPool'); if(ta){ta.value=DEFAULT_DRINK_POOL.join('\n');this._autoSave();}
      });
      g('pb-s-restoreSleep')?.addEventListener('click',()=>{
        const ta=g('pb-s-sleepPool'); if(ta){ta.value=DEFAULT_SLEEP_POOL.join('\n');this._autoSave();}
      });

      // Test drink
      g('pb-s-testDrink')?.addEventListener('click',()=>this._onSave(this._s,'test-drink'));

      // Advanced
      g('pb-s-exportSettings')?.addEventListener('click',()=>{
        const blob=new Blob([JSON.stringify(this._s,null,2)],{type:'application/json'});
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a'); a.href=url; a.download='pixel-buddy-settings.json'; a.click();
        URL.revokeObjectURL(url);
      });
      g('pb-s-importSettings')?.addEventListener('click',()=>{
        const inp=document.createElement('input'); inp.type='file'; inp.accept='.json';
        inp.onchange=e=>{
          const file=e.target.files[0]; if(!file) return;
          const reader=new FileReader();
          reader.onload=ev=>{
            try {
              const data=JSON.parse(ev.target.result);
              this._s=Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),data);
              StorageManager.save(this._s);
              this._onSave(this._s,'reload');
            } catch(e){ alert('Invalid settings file'); }
          };
          reader.readAsText(file);
        };
        inp.click();
      });
      g('pb-s-resetMsgHistory')?.addEventListener('click',()=>{
        this._onSave(this._s,'reset-msg-history');
        this._showToast('\u21ba Message history reset');
      });
      g('pb-s-resetAnimHistory')?.addEventListener('click',()=>{
        this._onSave(this._s,'reset-anim-history');
        this._showToast('\u21ba Anim history reset');
      });
      g('pb-s-factoryReset')?.addEventListener('click',()=>{
        if(!confirm('Factory reset Pixel Buddy? All settings will be lost.')) return;
        this._s=JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        StorageManager.save(this._s);
        this._onSave(this._s,'reload');
      });
    }

    _wireSearch(modal) {
      const inp=modal.querySelector('#pb-search');
      if(!inp) return;
      inp.addEventListener('input',()=>{
        const q=inp.value.toLowerCase().trim();
        const panel=modal.querySelector('.pb-panel.active');
        if(!panel) return;
        panel.querySelectorAll('.pb-row').forEach(row=>{
          row.style.display=(!q||(row.dataset.label||'').includes(q))?'':'none';
        });
      });
    }

    _switchTab(modal, tab) {
      modal.querySelectorAll('.pb-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
      modal.querySelectorAll('.pb-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===tab));
      const s=modal.querySelector('#pb-search');
      if(s){s.value='';modal.querySelectorAll('.pb-row').forEach(r=>r.style.display='');}
    }

    _autoSave() {
      const g=id=>document.getElementById(id);
      const chk=(id,def)=>{ const el=g(id); return el?el.checked:def; };
      const val=(id,def)=>{ const el=g(id); return el?el.value:def; };
      const num=(id,def)=>{ const el=g(id); return el?(parseFloat(el.value)||def):def; };

      const s=JSON.parse(JSON.stringify(this._s));
      s.general.enabled         = chk('pb-s-enabled',   s.general.enabled);
      s.general.name            = val('pb-s-name',       s.general.name);
      s.general.showOnAllSites  = chk('pb-s-allsites',   s.general.showOnAllSites);
      s.general.bubbleEnabled   = chk('pb-s-bubble',     s.general.bubbleEnabled);
      s.behaviour.showOnStartup = chk('pb-s-startup',    s.behaviour.showOnStartup);

      ['wave','headtilt','happybounce','drinkwater'].forEach(k=>{
        const el=g('pb-s-anim-'+k); if(el) s.animations[k]=el.checked;
      });

      s.messages.greetingEnabled = chk('pb-s-greetEnabled', s.messages.greetingEnabled);
      s.messages.drinkEnabled    = chk('pb-s-drinkEnabled',  s.messages.drinkEnabled);
      s.messages.sleepEnabled    = chk('pb-s-sleepEnabled',  s.messages.sleepEnabled);

      const pp=id=>{
        const el=g(id); if(!el) return null;
        const lines=el.value.split('\n').map(l=>l.trim()).filter(Boolean);
        return lines.length?lines:null;
      };
      s.messages.greetingPool = pp('pb-s-greetPool') || s.messages.greetingPool;
      s.messages.drinkPool    = pp('pb-s-drinkPool') || s.messages.drinkPool;
      s.messages.sleepPool    = pp('pb-s-sleepPool') || s.messages.sleepPool;

      s.timings.greetingInterval  = num('pb-s-greetInterval',  30);
      s.timings.drinkInterval     = num('pb-s-drinkInterval',  60);
      s.timings.animationDuration = num('pb-s-animDuration',   9.5);
      s.timings.bubbleDuration    = num('pb-s-bubbleDuration', 7);

      s.appearance.petSize    = num('pb-s-petSize',    160);
      s.appearance.petOpacity = num('pb-s-petOpacity', 1);
      const posEl=g('pb-s-position'); if(posEl) s.appearance.position=posEl.value;

      const scEl=g('pb-s-shortcut'); if(scEl&&scEl.value) s.general.shortcut=scEl.value;

      this._s=s;
      this._onSave(s);
      this._showToast();
    }

    _showToast(msg) {
      const t=document.getElementById('pb-toast'); if(!t) return;
      t.textContent=msg||'\u2713 Saved';
      t.classList.add('pb-toast--show');
      if(this._toastT) clearTimeout(this._toastT);
      this._toastT=setTimeout(()=>t.classList.remove('pb-toast--show'),2000);
    }
  }

  const PB_CSS = `
    #pb-pet {
      position:fixed; bottom:10px; right:10px; z-index:2147483640;
      display:flex; flex-direction:column; align-items:center;
      pointer-events:auto; will-change:transform; cursor:default;
    }
    #pb-gif {
      pointer-events:auto; height:160px; width:auto;
      image-rendering:-webkit-optimize-contrast; image-rendering:crisp-edges;
      transition:opacity .4s ease; display:none; opacity:0;
    }
    #pb-bubble {
      pointer-events:auto; background:rgba(14,14,26,0.95);
      border:1px solid rgba(130,100,255,0.4); border-radius:12px;
      padding:8px 12px; max-width:220px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:13px; color:#e0e0f8; text-align:center; margin-bottom:8px;
      line-height:1.5; box-shadow:0 4px 16px rgba(0,0,0,0.4);
      transition:opacity .4s ease; display:none; opacity:0;
    }
    .pb-bubble-actions {
      display:flex; gap:6px; margin-top:8px; justify-content:center;
    }
    .pb-bubble-btn {
      background:rgba(130,100,255,0.25); border:1px solid rgba(130,100,255,0.5);
      border-radius:6px; padding:3px 12px; color:#e0e0f8; font-size:11px;
      cursor:pointer; transition:all .15s; font-family:inherit; white-space:nowrap;
    }
    .pb-bubble-btn:hover { background:rgba(130,100,255,0.5); color:#fff; }
    #pb-overlay {
      position:fixed; inset:0; background:rgba(0,0,0,0.55);
      backdrop-filter:blur(4px); z-index:2147483645;
      display:none; opacity:0; transition:opacity .22s;
    }
    #pb-settings {
      position:fixed; width:620px; min-width:380px; max-width:95vw;
      height:540px; min-height:320px; max-height:90vh;
      background:rgba(14,14,22,0.97); backdrop-filter:blur(24px) saturate(180%);
      border:1px solid rgba(255,255,255,0.1); border-radius:16px;
      box-shadow:0 32px 100px rgba(0,0,0,0.8),0 0 0 1px rgba(255,255,255,0.05);
      z-index:2147483646; display:none; flex-direction:column;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:13px; color:#d0d0e8; transition:opacity .22s,transform .22s;
      overflow:hidden; resize:both; box-sizing:border-box;
    }
    .pb-header {
      display:flex; align-items:center; gap:10px;
      padding:12px 14px; border-bottom:1px solid rgba(255,255,255,0.07);
      cursor:move; user-select:none; flex-shrink:0; background:rgba(255,255,255,0.02);
    }
    .pb-title { font-size:14px; font-weight:600; color:#e8e8ff; white-space:nowrap; }
    #pb-search {
      flex:1; background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.1);
      border-radius:8px; padding:5px 10px; color:#e0e0f0; font-size:12px;
      outline:none; cursor:text; min-width:0;
    }
    #pb-search::placeholder { color:rgba(255,255,255,0.3); }
    #pb-search:focus { border-color:rgba(130,100,255,0.5); background:rgba(255,255,255,0.1); }
    .pb-close-btn {
      background:none; border:none; color:rgba(255,255,255,0.45);
      font-size:16px; cursor:pointer; padding:4px 8px; border-radius:6px; line-height:1;
      flex-shrink:0; transition:all .15s;
    }
    .pb-close-btn:hover { background:rgba(255,60,60,0.2); color:#ff6060; }
    .pb-tab-bar {
      display:flex; gap:2px; padding:8px 12px 0;
      border-bottom:1px solid rgba(255,255,255,0.06); flex-shrink:0;
      overflow-x:auto; scrollbar-width:none;
    }
    .pb-tab-bar::-webkit-scrollbar { display:none; }
    .pb-tab {
      background:none; border:none; color:rgba(255,255,255,0.42);
      padding:6px 12px; border-radius:8px 8px 0 0; cursor:pointer;
      font-size:12px; white-space:nowrap; transition:all .15s; font-family:inherit;
    }
    .pb-tab:hover { background:rgba(255,255,255,0.07); color:rgba(255,255,255,0.8); }
    .pb-tab.active { background:rgba(130,100,255,0.18); color:#a584ff; font-weight:600; }
    .pb-body { flex:1; overflow:hidden; position:relative; }
    .pb-panel {
      display:none; height:100%; overflow-y:auto; padding:14px 16px 16px;
      box-sizing:border-box; scrollbar-width:thin;
      scrollbar-color:rgba(255,255,255,0.14) transparent;
    }
    .pb-panel.active { display:block; }
    .pb-panel::-webkit-scrollbar { width:5px; }
    .pb-panel::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.14); border-radius:3px; }
    .pb-section-title {
      font-size:10px; font-weight:700; letter-spacing:.1em; color:rgba(255,255,255,0.32);
      text-transform:uppercase; margin:16px 0 8px; padding-bottom:5px;
      border-bottom:1px solid rgba(255,255,255,0.06);
    }
    .pb-panel>.pb-section-title:first-child { margin-top:0; }
    .pb-row {
      display:flex; align-items:center; justify-content:space-between;
      gap:12px; padding:9px 0; border-bottom:1px solid rgba(255,255,255,0.04);
    }
    .pb-row:last-child { border-bottom:none; }
    .pb-row-info { flex:1; min-width:0; }
    .pb-row-label { display:block; font-size:13px; color:#d8d8f0; }
    .pb-row-desc  { display:block; font-size:11px; color:rgba(255,255,255,0.36); margin-top:2px; }
    .pb-row-ctrl  { flex-shrink:0; }
    .pb-switch { display:inline-flex; cursor:pointer; position:relative; }
    .pb-switch input { opacity:0; width:0; height:0; position:absolute; }
    .pb-knob {
      display:inline-block; width:40px; height:22px;
      background:rgba(255,255,255,0.14); border-radius:11px;
      position:relative; transition:background .2s;
    }
    .pb-knob::after {
      content:''; position:absolute; top:3px; left:3px;
      width:16px; height:16px; border-radius:50%;
      background:#fff; transition:transform .2s; box-shadow:0 1px 4px rgba(0,0,0,0.3);
    }
    .pb-switch input:checked + .pb-knob { background:#7864ff; }
    .pb-switch input:checked + .pb-knob::after { transform:translateX(18px); }
    .pb-text-input,.pb-num-input {
      background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.1);
      border-radius:8px; padding:6px 10px; color:#e0e0f0; font-size:12px;
      outline:none; box-sizing:border-box; font-family:inherit;
    }
    .pb-text-input { width:160px; }
    .pb-num-input  { width:82px; }
    .pb-text-input:focus,.pb-num-input:focus { border-color:rgba(130,100,255,0.5); }
    .pb-range-wrap { display:flex; align-items:center; gap:8px; }
    input[type=range].pb-range {
      -webkit-appearance:none; appearance:none; width:130px; height:4px;
      border-radius:2px; background:rgba(255,255,255,0.14); outline:none; cursor:pointer;
    }
    input[type=range].pb-range::-webkit-slider-thumb {
      -webkit-appearance:none; width:16px; height:16px; border-radius:50%;
      background:#7864ff; cursor:pointer; box-shadow:0 1px 6px rgba(120,100,255,0.6);
    }
    .pb-range-val { font-size:12px; color:#a584ff; min-width:42px; text-align:right; }
    .pb-textarea {
      width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
      border-radius:8px; padding:8px 10px; color:#e0e0f0; font-size:12px;
      font-family:inherit; resize:vertical; outline:none; box-sizing:border-box; margin-top:6px;
    }
    .pb-textarea:focus { border-color:rgba(130,100,255,0.5); }
    .pb-ta-wrap { margin-bottom:4px; }
    .pb-action-btn {
      background:rgba(130,100,255,0.18); border:1px solid rgba(130,100,255,0.3);
      border-radius:8px; padding:6px 14px; color:#a584ff; font-size:12px;
      cursor:pointer; transition:all .15s; white-space:nowrap; font-family:inherit;
    }
    .pb-action-btn:hover { background:rgba(130,100,255,0.34); color:#c0a8ff; }
    .pb-action-btn.danger {
      background:rgba(255,70,70,0.14); border-color:rgba(255,70,70,0.3); color:#ff8080;
    }
    .pb-action-btn.danger:hover { background:rgba(255,70,70,0.3); }
    .pb-action-btn.secondary {
      background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.14); color:rgba(255,255,255,0.55);
    }
    .pb-action-btn.secondary:hover { background:rgba(255,255,255,0.12); color:rgba(255,255,255,0.8); }
    .pb-btn-row { display:flex; gap:8px; flex-wrap:wrap; padding:8px 0 4px; }
    .pb-select {
      background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.1);
      border-radius:8px; padding:6px 10px; color:#e0e0f0; font-size:12px;
      outline:none; font-family:inherit; cursor:pointer;
    }
    .pb-select option { background:#1a1a2e; }
    .pb-shortcut-input {
      background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.1);
      border-radius:8px; padding:6px 14px; color:#e0e0f0; font-size:12px;
      cursor:pointer; outline:none; min-width:130px; text-align:center;
      font-family:inherit; font-weight:600;
    }
    .pb-shortcut-input:focus { border-color:rgba(130,100,255,0.5); background:rgba(130,100,255,0.12); }
    #pb-toast {
      position:absolute; bottom:14px; right:16px;
      background:rgba(70,200,90,0.18); border:1px solid rgba(70,200,90,0.32);
      border-radius:8px; padding:6px 14px; color:#80e890; font-size:12px;
      opacity:0; transition:opacity .25s; pointer-events:none; z-index:1;
    }
    #pb-toast.pb-toast--show { opacity:1; }
    .pb-about-logo  { font-size:52px; text-align:center; margin:20px 0 10px; }
    .pb-about-title { text-align:center; font-size:20px; font-weight:700; color:#e8e8ff; margin-bottom:4px; }
    .pb-about-ver   { text-align:center; font-size:12px; color:rgba(255,255,255,0.38); margin-bottom:28px; }
    .pb-about-desc  { text-align:center; font-size:13px; color:rgba(255,255,255,0.55); line-height:1.7; }
  `;

  class PixelBuddy {
    constructor() {
      this._s     = StorageManager.load();
      this._water = new WaterTracker();
      this._msg   = new MessageManager(this._s);
      this._anim  = null; this._bubble = null; this._remind = null;
      this._panel = null; this._scH = null;
    }

    init() {
      this._buildDOM();
      const imgEl    = document.getElementById('pb-gif');
      const bubbleEl = document.getElementById('pb-bubble');
      this._anim   = new AnimationManager(this._s, imgEl);
      this._bubble = new SpeechBubbleManager(bubbleEl);
      this._panel  = new SettingsPanel(this._s, (s,a)=>this._onSave(s,a));
      this._applyAppearance(this._s);
      this._registerShortcut();

      // Pet is always hidden on load — Alt+V summons it
      document.getElementById('pb-pet').style.display = 'none';

      if (!this._s.general.enabled) return;

      this._remind = new ReminderManager(()=>this._doGreeting(), ()=>this._doDrink());
      this._remind.start(this._s);

      // showOnStartup: show pet immediately if user opted in
      if (this._s.behaviour.showOnStartup) {
        setTimeout(()=>this._doGreeting(), 500);
      }
    }

    _buildDOM() {
      const pet = document.createElement('div');
      pet.id = 'pb-pet';
      pet.innerHTML =
        '<div id="pb-bubble"></div>'+
        '<img id="pb-gif" alt="">';
      document.body.appendChild(pet);
      // Right-click anywhere on the pet opens settings
      pet.addEventListener('contextmenu', e=>{ e.preventDefault(); e.stopPropagation(); this._panel.open(); });
      this._injectStyles();
    }

    _doGreeting() {
      if (!this._s.general.enabled) return;
      const _pet = document.getElementById('pb-pet');
      if (_pet) _pet.style.display = 'flex';
      const key = this._anim.pickFromCategory('greeting');
      this._anim.play(key, this._s.timings.animationDuration, null);
      if (this._s.general.bubbleEnabled && this._s.messages.greetingEnabled) {
        setTimeout(()=>{
          this._bubble.show(this._msg.getGreetingMessage(), this._s.timings.bubbleDuration);
        }, 600);
      }
    }

    _doDrink() {
      if (!this._s.general.enabled) return;
      const _pet = document.getElementById('pb-pet');
      if (_pet) _pet.style.display = 'flex';
      this._water.increment();
      const key = this._anim.pickFromCategory('drink');
      this._anim.play(key, this._s.timings.animationDuration, null);
      if (this._s.general.bubbleEnabled && this._s.messages.drinkEnabled) {
        setTimeout(()=>{
          this._bubble.showWithActions(
            this._msg.getDrinkMessage(),
            this._s.timings.bubbleDuration,
            null,
            ()=>setTimeout(()=>this._doDrink(), 5*60*1000)
          );
        }, 600);
      }
    }

    _onSave(s, action) {
      if (action === 'reset-msg-history')   { this._msg.resetQueues(); return; }
      if (action === 'reset-anim-history')  { this._anim&&this._anim.resetQueues(); return; }
      if (action === 'reload')              { StorageManager.save(s); location.reload(); return; }
      if (action === 'preview-greeting')    { this._doGreeting(); return; }
      if (action === 'test-drink')          { this._doDrink(); return; }

      // Live save — keep panel open
      this._s = s;
      StorageManager.save(s);
      if (this._anim)   this._anim._s  = s;
      if (this._msg)    this._msg._s   = s;
      if (this._remind) this._remind.restart(s);
      this._applyAppearance(s);
      this._registerShortcut();

      const pet = document.getElementById('pb-pet');
      if (pet) pet.style.display = s.general.enabled ? 'flex' : 'none';

      // Start/stop reminders based on enabled state
      if (s.general.enabled && !this._remind) {
        this._remind = new ReminderManager(()=>this._doGreeting(), ()=>this._doDrink());
        this._remind.start(s);
      } else if (!s.general.enabled && this._remind) {
        this._remind.stop();
      }
    }

    _applyAppearance(s) {
      const pet = document.getElementById('pb-pet'); if (!pet) return;
      const img = document.getElementById('pb-gif');
      if (img) img.style.height = (s.appearance.petSize||160)+'px';
      pet.style.opacity = String(s.appearance.petOpacity||1);
      const [v,h] = (s.appearance.position||'bottom-right').split('-');
      pet.style.bottom = v==='bottom'?'10px':'auto';
      pet.style.top    = v==='top'   ?'20px':'auto';
      pet.style.right  = h==='right' ?'10px':'auto';
      pet.style.left   = h==='left'  ?'20px':'auto';
    }

    _registerShortcut() {
      if (this._scH) document.removeEventListener('keydown', this._scH);
      const raw = (this._s.general.shortcut||'Alt+V').toLowerCase();
      this._scH = e=>{
        const p=[];
        if(e.ctrlKey)  p.push('ctrl');
        if(e.altKey)   p.push('alt');
        if(e.shiftKey) p.push('shift');
        if(e.metaKey)  p.push('meta');
        p.push(e.key.toLowerCase());
        if(p.join('+')===raw){
          e.preventDefault();
          this._doGreeting();
        }
      };
      document.addEventListener('keydown', this._scH);
    }

    _injectStyles() {
      if (document.getElementById('pb-styles')) return;
      const st = document.createElement('style');
      st.id = 'pb-styles'; st.textContent = PB_CSS;
      document.head.appendChild(st);
    }
  }

  // Bootstrap
  window._pb = new PixelBuddy();
  window._pb.init();

})();
