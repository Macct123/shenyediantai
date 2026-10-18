/* ============================================================
   深夜电台 · Midnight Signal
   序章《空频》+ 基础引擎
   ============================================================ */
(function () {
  'use strict';

  var IMG_W = 1920;
  var IMG_H = 1080;

  /* ============================================================
     存储（统一前缀 mrs_）
     ============================================================ */
  var K = {
    progress: 'mrs_progress',
    muted: 'mrs_muted',
    tapes: 'mrs_tapes',
    help: 'mrs_help',
    ending: 'mrs_ending'
  };

  var Store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set: function (key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) { /* 隐私模式：静默降级 */ }
    }
  };

  /* ============================================================
     小工具
     ============================================================ */
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function isTouch() { return window.matchMedia('(hover: none)').matches; }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function div(cls) {
    var n = document.createElement('div');
    if (cls) n.className = cls;
    return n;
  }
  function p(cls, text) {
    var n = document.createElement('p');
    if (cls) n.className = cls;
    n.textContent = text || '';
    return n;
  }

  /* ============================================================
     随身物品
     ============================================================ */
  var ITEMS = {
    key: {
      name: '铜钥匙',
      note: '从铁栅下面吸上来的，齿口磨得很圆。',
      img: 'assets/items/key.png'
    },
    fuse: {
      name: '保险丝',
      note: '2A。玻璃管里的金属丝接好了。',
      img: 'assets/items/fuse.png'
    },
    piece: {
      name: '海图残片',
      note: '撕口和墙上那张海图正好对得上。',
      img: 'assets/items/piece.png'
    },
    wire: {
      name: '细铜线',
      note: '一小卷铜线，够绕一根保险丝。',
      img: 'assets/items/wire.png'
    },
    brokenFuse: {
      name: '断保险丝',
      note: '玻璃管发黑，金属丝断成两截。',
      img: 'assets/items/brokenFuse.png'
    },
    magnet: {
      name: '系绳磁铁',
      note: '马蹄形磁铁，拴着一截细绳。',
      img: 'assets/items/magnet.png'
    },
    ruler: {
      name: '平行尺',
      note: '铜边磨得发亮，刻度是海里。',
      img: 'assets/items/ruler.png'
    }
  };

  var COMBOS = {
    'brokenFuse+wire': { out: 'fuse', hint: '细铜丝绕回玻璃管里。保险丝接好了。' }
  };

  var Inv = {
    el: null,
    items: [],
    selected: null,

    init: function () {
      this.el = $('#inventory');
      if (!this.el) return;
      var self = this;
      this.el.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.inv-slot') : null;
        if (!btn) return;
        var id = btn.getAttribute('data-item');

        if (self.selected && self.selected !== id) {
          var combo = COMBOS[[self.selected, id].sort().join('+')];
          if (combo) {
            var a = self.selected;
            self.items = self.items.filter(function (x) { return x !== a && x !== id; });
            self.selected = null;
            self.add(combo.out);
            Audio.sfx('lock');
            Sub.hint(combo.hint, 3200);
            return;
          }
        }

        self.select(id);
      });
    },

    has: function (id) { return this.items.indexOf(id) >= 0; },

    add: function (id) {
      if (!ITEMS[id] || this.has(id)) return;
      this.items.push(id);
      this.selected = id;
      this.render();
    },

    consume: function (id) {
      var i = this.items.indexOf(id);
      if (i >= 0) this.items.splice(i, 1);
      if (this.selected === id) this.selected = null;
      this.render();
    },

    set: function (list) {
      this.items = (list || []).filter(function (id) { return !!ITEMS[id]; });
      this.selected = null;
      this.render();
    },

    select: function (id) {
      if (!id || !this.has(id)) { this.selected = null; this.render(); return; }
      this.selected = this.selected === id ? null : id;
      this.render();
      if (this.selected) Audio.sfx('paper');
    },

    clear: function () {
      this.items = [];
      this.selected = null;
      this.render();
    },

    render: function () {
      if (!this.el) return;
      this.el.innerHTML = '';
      var self = this;
      if (!this.items.length) {
        this.el.hidden = true;
        return;
      }
      this.el.hidden = false;
      this.items.forEach(function (id) {
        var item = ITEMS[id];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'inv-slot' + (self.selected === id ? ' is-selected' : '');
        btn.setAttribute('data-item', id);
        btn.setAttribute('aria-label', item.name + (self.selected === id ? '，已选中' : '，点击拿起'));
        btn.title = item.note;
        btn.innerHTML = '<img class="inv-img" src="' + item.img + '" alt="" draggable="false">' +
          '<span class="inv-name">' + item.name + '</span>';
        self.el.appendChild(btn);
      });

      var note = p('inv-note', self.selected
        ? ITEMS[self.selected].note
        : '选中物品，再点场景里的东西。');
      self.el.appendChild(note);
    }
  };

  /* ============================================================
     音频引擎
     ============================================================ */
  var Audio = {
    ctx: null,
    master: null,
    ambient: null,
    signalNode: null,
    unlocked: false,
    muted: !!Store.get(K.muted, false),

    init: function () {
      if (this.ctx) return this.ctx;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      var ctx = new AC();
      var master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.85;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      return ctx;
    },

    unlock: function () {
      var ctx = this.init();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (!this.unlocked) {
        this.unlocked = true;
        this.startAmbient();
      }
    },

    noiseBuffer: function (seconds, brown) {
      var ctx = this.ctx;
      var len = Math.floor(ctx.sampleRate * seconds);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = buf.getChannelData(0);
      var last = 0;
      for (var i = 0; i < len; i++) {
        var white = Math.random() * 2 - 1;
        if (brown) {
          last = (last + 0.02 * white) / 1.02;
          data[i] = last * 3.2;
        } else {
          data[i] = white;
        }
      }
      return buf;
    },

    // 程序化脉冲响应：给雨声加一层房间/雨幕混响，听感不再贴耳
    makeIR: function (seconds, decay) {
      var ctx = this.ctx;
      var len = Math.floor(ctx.sampleRate * seconds);
      var buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (var ch = 0; ch < 2; ch++) {
        var d = buf.getChannelData(ch);
        for (var i = 0; i < len; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
      }
      return buf;
    },

    startAmbient: function () {
      var ctx = this.ctx;
      if (!ctx || this.ambient) return;
      // 雨声直接由 <audio> 播放：不经过 Web Audio，Firefox 下最稳
      this.ambient = { out: null };

      var self = this;
      try {
        var rainEl = new window.Audio('assets/audio/rain-window.ogg');
        rainEl.loop = true;
        rainEl.preload = 'auto';
        rainEl.volume = 0.55;
        rainEl.muted = this.muted;
        self.rainEl = rainEl;

        var tryPlay = function () {
          if (!rainEl.paused) return;
          var p = rainEl.play();
          if (p && p.catch) p.catch(function () {});
        };
        self.resumeRain = tryPlay;

        ['loadeddata', 'canplay', 'canplaythrough'].forEach(function (ev) {
          rainEl.addEventListener(ev, tryPlay);
        });
        rainEl.addEventListener('error', function () { self.startBackupRain(); });

        tryPlay();

        // 兜底：2.5 秒还没播起来，就补一层程序化雨，避免整局无声
        setTimeout(function () {
          if (rainEl.paused || rainEl.readyState < 2) self.startBackupRain();
        }, 2500);
      } catch (e) {
        self.startBackupRain();
      }
    },

    /* 录音放不出来时的备用雨（正常情况不会响） */
    startBackupRain: function () {
      if (this.backupRain) return;
      var ctx = this.ctx;
      if (!ctx) return;
      if (!this.ambient) this.ambient = { out: null };
      if (!this.ambient.out) {
        var o = ctx.createGain();
        o.gain.value = 0.9;
        o.connect(this.master);
        this.ambient.out = o;
      }
      var src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(4, false);
      src.loop = true;
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 120;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      var g = ctx.createGain();
      g.gain.value = 0;
      src.connect(hp).connect(lp).connect(g).connect(this.ambient.out);
      src.start();
      g.gain.setTargetAtTime(0.28, ctx.currentTime, 1.0);
      this.backupRain = g;
    },

    resumeRain: function () {},

    // 调频时的信号音：越接近目标，正弦越清晰、静电越弱
    setSignal: function (strength) {
      var ctx = this.ctx;
      if (!ctx || !this.master) return;
      var t = ctx.currentTime;
      if (!this.signalNode) {
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 640;
        var g = ctx.createGain();
        g.gain.value = 0;
        osc.connect(g).connect(this.master);
        osc.start();
        this.signalNode = { osc: osc, out: g };
      }
      if (!this.staticNode) {
        var n = ctx.createBufferSource();
        n.buffer = this.noiseBuffer(3, false);
        n.loop = true;
        // 收音机静电：只留中频段，去掉刺耳的高频嘶声
        var hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 520;
        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3200;
        var ng = ctx.createGain();
        ng.gain.value = 0;
        n.connect(hp).connect(lp).connect(ng).connect(this.master);
        n.start();
        this.staticNode = { src: n, out: ng };
      }
      this.signalNode.out.gain.setTargetAtTime(strength * 0.042, t, 0.06);
      this.staticNode.out.gain.setTargetAtTime(0.03 - strength * 0.024, t, 0.08);
    },

    /* 特写关掉后把调频音收干净，避免静电一直挂在背景里 */
    releaseSignal: function () {
      var ctx = this.ctx;
      if (!ctx) return;
      var t = ctx.currentTime;
      if (this.signalNode) {
        this.signalNode.out.gain.cancelScheduledValues(t);
        this.signalNode.out.gain.setTargetAtTime(0.0001, t, 0.1);
      }
      if (this.staticNode) {
        this.staticNode.out.gain.cancelScheduledValues(t);
        this.staticNode.out.gain.setTargetAtTime(0.0001, t, 0.1);
      }
    },

    /* 雨声电平：直接调 <audio> 的音量 */
    setRainLevel: function (level) {
      if (this.rainEl) this.rainEl.volume = Math.max(0, Math.min(1, level * 2.4));
      if (this.backupRain && this.ctx) {
        this.backupRain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.8);
      }
    },

    setMuted: function (v) {
      this.muted = !!v;
      if (this.ctx && this.master) {
        var t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.85, t + 0.25);
      }
      if (this.rainEl) this.rainEl.muted = this.muted;
      if (this.muted) Voice.cancel();
      Store.set(K.muted, this.muted);
      UI.syncMute();
    },

    sfx: function (name) {
      var ctx = this.ctx;
      if (!ctx || this.muted) return;
      var t = ctx.currentTime;
      var bus = this.master;

      if (name === 'knob') {
        var n = ctx.createBufferSource();
        n.buffer = this.noiseBuffer(0.06, false);
        var f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1400;
        f.Q.value = 2.4;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.13, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
        n.connect(f).connect(g).connect(this.master);
        n.start(t);
        return;
      }

      if (name === 'lock') {
        [880, 1320].forEach(function (freq, i) {
          var osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          var gg = ctx.createGain();
          var st = t + i * 0.07;
          gg.gain.setValueAtTime(0.0001, st);
          gg.gain.exponentialRampToValueAtTime(0.09, st + 0.02);
          gg.gain.exponentialRampToValueAtTime(0.0001, st + 0.24);
          osc.connect(gg).connect(bus);
          osc.start(st);
          osc.stop(st + 0.26);
        });
        return;
      }

      if (name === 'open') {
        var o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(420, t);
        o.frequency.exponentialRampToValueAtTime(620, t + 0.16);
        var og = ctx.createGain();
        og.gain.setValueAtTime(0.001, t);
        og.gain.exponentialRampToValueAtTime(0.1, t + 0.03);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
        o.connect(og).connect(bus);
        o.start(t);
        o.stop(t + 0.26);
        return;
      }

      if (name === 'radio') {
        var rn = ctx.createBufferSource();
        rn.buffer = this.noiseBuffer(0.3, false);
        var rf = ctx.createBiquadFilter();
        rf.type = 'bandpass';
        rf.frequency.value = 1500;
        rf.Q.value = 0.8;
        var rg = ctx.createGain();
        rg.gain.setValueAtTime(0.0001, t);
        rg.gain.exponentialRampToValueAtTime(0.055, t + 0.02);
        rg.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
        rn.connect(rf).connect(rg).connect(this.master);
        rn.start(t);
        return;
      }

      if (name === 'switch') {
        var s = ctx.createOscillator();
        s.type = 'square';
        s.frequency.setValueAtTime(180, t);
        s.frequency.exponentialRampToValueAtTime(90, t + 0.1);
        var sg = ctx.createGain();
        sg.gain.setValueAtTime(0.06, t);
        sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        s.connect(sg).connect(this.master);
        s.start(t);
        s.stop(t + 0.16);
        return;
      }

      if (name === 'breaker') {
        // 合闸：宽频"咔" + 低频闷响 + 金属回弹，小喇叭也听得见
        var n1 = ctx.createBufferSource();
        n1.buffer = this.noiseBuffer(0.06, false);
        var f1 = ctx.createBiquadFilter();
        f1.type = 'bandpass';
        f1.frequency.value = 1400;
        f1.Q.value = 0.9;
        var g1 = ctx.createGain();
        g1.gain.setValueAtTime(0.17, t);
        g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        n1.connect(f1).connect(g1).connect(this.master);
        n1.start(t);

        var n2 = ctx.createBufferSource();
        n2.buffer = this.noiseBuffer(0.24, true);
        var f2 = ctx.createBiquadFilter();
        f2.type = 'lowpass';
        f2.frequency.setValueAtTime(480, t);
        f2.frequency.exponentialRampToValueAtTime(150, t + 0.22);
        var g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.exponentialRampToValueAtTime(0.24, t + 0.012);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
        n2.connect(f2).connect(g2).connect(this.master);
        n2.start(t);

        var bo = ctx.createOscillator();
        bo.type = 'triangle';
        bo.frequency.setValueAtTime(330, t);
        bo.frequency.exponentialRampToValueAtTime(180, t + 0.13);
        var og = ctx.createGain();
        og.gain.setValueAtTime(0.085, t);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        bo.connect(og).connect(this.master);
        bo.start(t);
        bo.stop(t + 0.2);
        return;
      }

      if (name === 'paper') {
        var pn = ctx.createBufferSource();
        pn.buffer = this.noiseBuffer(0.22, false);
        var pf = ctx.createBiquadFilter();
        pf.type = 'highpass';
        pf.frequency.value = 2200;
        var pg = ctx.createGain();
        pg.gain.setValueAtTime(0.0001, t);
        pg.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
        pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        pn.connect(pf).connect(pg).connect(this.master);
        pn.start(t);
        return;
      }

      if (name === 'drawer') {
        var dn = ctx.createBufferSource();
        dn.buffer = this.noiseBuffer(0.34, false);
        var df = ctx.createBiquadFilter();
        df.type = 'bandpass';
        df.frequency.setValueAtTime(260, t);
        df.frequency.linearRampToValueAtTime(420, t + 0.3);
        df.Q.value = 0.7;
        var dg = ctx.createGain();
        dg.gain.setValueAtTime(0.0001, t);
        dg.gain.exponentialRampToValueAtTime(0.07, t + 0.03);
        dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
        dn.connect(df).connect(dg).connect(this.master);
        dn.start(t);
        return;
      }

      var c = ctx.createOscillator();
      c.type = 'sine';
      c.frequency.setValueAtTime(760, t);
      var cg = ctx.createGain();
      cg.gain.setValueAtTime(0.07, t);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      c.connect(cg).connect(this.master);
      c.start(t);
      c.stop(t + 0.1);
    },

    /* 发射机通电：继电器咔哒 + 真空管低频嗡鸣 */
    powerOn: function () {
      var ctx = this.ctx;
      if (!ctx || this.muted) return;
      var t = ctx.currentTime;

      var n = ctx.createBufferSource();
      n.buffer = this.noiseBuffer(0.06, false);
      var nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 950;
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(0.13, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      n.connect(nf).connect(ng).connect(this.master);
      n.start(t);

      var bus = ctx.createGain();
      bus.gain.setValueAtTime(0.0001, t + 0.05);
      bus.gain.exponentialRampToValueAtTime(0.05, t + 0.7);
      bus.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      bus.connect(this.master);
      [50, 100, 151].forEach(function (f, i) {
        var o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        var og = ctx.createGain();
        og.gain.value = 0.5 / (i + 1);
        o.connect(og).connect(bus);
        o.start(t + 0.05);
        o.stop(t + 2.7);
      });
    }
  };

  /* ============================================================
     人声（TTS；静音时不发声，字幕照常）
     ============================================================ */
  /* ============================================================
     配音（预留位；把文件放进 assets/voice/ 后把 enabled 改成 true）
     ============================================================ */
  var Voice = {
    base: 'assets/voice/',
    enabled: true,
    cache: {},

    // 只有老周的台词有配音；旁白按你的要求不配
    VOICED: {
      call_02: 1, call_03: 1, call_04: 1, call_05: 1,
      beacon_03: 1, beacon_04: 1,
      music_01: 1, music_02: 1,
      news_01: 1, news_02: 1,
      n1_01: 1, n1_02: 1, n1_03: 1, n1_04: 1,
      n1_05: 1, n1_06: 1, n1_07: 1, n1_08: 1
    },

    // 优先 mp3（当前生成的格式），没有 mp3 再退回 wav
    EXTS: ['mp3', 'wav'],

    init: function () {},

    make: function (id) {
      var self = this;
      var a = new window.Audio();
      a.preload = 'auto';
      a.__want = false;
      // 再压一点音高和速度，让老周更显年纪
      a.playbackRate = 0.95;
      if ('preservesPitch' in a) a.preservesPitch = false;
      else if ('mozPreservesPitch' in a) a.mozPreservesPitch = false;
      var ei = 0;

      a.addEventListener('error', function () {
        if (ei >= self.EXTS.length - 1) return;
        ei += 1;
        a.src = self.base + id + '.' + self.EXTS[ei];
        a.load();
      });

      // 换源/加载完成后，如果这句还等着播，就补一次 play
      a.addEventListener('canplay', function () {
        if (!a.__want || !a.paused) return;
        var p = a.play();
        if (p && p.catch) p.catch(function () {});
      });
      a.addEventListener('playing', function () { a.__want = false; });

      a.src = this.base + id + '.' + this.EXTS[0];
      a.load();
      return a;
    },

    play: function (id) {
      if (!this.enabled || !id || Audio.muted) return;
      if (!this.VOICED[id]) return;

      var a = this.cache[id];
      if (!a) {
        a = this.make(id);
        this.cache[id] = a;
      }

      a.__want = true;
      try {
        a.currentTime = 0;
        var p = a.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    },

    /* 浏览器拦了自动播放时，任何一次点击都补一次 */
    resume: function () {
      var self = this;
      Object.keys(this.cache).forEach(function (k) {
        var a = self.cache[k];
        if (a.__want && a.paused) {
          var p = a.play();
          if (p && p.catch) p.catch(function () {});
        }
      });
    },

    cancel: function () {
      var self = this;
      Object.keys(this.cache).forEach(function (k) {
        var a = self.cache[k];
        a.__want = false;
        try { a.pause(); } catch (e) {}
      });
    }
  };
  /* ============================================================
     字幕 + 波形双通道
     ============================================================ */
  /* ============================================================
     对白：居中偏下，点击推进，逐字出现
     ============================================================ */
  var Sub = {
    box: null,
    speakerEl: null,
    textEl: null,
    nextEl: null,
    queue: [],
    done: null,
    typing: false,
    timer: 0,
    hintTimer: 0,
    hideTimer: 0,
    fullText: '',
    index: 0,

    init: function () {
      this.box = $('#dialogue');
      this.speakerEl = $('#dlgSpeaker');
      this.textEl = $('#dlgText');
      this.nextEl = $('#dlgNext');
      if (!this.box) return;

      var self = this;
      var stage = $('#stage');
      if (stage) {
        stage.addEventListener('click', function (e) {
          if (!self.box || self.box.hidden) return;
          var t = e.target;
          if (t.closest && (t.closest('#hotspots') || t.closest('.inventory'))) return;
          if (t.closest && (t.closest('.closeup-tools') || t.closest('button') || t.closest('input'))) return;
          e.stopPropagation();
          e.preventDefault();
          self.advance();
        }, true);
      }
      document.addEventListener('keydown', function (e) {
        if ((e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') &&
            self.box && !self.box.hidden && !UI.anyModalOpen()) {
          e.preventDefault();
          self.advance();
        }
      });
    },

    play: function (lines, done) {
      this.queue = (lines || []).slice();
      this.done = done || null;
      clearTimeout(this.hintTimer);
      this.next();
    },

    next: function () {
      var line = this.queue.shift();
      if (!line) {
        this.hide();
        var d = this.done;
        this.done = null;
        if (d) d();
        return;
      }
      this.show(line);
    },

    show: function (line) {
      if (!this.box) return;
      clearTimeout(this.hideTimer);
      this.box.hidden = false;
      var stage = document.getElementById('stage');
      if (stage) stage.classList.add('has-dialogue');
      requestAnimationFrame(function () { Sub.box.classList.add('is-on'); });

      if (line.who) {
        this.speakerEl.hidden = false;
        this.speakerEl.textContent = line.who;
      } else {
        this.speakerEl.hidden = true;
      }

      this.fullText = line.text || '';
      this.index = 0;
      this.typing = true;
      this.textEl.textContent = '';
      this.nextEl.classList.remove('is-ready');

      if (line.voice) {
        Voice.cancel();
        Voice.play(line.voice);
      }
      this.type();
    },

    type: function () {
      var self = this;
      clearTimeout(this.timer);
      if (this.index >= this.fullText.length) {
        this.typing = false;
        this.nextEl.classList.add('is-ready');
        return;
      }
      var ch = this.fullText.charAt(this.index++);
      this.textEl.textContent += ch;
      var wait = 34;
      if ('，。！？…、'.indexOf(ch) >= 0) wait = 150;
      this.timer = setTimeout(function () { self.type(); }, wait);
    },

    advance: function () {
      if (!this.box || this.box.hidden) return;
      if (this.typing) {
        clearTimeout(this.timer);
        this.textEl.textContent = this.fullText;
        this.index = this.fullText.length;
        this.typing = false;
        this.nextEl.classList.add('is-ready');
        return;
      }
      this.next();
    },

    hint: function (text, ms) {
      if (!this.box) return;
      this.queue = [];
      this.done = null;
      this.show({ text: text });
      clearTimeout(this.hintTimer);
      this.hintTimer = setTimeout(function () { Sub.hide(); }, ms || 3600);
    },

    hide: function () {
      if (!this.box) return;
      this.box.classList.remove('is-on');
      var stage = document.getElementById('stage');
      if (stage) stage.classList.remove('has-dialogue');
      var node = this.box;
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(function () {
        if (!node.classList.contains('is-on')) node.hidden = true;
      }, 280);
    },

    clear: function () {
      this.queue = [];
      this.done = null;
      clearTimeout(this.timer);
      clearTimeout(this.hintTimer);
      this.hide();
    },

    syncMuted: function () {},
    resize: function () {}
  };
  /* ============================================================
     视差
     ============================================================ */
  var Parallax = {
    AMP: 15,
    tx: 0, ty: 0, cx: 0, cy: 0,
    layers: [],

    init: function () {
      this.layers = $$('.layer');
      var stage = $('#stage');

      stage.addEventListener('pointermove', function (e) {
        var rect = stage.getBoundingClientRect();
        Parallax.tx = clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
        Parallax.ty = clamp(((e.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
      });

      stage.addEventListener('pointerleave', function () {
        Parallax.tx = 0;
        Parallax.ty = 0;
      });

      // 触屏：拖动时跟着手指走
      stage.addEventListener('touchmove', function (e) {
        if (!e.touches || !e.touches.length) return;
        var rect = stage.getBoundingClientRect();
        var t = e.touches[0];
        Parallax.tx = clamp(((t.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
        Parallax.ty = clamp(((t.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
      }, { passive: true });
    },

    tick: function (now) {
      var driftX = 0;
      var driftY = 0;
      // 触屏没有指针，用缓慢漂移保持纵深
      if (isTouch()) {
        driftX = Math.sin(now * 0.00013) * 0.55;
        driftY = Math.cos(now * 0.000095) * 0.4;
      }
      var targetX = reducedMotion() ? 0 : (this.tx + driftX);
      var targetY = reducedMotion() ? 0 : (this.ty + driftY);

      this.cx += (targetX - this.cx) * 0.05;
      this.cy += (targetY - this.cy) * 0.05;

      for (var i = 0; i < this.layers.length; i++) {
        var factor = parseFloat(this.layers[i].getAttribute('data-factor') || '1');
        var x = -this.cx * this.AMP * factor;
        var y = -this.cy * this.AMP * factor;
        this.layers[i].style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)';
      }
    }
  };

  /* ============================================================
     雨与雾（中层程序化）
     ============================================================ */
  var Fog = {
    canvas: null,
    ctx: null,
    drops: [],

    init: function () {
      this.canvas = $('#fog');
      this.ctx = this.canvas.getContext('2d');
      for (var i = 0; i < 44; i++) {
        this.drops.push({
          x: Math.random(),
          y: Math.random(),
          len: 0.04 + Math.random() * 0.11,
          speed: 0.13 + Math.random() * 0.38,
          a: 0.05 + Math.random() * 0.12
        });
      }
    },

    resize: function () {
      if (!this.canvas) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var rect = this.canvas.getBoundingClientRect();
      this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    draw: function (dt) {
      if (!this.ctx) return;
      var w = this.canvas.clientWidth;
      var h = this.canvas.clientHeight;
      if (!w || !h) return;
      var ctx = this.ctx;
      ctx.clearRect(0, 0, w, h);

      var g = ctx.createRadialGradient(w * 0.5, h * 0.72, 0, w * 0.5, h * 0.72, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(23, 50, 74, 0.2)');
      g.addColorStop(1, 'rgba(5, 8, 12, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      ctx.lineWidth = 1;
      for (var i = 0; i < this.drops.length; i++) {
        var d = this.drops[i];
        d.y += d.speed * (dt / 1000);
        if (d.y > 1.1) { d.y = -0.1; d.x = Math.random(); }
        var x = d.x * w;
        var y = d.y * h;
        ctx.strokeStyle = 'rgba(190, 214, 236, ' + d.a + ')';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 2, y + d.len * h);
        ctx.stroke();
      }
    }
  };

  /* ============================================================
     场景数据
     坐标为背景插画（1920×1080）的百分比，与 assets/studio.svg 对齐
     ============================================================ */
  var SCENES = {
    studio: {
      art: 'assets/studio.svg',
      night: '序章 · 空频',
      placeholder: 'radial-gradient(120% 96% at 50% 40%, #17324a 0%, #0d2136 44%, #05080c 100%)',
      lights: [
        { id: 'beacon', x: 65.9, y: 33.7 }
      ],
      hotspots: [
        {
          id: 'radio', label: '收音机', x: 54.7, y: 68.8,
          onOpen: function () { Pro.onRadioOpened(); },
          closeup: { title: '收 音 机', widget: 'tune', art: 'assets/closeups/radio.svg' }
        },
        {
          id: 'denoise', label: '降噪单元', x: 42.7, y: 69.4,
          closeup: { title: '降 噪 单 元', widget: 'denoise', art: 'assets/closeups/denoise.svg' }
        },
        {
          id: 'phone', label: '电话', x: 73.4, y: 69.0,
          closeup: { title: '电 话', widget: 'respond', art: 'assets/closeups/phone.svg' }
        },
        {
          id: 'chart', label: '墙上海图', x: 25.0, y: 31.9,
          closeup: {
            title: '海 图', widget: 'note', art: 'assets/closeups/chart.svg', textBaked: true,
            overlays: [
              { text: '旧频道  100.0', x: 55, y: 46, size: 26, rot: -4, cls: 'is-pencil' }
            ],
            note: '潮汐镇的海图，边角被潮气泡得发白。\n\n有一处礁石被红铅笔圈了两圈，旁边是旧频道栏，写着“100.0”。\n\n那一栏的字迹和前几栏不一样，像是后来补上去的。'
          }
        },
        {
          id: 'notebook', label: '前任主播的笔记', x: 34.1, y: 54.8,
          closeup: {
            title: '笔 记', widget: 'note', art: 'assets/closeups/note.svg', textBaked: true,
            overlays: [
              { text: '别在雾里关灯。', x: 28, y: 28, size: 26, rot: -2, cls: 'is-pencil' },
              { text: '他们认灯，不认声音。', x: 28, y: 37, size: 24, rot: -2, cls: 'is-pencil' },
              { text: '—— 没有名字', x: 30, y: 52, size: 18, rot: -2, cls: 'is-pencil' }
            ],
            note: '一张按在墙上的便条，纸已经卷边。\n\n“别在雾里关灯。”\n\n“他们认灯，不认声音。”\n\n落款只有一个日期，没有名字。'
          }
        },
        {
          id: 'plate', label: '收音机铭牌', x: 64.7, y: 70.1,
          closeup: {
            title: '铭 牌', widget: 'note', art: 'assets/closeups/plate.svg', textBaked: true,
            overlays: [
              { text: '潮汐镇广播电台 · 夜班机', x: 20, y: 34, size: 23, rot: -4, cls: 'is-engrave' },
              { text: '本机刻度已按新标准下调 6.3MHz', x: 20, y: 42, size: 17, rot: -4, cls: 'is-engrave' },
              { text: '旧频道请自行换算', x: 23, y: 48, size: 16, rot: -4, cls: 'is-engrave' }
            ],
            note: '巴掌大的金属铭牌，铆在机身上。\n\n“潮汐镇广播电台 · 夜班机”\n\n“本机刻度已按新标准下调 6.3MHz，旧频道请自行换算。”\n\n铭牌下沿被人用指甲刻了一道很深的痕。'
          }
        },
        {
          id: 'letter', label: '桌面信件', x: 62.0, y: 82.4,
          closeup: {
            title: '信 件', widget: 'note', art: 'assets/closeups/letter.svg', textBaked: true,
            overlays: [
              { text: '潮汐镇广播电台 · 夜班', x: 30, y: 60, size: 18, rot: -2, cls: 'is-pencil' }
            ],
            note: '信封没有寄件人，只在角落写着“潮汐镇广播电台 夜班”。\n\n里面是空的。\n\n你把它翻过来，背面有一行铅笔字，很轻：\n\n“灯要亮着，他们才找得到岸。”'
          }
        },
        {
          id: 'cabinet', label: '设备柜', x: 82.0, y: 50.9,
          closeup: {
            title: '设 备 柜', widget: 'manual', art: 'assets/closeups/cabinet.svg'
          }
        }
      ]
    },

    /* 第 1 夜《信号》：三个可以来回走的房间 */
    night1: {
      night: '第 1 夜 · 信号',
      start: 'studio',
      areas: {
        studio: {
          room: '播 音 室',
          art: 'assets/studio.svg',
          lights: [{ id: 'beacon', x: 65.9, y: 33.7 }],
          hotspots: [
            {
              id: 'radio', label: '收音机', x: 54.7, y: 68.8,
              closeup: {
                title: '收 音 机', widget: 'radioCode', art: 'assets/closeups/radio.svg',
                props: function () {
                  return {
                    dead: !Night1.powered,
                    hasFuse: Inv.has('fuse'),
                    hasBroken: Inv.has('brokenFuse'),
                    onPower: function () { Night1.installFuse(); },
                    solved: Night1.tuned,
                    target: '964',
                    onSolved: function () { Night1.onTuned(); }
                  };
                }
              }
            },
            {
              id: 'chart', label: '墙上海图', x: 25.0, y: 31.9,
              gate: function () { return Night1.tuned; },
              gateHint: '先调准他的频率，才知道他在哪。',
              closeup: {
                title: '海 图', widget: 'chart', art: 'assets/closeups/chart.svg', textBaked: true,
                props: function () {
                  return {
                    brief: Night1.chartPiece ? '把度分换成小数，再点在海图上。' : '海图的右下角被撕掉了一块。',
                    note: '1° = 60′。细格 0.01°，粗格 0.1°。\n\n三号浮标外侧是暗礁。',
                    torn: !Night1.chartPiece,
                    hasPiece: Inv.has('piece'),
                    onPiece: function () { Night1.placePiece(); },
                    solved: Night1.located,
                    answer: { lat: 34.20, lon: 129.12 },
                    hasRuler: Inv.has('ruler'),
                    measured: Night1.measured,
                    measureAt: Night1.TRUE_BEARING,
                    onMeasure: function (deg) { Night1.onMeasured(deg); },
                    onSolved: function () { Night1.onLocated(); }
                  };
                }
              }
            },
            {
              id: 'calib', label: '校准记录', x: 64.7, y: 70.1,
              closeup: {
                title: '校 准 记 录', widget: 'note', art: 'assets/closeups/calib.svg',
                note: '一张机务卡片，压在收音机下面。\n\n旧频道 100.0 → 新刻度 93.7\n旧频道 101.5 → 新刻度 95.2\n\n下面没有写换算方法。'
              }
            },
            {
              id: 'magnet', label: '系绳磁铁', x: 77.5, y: 42.5,
              visible: function () { return !Night1.magnetTaken; },
              take: {
                id: 'magnet', name: '系绳磁铁',
                after: function () { Night1.magnetTaken = true; Night1.sync(); }
              }
            },
            {
              id: 'notebook', label: '值班便条', x: 34.1, y: 54.8,
              closeup: {
                title: '便 条', widget: 'note', art: 'assets/closeups/note.svg', textBaked: true,
                note: '“雾夜里，先把声音抓住，再谈方向。”\n\n“度分换小数：1° = 60′。”\n\n“海图右下角被撕走过一次，别信缺的那一块。”'
              }
            },
            {
              id: 'ruler', label: '平行尺', x: 45.5, y: 78.5,
              visible: function () { return !Night1.rulerTaken; },
              take: {
                id: 'ruler', name: '平行尺',
                after: function () { Night1.rulerTaken = true; Night1.sync(); }
              }
            }
          ],
          exits: [
            { to: 'corridor', dir: 'right', label: '走 廊' }
          ]
        },

        corridor: {
          room: '走 廊',
          art: 'assets/corridor.svg',
          lights: [{ id: 'bulb', x: 52, y: 16 }],
          hotspots: [
            {
              id: 'boots', label: '雨靴与铁栅', x: 16, y: 80,
              visible: function () { return !Night1.keyTaken; },
              use: {
                item: 'magnet',
                then: function () { Night1.takeKey(); }
              },
              action: function () {
                Sub.hint('靴底压着一道铁栅。下面有金属在反光，手够不着。', 3200);
              }
            },
            {
              id: 'locker', label: '储物柜', x: 70, y: 44,
              use: {
                item: 'key',
                then: function (btn, hs) {
                  Night1.unlockLocker();
                  Scene.open(hs, btn);
                }
              },
              action: function (btn, hs) {
                if (!Night1.lockerOpen) {
                  Audio.sfx('switch');
                  Sub.hint('柜门锁着。锁孔里有锈。', 2400);
                  return;
                }
                Scene.open(hs, btn);
              },
              closeup: {
                title: '储 物 柜', widget: 'locker', art: 'assets/closeups/cabinet.svg',
                props: function () {
                  return {
                    fuseTaken: Night1.fuseTaken,
                    wireTaken: Night1.wireTaken,
                    pieceTaken: Night1.pieceTaken,
                    logRead: Night1.logRead,
                    logText: '夜班频率表（旧刻度）：F-7 102.7；W-2 105.2；T-4 101.9。\n附注：F 渔业协会，W 气象台，T 潮汐站。',
                    onFuse: function () { Night1.takeFuse(); },
                    onWire: function () { Night1.takeWire(); },
                    onPiece: function () { Night1.takePiece(); },
                    onLog: function () { Night1.readLog(); }
                  };
                }
              }
            },
            {
              id: 'fusebox', label: '保险丝盒', x: 44, y: 26,
              closeup: {
                title: '保 险 丝 盒', widget: 'note', art: 'assets/closeups/fusebox.svg',
                note: '四个槽位：总闸、照明、发射机、备用。\n\n备用槽是空的。槽底贴着一张小纸片：\n\n“2A。别拿 5A 顶。”'
              }
            },
            {
              id: 'almanac', label: '航海年鉴', x: 27, y: 44,
              closeup: {
                title: '航 海 年 鉴', widget: 'note', art: 'assets/closeups/almanac.svg',
                note: '《潮汐镇航海年鉴》摘录：\n\n去年校正：真方位 190°，磁方位 196°。\n\n今年的磁差与去年相同。\n\n（真北在磁北以东。）'
              }
            },
            {
              id: 'logbook', label: '值班日志', x: 58, y: 74,
              closeup: {
                title: '值 班 日 志', widget: 'note', art: 'assets/closeups/ledger.svg',
                note: '夜班频率表（旧刻度）：\n\nF-7 …… 102.7\nW-2 …… 105.2\nT-4 …… 101.9\n\n附注：F 渔业协会，W 气象台，T 潮汐站。\n\n下面一行被水泡开了，只剩“本机已改新刻度”。'
              }
            }
          ],
          exits: [
            { to: 'studio', dir: 'left', label: '播 音 室' },
            { to: 'tower', dir: 'right', label: '天 线 梯' }
          ]
        },

        tower: {
          room: '天 线 平 台',
          art: 'assets/tower.svg',
          lights: [{ id: 'beacon', x: 78, y: 28 }],
          hotspots: [
            {
              id: 'antenna', label: '天线旋转器', x: 46, y: 62,
              gate: function () { return Night1.measured; },
              gateHint: '先在海图上量出真方位。',
              closeup: {
                title: '天 线 旋 转 器', widget: 'rotator', art: 'assets/closeups/cabinet.svg',
                props: function () {
                  return {
                    dead: !Night1.powered,
                    target: Night1.TARGET_BEARING,
                    tol: 0,
                    solved: Night1.fixed,
                    coarse: Night1.coarse,
                    fine: Night1.fine,
                    onSolved: function (c, f) { Night1.onFixed(c + f, c, f); }
                  };
                }
              }
            },
            {
              id: 'beacon', label: '灯塔', x: 78, y: 28,
              action: function () {
                Sub.hint(Night1.fixed ? '灯已经扫过去了。' : '灯罩里是暗的。天线对上之前，它不会亮。', 3000);
              }
            }
          ],
          exits: [
            { to: 'corridor', dir: 'down', label: '下 楼' }
          ]
        }
      }
    }
  };

  /* ============================================================
     序章状态机
     ============================================================ */
  var Pro = {
    step: 'explore',          // explore | tune | denoise | call | respond | tape
    tuned: false,
    denoised: false,
    used: {},                 // 已用过的回应方式
    finished: false,
    timers: [],
    introDone: false,

    OBJECTIVES: {
      explore: '先把这间屋子认一遍。',
      tune: '好像还有人在说话。',
      denoise: '听不清。把信号降下来。',
      call: '听他把话说完。',
      respond: '回应他。',
      tape: '今晚到此为止。'
    },

    reset: function () {
      this.step = 'explore';
      this.tuned = false;
      this.denoised = false;
      this.used = {};
      this.finished = false;
      this.introDone = false;
      this.clearTimers();
    },

    restore: function (saved) {
      if (!saved) { this.reset(); return; }
      this.step = saved.step || 'explore';
      this.tuned = !!saved.tuned;
      this.denoised = !!saved.denoised;
      this.used = saved.used || {};
      this.finished = !!saved.finished;
      this.introDone = true;
      this.clearTimers();
    },

    snapshot: function () {
      return {
        step: this.step,
        tuned: this.tuned,
        denoised: this.denoised,
        used: this.used,
        finished: this.finished
      };
    },

    clearTimers: function () {
      this.timers.forEach(clearTimeout);
      this.timers = [];
    },

    push: function (fn, ms) {
      this.timers.push(setTimeout(fn, ms));
    },

    sync: function () {
      Scene.setObjective(this.OBJECTIVES[this.step] || '');
      Scene.setActive('phone', this.step === 'respond');
      var tapesCount = Store.get(K.tapes, []).length;
      var tapesEl = document.getElementById('infoTapes');
      if (tapesEl) tapesEl.textContent = '收录 ' + tapesCount + ' 盘';
      // 通话中：雨声压低，给中频让位
      var talking = this.step === 'call' || this.step === 'respond';
      Audio.setRainLevel(talking ? 0.18 : 0.3);
      Game.save();
    },

    setStep: function (step) {
      this.step = step;
      this.sync();
    },

    /* ---------- 剧情播放 ---------- */
    run: function (lines, onDone) {
      this.clearTimers();
      Sub.play(lines, onDone);
    },

    /* ---------- 各环节 ---------- */
    onRadioOpened: function () {
      if (this.step === 'explore') this.setStep('tune');
    },

    onTuned: function () {
      if (this.tuned) return;
      this.tuned = true;
      this.setStep('denoise');
      Audio.sfx('lock');
      var self = this;
      this.run([
        { who: '', text: '信号咬住了。93.7MHz。', voice: 'tune_01' },
        { who: '', text: '这个频道空了二十年。', voice: 'tune_02' },
        { who: '', text: '静电后面有人，声音很轻，像被雨压住。', voice: 'tune_03' }
      ], function () {
        Sub.hint('降噪单元在左手边。', 3200);
        self.sync();
      });
    },

    onDenoiseTried: function (ok) {
      if (this.denoised) return;
      if (!ok) {
        Sub.hint('你把噪声降到了最低。可那头什么都没有。', 3200);
        return;
      }
      if (!this.tuned) {
        Sub.hint('你把噪声降到了最低。可那头什么都没有。', 3200);
        return;
      }
      this.denoised = true;
      this.setStep('call');
      Audio.sfx('switch');
      this.playCall();
    },

    playCall: function () {
      var self = this;
      this.run([
        { who: '', text: '噪声退开，像潮水退走。', voice: 'call_01' },
        { who: '老周', text: '……喂？还有人守着吗。', voice: 'call_02' },
        { who: '老周', text: '我是老周。最后一班渡轮的船长。', voice: 'call_03' },
        { who: '老周', text: '雾太厚了。我什么都看不见。', voice: 'call_04' },
        { who: '老周', text: '能不能……把航道灯给我点亮。', voice: 'call_05' },
        { who: '', text: '他的声音弱下去，只剩潮水。', voice: 'call_06' }
      ], function () {
        self.setStep('respond');
        Sub.hint('电话的指示灯在闪。', 2800);
      });
    },

    answer: function (id) {
      if (this.step !== 'respond' || this.used[id]) return;

      if (id === 'beacon') {
        this.used[id] = true;
        this.setStep('tape');
        Scene.setLight('beacon', true);
        Audio.sfx('breaker');
        this.run([
          { who: '', text: '你按下航道灯的总闸。', voice: 'beacon_01' },
          { who: '', text: '远处，灯塔亮起来。', voice: 'beacon_02' },
          { who: '老周', text: '……看见了。我看见了。', voice: 'beacon_03' },
          { who: '老周', text: '谢谢你。这一班，我靠岸了。', voice: 'beacon_04' },
          { who: '', text: '通话断了。电流声爬回来，慢慢退成雨。', voice: 'beacon_05' },
          { who: '', text: '你把这一夜收进柜子。', voice: 'beacon_06' },
          { who: '', text: '柜子最上面一格，多了一盘没有标签的磁带。', voice: 'beacon_07' },
          { who: '', text: '你不记得自己录过它。', voice: 'beacon_08' }
        ], function () {
          Pro.finish();
        });

        // 让玩家看见远处那盏灯亮起来
        this.push(function () {
          if (Scene.isOpen()) Scene.close();
        }, 1600);
        return;
      }

      this.used[id] = true;
      Audio.sfx('click');

      if (id === 'music') {
        this.run([
          { who: '老周', text: '不是这首。', voice: 'music_01' },
          { who: '老周', text: '……她不爱这首。', voice: 'music_02' },
          { who: '', text: '你重新把信号稳住。他还在那头。', voice: 'music_03' }
        ], function () {
          Sub.hint('电话的指示灯还在闪。', 2800);
        });
        return;
      }

      this.run([
        { who: '老周', text: '今晚不听新闻了。', voice: 'news_01' },
        { who: '老周', text: '海里的事，新闻说不清。', voice: 'news_02' },
        { who: '', text: '你重新把信号稳住。他还在那头。', voice: 'news_03' }
      ], function () {
        Sub.hint('电话的指示灯还在闪。', 2800);
      });
    },

    finish: function () {
      this.finished = true;
      this.step = 'tape';
      this.sync();

      var tapes = Store.get(K.tapes, []);
      var hasMain = tapes.some(function (t) { return t.id === 'prologue'; });
      if (!hasMain) {
        tapes.push({ id: 'prologue', title: '序章 · 空频', night: '老周 · 最后一班渡轮' });
        tapes.push({ id: 'unknown', title: '（没有标签）', night: '来源不明' });
        Store.set(K.tapes, tapes);
      }

      var progress = Store.get(K.progress, {}) || {};
      progress.night = '序章 · 空频';
      progress.prologue = this.snapshot();
      progress.chapter = 'night1';
      progress.done = progress.done || [];
      if (progress.done.indexOf('prologue') < 0) progress.done.push('prologue');
      progress.at = Date.now();
      Store.set(K.progress, progress);

      Game.refreshEntry();
    }
  };

  /* ============================================================
     第 1 夜《信号》状态机
     调频 → 海图定位 → 天线校准 → 收录
     ============================================================ */
  var Night1 = {
    step: 'power',          // power | tune | locate | antenna | done
    powered: false,
    tuned: false,
    chartPiece: false,
    located: false,
    measured: false,
    fixed: false,
    finished: false,
    bearing: 180,
    coarse: 180,
    fine: 0,
    area: 'studio',

    keyTaken: false,
    magnetTaken: false,
    lockerOpen: false,
    fuseTaken: false,
    wireTaken: false,
    pieceTaken: false,
    rulerTaken: false,
    logRead: false,

    TARGET: 96.4,
    TRUE_BEARING: 218,
    DECL: 6,
    TARGET_BEARING: 224,

    reset: function () {
      this.step = 'power';
      this.powered = false;
      this.tuned = false;
      this.chartPiece = false;
      this.located = false;
      this.measured = false;
      this.fixed = false;
      this.finished = false;
      this.bearing = 180;
      this.coarse = 180;
      this.fine = 0;
      this.area = 'studio';

      this.keyTaken = false;
      this.magnetTaken = false;
      this.lockerOpen = false;
      this.fuseTaken = false;
      this.wireTaken = false;
      this.pieceTaken = false;
      this.rulerTaken = false;
      this.logRead = false;

      Inv.clear();
    },

    snapshot: function () {
      return {
        step: this.step,
        powered: this.powered,
        tuned: this.tuned,
        chartPiece: this.chartPiece,
        located: this.located,
        measured: this.measured,
        fixed: this.fixed,
        finished: this.finished,
        bearing: this.bearing,
        coarse: this.coarse,
        fine: this.fine,
        area: this.area,
        keyTaken: this.keyTaken,
        magnetTaken: this.magnetTaken,
        lockerOpen: this.lockerOpen,
        fuseTaken: this.fuseTaken,
        wireTaken: this.wireTaken,
        pieceTaken: this.pieceTaken,
        rulerTaken: this.rulerTaken,
        logRead: this.logRead,
        inv: Inv.items.slice()
      };
    },

    restore: function (data) {
      this.reset();
      if (!data) return;
      this.step = data.step || 'power';
      this.powered = !!data.powered;
      this.tuned = !!data.tuned;
      this.chartPiece = !!data.chartPiece;
      this.located = !!data.located;
      this.measured = !!data.measured;
      this.fixed = !!data.fixed;
      this.finished = !!data.finished;
      this.bearing = typeof data.bearing === 'number' ? data.bearing : 180;
      this.coarse = typeof data.coarse === 'number' ? data.coarse : 180;
      this.fine = typeof data.fine === 'number' ? data.fine : 0;
      this.area = data.area || 'studio';

      this.keyTaken = !!data.keyTaken;
      this.magnetTaken = !!data.magnetTaken;
      this.lockerOpen = !!data.lockerOpen;
      this.fuseTaken = !!data.fuseTaken;
      this.wireTaken = !!data.wireTaken;
      this.pieceTaken = !!data.pieceTaken;
      this.rulerTaken = !!data.rulerTaken;
      this.logRead = !!data.logRead;

      Inv.set(data.inv || []);
    },

    objective: function () {
      if (!this.powered) return '收音机是哑的。';
      if (!this.tuned) return '雾里有人在等一个频道。';
      if (!this.chartPiece) return '海图缺了一角。';
      if (!this.located) return '他在报坐标。';
      if (!this.measured) return '图上还没有方向。';
      if (!this.fixed) return '天线还没转过去。';
      return '方向已发出。';
    },

    sync: function () {
      if (Scene.current && Scene.current.areas && Scene.area) this.area = Scene.area;
      Scene.setObjective(this.objective());
      Scene.renderHotspots();
      Scene.setActive('radio', !this.tuned);
      Scene.setActive('chart', this.tuned && !this.located);
      Scene.setActive('antenna', this.located && this.measured && !this.fixed);
      this.save();
    },

    save: function () {
      var progress = Store.get(K.progress, {}) || {};
      progress.chapter = 'night1';
      progress.night = '第 1 夜 · 信号';
      progress.night1 = this.snapshot();
      progress.at = Date.now();
      Store.set(K.progress, progress);
    },

    /* 收音机：先装保险丝，才通得上电 */
    installFuse: function () {
      if (this.powered) return;
      this.powered = true;
      this.step = 'tune';
      Inv.consume('fuse');
      Audio.sfx('lock');
      this.sync();
      Sub.hint('电流声回来了。旋钮有点涩。', 3000);
    },

    /* 海图：把撕掉的一角拼回去 */
    placePiece: function () {
      if (this.chartPiece) return;
      this.chartPiece = true;
      Inv.consume('piece');
      Audio.sfx('paper');
      this.sync();
      Sub.hint('撕口对上了。右下角的浮标露了出来。', 3200);
    },

    unlockLocker: function () {
      if (this.lockerOpen) return;
      this.lockerOpen = true;
      Audio.sfx('lock');
      this.sync();
    },

    takeFuse: function () {
      if (this.fuseTaken) return;
      this.fuseTaken = true;
      Inv.add('brokenFuse');
      Audio.sfx('paper');
      this.sync();
    },

    takeWire: function () {
      if (this.wireTaken) return;
      this.wireTaken = true;
      Inv.add('wire');
      Audio.sfx('paper');
      this.sync();
      if (this.fuseTaken) Sub.hint('铜线绕得进那根烧断的玻璃管。', 3400);
    },

    takeKey: function () {
      if (this.keyTaken) return;
      this.keyTaken = true;
      Inv.add('key');
      Audio.sfx('lock');
      this.sync();
      Sub.hint('磁铁吸上来一把铜钥匙，全是泥。', 3000);
    },

    takePiece: function () {
      if (this.pieceTaken) return;
      this.pieceTaken = true;
      Inv.add('piece');
      Audio.sfx('paper');
      this.sync();
    },

    readLog: function () {
      this.logRead = true;
      Audio.sfx('paper');
      this.sync();
    },

    onTuned: function () {
      if (this.tuned) return;
      this.tuned = true;
      this.step = 'locate';
      this.sync();

      Sub.play([
        { who: '渔夫', text: '……喂？喂！有人吗？', voice: 'n1_01' },
        { who: '渔夫', text: '我的罗盘坏了。雾太厚，我什么都看不见。', voice: 'n1_02' },
        { who: '渔夫', text: '我是七号渔协的，船号零三。', voice: 'n1_06' },
        { who: '渔夫', text: '我在北纬三十四度十二分，东经一百二十九度零七分。', voice: 'n1_03' },
        { who: '渔夫', text: '船上还有人。求你，给我指个方向。', voice: 'n1_04' }
      ], function () {
        Sub.hint('海图上印的是十进制度。1° = 60′。', 4200);
      });
    },

    onLocated: function () {
      if (this.located) return;
      this.located = true;
      this.step = 'antenna';
      this.sync();

      var self = this;
      Sub.play([
        { who: '渔夫', text: '对，就是那儿。三号浮标，我看见了。', voice: 'n1_05' }
      ], function () {
        Sub.hint(self.measured ? '真方位 218°。别忘了磁差。' : '用桌上那把平行尺，量一下从电台到浮标的方位。', 4600);
      });
    },

    onMeasured: function (deg) {
      if (this.measured) return;
      this.measured = true;
      this.bearing = deg;
      this.sync();
      Audio.sfx('lock');
      Sub.hint('量出来是真方位 ' + Math.round(deg) + '°。磁差 6°W，自己换算。', 4400);
    },

    onFixed: function (b, c, f) {
      if (this.fixed) return;
      this.fixed = true;
      this.bearing = b;
      this.coarse = c;
      this.fine = f;
      this.step = 'done';
      this.sync();
      Scene.setLight('beacon', true);
      Audio.setSignal(0.08);

      var self = this;
      Sub.play([
        { who: '渔夫', text: '……有了。灯扫过来了。', voice: 'n1_07' },
        { who: '渔夫', text: '我看见防波堤了。谢谢你，守夜的。', voice: 'n1_08' }
      ], function () {
        self.finish();
      });
    },

    finish: function () {
      if (this.finished) return;
      this.finished = true;
      this.sync();

      var tapes = Store.get(K.tapes, []);
      var exists = tapes.some(function (t) { return t.id === 'night1'; });
      if (!exists) {
        tapes.push({ id: 'night1', title: '第 1 夜 · 信号', night: '渔夫 · 三号浮标' });
        Store.set(K.tapes, tapes);
      }

      Audio.sfx('open');
      this.save();
      Game.refreshEntry();
      Sub.hint('信号断了。海面上只剩雾。', 3800);
    }
  };

  /* ============================================================
     特写控件（谜题接入位）
     约定：(root, props) => { destroy() }
     ============================================================ */
  var WIDGETS = {
    note: function (root, props) {
      var wrap = div('tool-block');
      var note = p('tool-note', props.note || '');
      note.style.textAlign = 'left';
      wrap.appendChild(note);
      root.appendChild(wrap);
      return { destroy: function () {} };
    },

    /* ---------- 收音机：三位频率预置（算对了才通） ---------- */
    radioCode: function (root, props) {
      props = props || {};
      var solved = !!props.solved;
      var code = solved ? String(props.target || '964') : '';

      var wrap = div('tool-block');
      wrap.appendChild(p('tool-caption', '频 率 预 置 · 本 机 刻 度'));
      wrap.appendChild(p('chart-brief', props.dead ? '指示灯不亮。' : '按换算后的频率拨三位数字。'));

      if (props.dead) {
        var deadUnit = div('dead-unit');
        deadUnit.appendChild(p('dead-line', '指示灯不亮。'));
        var slot = div('fuse-slot');
        slot.appendChild(p('fuse-slot-label', 'FUSE · 2A'));
        if (props.hasFuse) slot.classList.add('is-ready');
        deadUnit.appendChild(slot);
        wrap.appendChild(deadUnit);

        var powerBtn = document.createElement('button');
        powerBtn.type = 'button';
        powerBtn.className = 'btn-amber';
        powerBtn.textContent = props.hasFuse ? '装入保险丝' : '缺少 2A 保险丝';
        powerBtn.disabled = !props.hasFuse;
        powerBtn.addEventListener('click', function () {
          if (!props.hasFuse) return;
          if (props.onPower) props.onPower();
          Scene.close();
        });
        wrap.appendChild(powerBtn);
        wrap.appendChild(p('tool-note', props.hasFuse
          ? '玻璃管卡进槽里，发出一点凉意。'
          : (props.hasBroken ? '旧玻璃管塞得进去，可里面的丝是断的。' : '保险丝座是空的。')));
        root.appendChild(wrap);
        return { destroy: function () {} };
      }

      var display = div('code-display');
      var digits = [];
      for (var i = 0; i < 3; i++) {
        var d = document.createElement('span');
        d.className = 'code-digit';
        d.textContent = '—';
        display.appendChild(d);
        digits.push(d);
        if (i === 1) {
          var dot = document.createElement('span');
          dot.className = 'code-dot';
          dot.textContent = '.';
          display.appendChild(dot);
        }
      }
      wrap.appendChild(display);

      var pad = div('keypad');
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '清', '0', '←'].forEach(function (label) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'key-btn' + (label === '清' || label === '←' ? ' is-util' : '');
        b.textContent = label;
        b.addEventListener('click', function () {
          if (solved) return;
          if (label === '清') code = '';
          else if (label === '←') code = code.slice(0, -1);
          else if (code.length < 3) code += label;
          Audio.sfx('knob');
          render();
        });
        pad.appendChild(b);
      });
      wrap.appendChild(pad);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-amber';
      btn.textContent = solved ? '已接通' : '接通频率';
      if (solved) btn.disabled = true;
      if (solved) btn.classList.add('is-done');
      wrap.appendChild(btn);

      var note = p('tool-note', solved ? '载波稳住了。' : '刻度盘上没有数字，只有这排按键。');
      note.style.textAlign = 'left';
      wrap.appendChild(note);

      function render() {
        for (var k = 0; k < 3; k++) {
          digits[k].textContent = code.charAt(k) || '—';
          digits[k].classList.toggle('is-set', !!code.charAt(k));
        }
        display.classList.remove('is-wrong');
      }

      btn.addEventListener('click', function () {
        if (solved) return;
        if (code.length < 3) { Sub.hint('三位都拨齐再接通。', 2200); return; }
        if (code === String(props.target)) {
          solved = true;
          btn.disabled = true;
          btn.textContent = '已接通';
          btn.classList.add('is-done');
          Audio.sfx('lock');
          render();
          if (props.onSolved) props.onSolved();
        } else {
          Audio.sfx('switch');
          display.classList.add('is-wrong');
          Sub.hint('只有静电。再算一遍。', 2600);
        }
      });

      render();
      root.appendChild(wrap);
      return { destroy: function () {} };
    },

    /* ---------- 调频 ---------- */
    tune: function (root, props) {
      props = props || {};
      var F_MIN = 88, F_MAX = 108, STEP = 0.2;
      var TARGET = props.target != null ? props.target : 93.7;
      var SIGMA = props.sigma != null ? props.sigma : 1.6;
      var LOCK_AT = props.lock != null ? props.lock : 0.40;
      var locked = props.locked != null ? props.locked : Pro.tuned;
      var startFreq = props.start != null ? props.start : (locked ? TARGET : 100);
      var onLocked = props.onLock || function () { Pro.onTuned(); };
      var captionText = props.caption || '调 频 · 88 — 108 MHz';

      /* 没通电：先装保险丝 */
      if (props.dead) {
        var deadWrap = div('tool-block');
        deadWrap.appendChild(p('tool-caption', captionText));
        var deadUnit = div('dead-unit');
        deadUnit.appendChild(p('dead-line', '指示灯不亮。'));
        var slot = div('fuse-slot');
        slot.appendChild(p('fuse-slot-label', 'FUSE · 2A'));
        if (props.hasFuse) slot.classList.add('is-ready');
        deadUnit.appendChild(slot);
        deadWrap.appendChild(deadUnit);

        var powerBtn = document.createElement('button');
        powerBtn.type = 'button';
        powerBtn.className = 'btn-amber';
        powerBtn.textContent = props.hasFuse ? '装入保险丝' : '缺少 2A 保险丝';
        powerBtn.disabled = !props.hasFuse;
        powerBtn.addEventListener('click', function () {
          if (!props.hasFuse) return;
          if (props.onPower) props.onPower();
          Scene.close();
        });
        deadWrap.appendChild(powerBtn);
        deadWrap.appendChild(p('tool-note', props.hasFuse
          ? '玻璃管卡进槽里，发出一点凉意。'
          : '保险丝座上刻着 2A。走廊的储物柜里也许有。'));
        root.appendChild(deadWrap);
        return { destroy: function () {} };
      }

      var wrap = div('tool-block');
      var caption = p('tool-caption', captionText);

      var dial = div('dial');
      var ticks = div('dial-ticks');
      for (var f = F_MIN; f <= F_MAX; f += 1) {
        var pct = (f - F_MIN) / (F_MAX - F_MIN) * 100;
        var tick = div('dial-tick' + (f % 2 === 0 ? ' is-major' : ''));
        tick.style.left = pct + '%';
        ticks.appendChild(tick);
        if (f % 4 === 0) {
          var num = div('dial-num');
          num.style.left = pct + '%';
          num.textContent = String(f);
          ticks.appendChild(num);
        }
      }
      var needle = div('dial-needle');
      dial.appendChild(ticks);
      dial.appendChild(needle);
      var dialCap = div('dial-caption');
      dialCap.textContent = 'TIDE RADIO / NIGHT';
      dial.appendChild(dialCap);

      var value = p('tool-value', '100.0');
      var unit = document.createElement('small');
      unit.textContent = ' MHz';
      value.appendChild(unit);

      var meter = div('meter');
      var fill = div('meter-fill');
      meter.appendChild(fill);
      var lockMark = div('meter-mark');
      lockMark.style.left = (LOCK_AT * 100) + '%';
      meter.appendChild(lockMark);
      var meterLabel = div('meter-label');
      var ml = document.createElement('span');
      ml.textContent = '信号强度';
      var mv = document.createElement('span');
      mv.textContent = '——';
      meterLabel.appendChild(ml);
      meterLabel.appendChild(mv);

      var slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'tool-slider';
      slider.min = String(F_MIN);
      slider.max = String(F_MAX);
      slider.step = '0.1';
      slider.value = locked ? String(TARGET) : String(startFreq);
      slider.setAttribute('aria-label', '调频旋钮，88 到 108 兆赫');

      var lockBtn = document.createElement('button');
      lockBtn.type = 'button';
      lockBtn.className = 'btn-amber';
      lockBtn.textContent = '锁定信号';

      wrap.appendChild(caption);
      wrap.appendChild(dial);
      wrap.appendChild(value);
      wrap.appendChild(slider);
      wrap.appendChild(meter);
      wrap.appendChild(meterLabel);
      wrap.appendChild(lockBtn);
      root.appendChild(wrap);

      function strengthOf(freq) {
        return Math.exp(-Math.pow(freq - TARGET, 2) / (2 * SIGMA * SIGMA));
      }

      function render() {
        var freq = parseFloat(slider.value);
        var pct = (freq - F_MIN) / (F_MAX - F_MIN) * 100;
        needle.style.left = pct + '%';
        value.childNodes[0].nodeValue = freq.toFixed(1);
        var s = strengthOf(freq);
        fill.style.width = (s * 100).toFixed(1) + '%';
        mv.textContent = s >= LOCK_AT ? '清晰' : (s > 0.14 ? '微弱' : '静电');

        if (locked) {
          lockBtn.disabled = true;
          lockBtn.textContent = '已锁定';
          lockBtn.classList.add('is-done');
        } else {
          lockBtn.disabled = s < LOCK_AT;
        }
        Audio.setSignal(s);
      }

      var lastSfx = 0;
      function onInput() {
        render();
        var now = Date.now();
        if (now - lastSfx > 70) { Audio.sfx('knob'); lastSfx = now; }
      }

      function onKey(e) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          var v = parseFloat(slider.value) + (e.key === 'ArrowRight' ? STEP : -STEP);
          slider.value = String(clamp(v, F_MIN, F_MAX));
          onInput();
        }
      }

      function onLock() {
        if (locked) return;
        if (strengthOf(parseFloat(slider.value)) < LOCK_AT) return;
        slider.value = String(TARGET);
        render();
        lockBtn.disabled = true;
        lockBtn.textContent = '已锁定';
        lockBtn.classList.add('is-done');
        locked = true;
        onLocked();
      }

      // 旋钮：按住刻度盘横向拖动（带连续咔哒与阻力感）
      var dragging = false;
      function dragTo(clientX) {
        var r = dial.getBoundingClientRect();
        if (!r.width) return;
        var pct = clamp((clientX - r.left) / r.width, 0, 1);
        slider.value = (F_MIN + pct * (F_MAX - F_MIN)).toFixed(1);
        onInput();
      }
      function onDialDown(e) {
        if (locked) return;
        dragging = true;
        dial.classList.add('is-grabbing');
        try { dial.setPointerCapture(e.pointerId); } catch (err) {}
        dragTo(e.clientX);
      }
      function onDialMove(e) {
        if (dragging) dragTo(e.clientX);
      }
      function onDialUp(e) {
        if (!dragging) return;
        dragging = false;
        dial.classList.remove('is-grabbing');
        try { dial.releasePointerCapture(e.pointerId); } catch (err) {}
      }

      dial.addEventListener('pointerdown', onDialDown);
      dial.addEventListener('pointermove', onDialMove);
      dial.addEventListener('pointerup', onDialUp);
      dial.addEventListener('pointercancel', onDialUp);

      slider.addEventListener('input', onInput);
      slider.addEventListener('keydown', onKey);
      lockBtn.addEventListener('click', onLock);
      render();

      return {
        destroy: function () {
          dial.removeEventListener('pointerdown', onDialDown);
          dial.removeEventListener('pointermove', onDialMove);
          dial.removeEventListener('pointerup', onDialUp);
          dial.removeEventListener('pointercancel', onDialUp);
          slider.removeEventListener('input', onInput);
          slider.removeEventListener('keydown', onKey);
          lockBtn.removeEventListener('click', onLock);
        }
      };
    },

    /* ---------- 海图定位：度分 → 十进制度 ---------- */
    chart: function (root, props) {
      props = props || {};
      var solved = !!props.solved;
      var torn = !!props.torn;
      var measuredOnce = !!props.measured;
      var answer = props.answer || { lat: 34.20, lon: 129.12 };

      var LON_MIN = 129.00, LON_MAX = 129.60;
      var LAT_MAX = 34.50, LAT_MIN = 34.00;
      var TOL = 0.006;

      var picked = null;
      var rulerAngle = 0;

      var wrap = div('tool-block');
      wrap.appendChild(p('tool-caption', props.caption || '海 图 · 潮汐镇外海'));
      var brief = p('chart-brief', props.brief || '按他报的坐标，在图上标出他的位置。');
      wrap.appendChild(brief);
      var body = div('chart-body');
      wrap.appendChild(body);
      root.appendChild(wrap);

      function lonToPct(lon) { return (lon - LON_MIN) / (LON_MAX - LON_MIN) * 100; }
      function latToPct(lat) { return (LAT_MAX - lat) / (LAT_MAX - LAT_MIN) * 100; }
      function pctToLon(x) { return LON_MIN + x / 100 * (LON_MAX - LON_MIN); }
      function pctToLat(y) { return LAT_MAX - y / 100 * (LAT_MAX - LAT_MIN); }
      function fmt(n) { return n.toFixed(3); }
      function coordText(c) { return '北纬 ' + fmt(c.lat) + '°N　东经 ' + fmt(c.lon) + '°E'; }
      function diffOf(a, b) { return Math.abs(((a - b) % 360 + 540) % 360 - 180); }

      function render() {
        body.innerHTML = '';
        var map = div('chartmap');
        map.appendChild(div('chartmap-grid'));
        map.appendChild(div('chartmap-coast'));

        var plot = null;
        var pin = null;
        var crossX = null, crossY = null;
        var stationEl = null;
        var ruler = null, read = null;
        var scaleBar = null;
        var dragMoved = false;
        var readout = p('chart-readout', solved ? coordText(answer) : '未标记');

        if (torn) {
          var mask = div('chartmap-torn');
          mask.appendChild(p('chartmap-torn-label', '缺'));
          map.appendChild(mask);
        } else {
          plot = div('chartplot');
          plot.appendChild(div('chartplot-fine'));
          plot.appendChild(div('chartplot-grid'));

          crossX = div('chart-cross chart-cross-x');
          crossY = div('chart-cross chart-cross-y');
          plot.appendChild(crossX);
          plot.appendChild(crossY);

          pin = div('chart-pin');
          plot.appendChild(pin);

          stationEl = div('chart-station');
          stationEl.appendChild(p('chart-station-label', '电台'));
          plot.appendChild(stationEl);

          if (solved && props.hasRuler) {
            ruler = div('chart-ruler');
            ruler.appendChild(div('chart-ruler-line'));
            plot.appendChild(ruler);
            read = div('chart-ruler-read');
            read.textContent = '读数 —';
            plot.appendChild(read);
          }

          var scale = div('chart-scale');
          scaleBar = div('chart-scale-bar');
          scale.appendChild(scaleBar);
          var scaleLabel = document.createElement('span');
          scaleLabel.textContent = '5 海里';
          scale.appendChild(scaleLabel);
          plot.appendChild(scale);

          map.appendChild(plot);

          var latAxis = div('chart-axis chart-axis-lat');
          for (var i = 0; i <= 10; i++) {
            var ls = document.createElement('span');
            ls.style.top = (i * 10) + '%';
            ls.textContent = (LAT_MAX - i * 0.05).toFixed(2);
            latAxis.appendChild(ls);
          }
          map.appendChild(latAxis);

          var lonAxis = div('chart-axis chart-axis-lon');
          for (var j = 0; j <= 6; j++) {
            var ns = document.createElement('span');
            ns.style.left = (j / 6 * 100) + '%';
            ns.textContent = (LON_MIN + j * 0.1).toFixed(2);
            lonAxis.appendChild(ns);
          }
          map.appendChild(lonAxis);

          var nMark = div('chart-dir chart-dir-n');
          nMark.textContent = 'N';
          map.appendChild(nMark);
          var eMark = div('chart-dir chart-dir-e');
          eMark.textContent = 'E';
          map.appendChild(eMark);

          function setPin(x, y, update) {
            pin.style.left = x + '%';
            pin.style.top = y + '%';
            pin.classList.add('is-on');
            crossX.style.top = y + '%';
            crossX.classList.add('is-on');
            crossY.style.left = x + '%';
            crossY.classList.add('is-on');
            if (update) {
              readout.textContent = coordText({
                lat: pctToLat(y),
                lon: pctToLon(x)
              });
            }
          }

          if (solved) {
            setPin(lonToPct(answer.lon), latToPct(answer.lat), false);
          } else if (picked) {
            setPin(lonToPct(picked.lon), latToPct(picked.lat), false);
          }

          plot.addEventListener('pointerdown', function (e) {
            if (solved) return;
            e.preventDefault();
            var r = plot.getBoundingClientRect();
            if (!r.width || !r.height) return;
            var x = (e.clientX - r.left) / r.width * 100;
            var y = (e.clientY - r.top) / r.height * 100;
            x = Math.max(1, Math.min(99, x));
            y = Math.max(1, Math.min(99, y));
            picked = { lat: pctToLat(y), lon: pctToLon(x) };
            setPin(x, y, true);
            Audio.sfx('knob');
          });

          function layoutRuler() {
            if (!ruler || !plot) return;
            var r = plot.getBoundingClientRect();
            if (!r.width || !r.height) return;
            var tx = lonToPct(answer.lon) / 100 * r.width;
            var ty = latToPct(answer.lat) / 100 * r.height;
            var L = 0.33 * r.width;
            var sx = tx + 0.6157 * L;
            var sy = ty - 0.7880 * L;
            stationEl.style.left = (sx / r.width * 100) + '%';
            stationEl.style.top = (sy / r.height * 100) + '%';
            ruler.style.left = (sx / r.width * 100) + '%';
            ruler.style.top = (sy / r.height * 100) + '%';
            if (scaleBar) {
              scaleBar.style.width = ((5 / 60) / (LAT_MAX - LAT_MIN) * r.height).toFixed(1) + 'px';
            }
          }

          function placeRuler(deg) {
            rulerAngle = (deg + 360) % 360;
            ruler.style.transform = 'translate(-50%, -50%) rotate(' + rulerAngle.toFixed(2) + 'deg)';
            read.textContent = '读数 ' + rulerAngle.toFixed(1) + '°';
            var aligned = diffOf(rulerAngle, props.measureAt) <= 1.5;
            ruler.classList.toggle('is-align', aligned);
            read.classList.toggle('is-align', aligned);
          }

          function angleAt(e) {
            var sr = stationEl.getBoundingClientRect();
            var sx = sr.left + sr.width / 2;
            var sy = sr.top + sr.height / 2;
            var a = Math.atan2(e.clientX - sx, sy - e.clientY) * 180 / Math.PI;
            return (a + 360) % 360;
          }

          if (ruler) {
            var dragging = false;

            plot.addEventListener('pointerdown', function (e) {
              dragging = true;
              dragMoved = false;
              try { plot.setPointerCapture(e.pointerId); } catch (err) {}
              placeRuler(angleAt(e));
            });

            plot.addEventListener('pointermove', function (e) {
              if (!dragging) return;
              dragMoved = true;
              placeRuler(angleAt(e));
            });

            plot.addEventListener('pointerup', function () {
              if (!dragging) return;
              dragging = false;
              if (!dragMoved) return;
              if (!measuredOnce && diffOf(rulerAngle, props.measureAt) <= 1.5) {
                measuredOnce = true;
                if (props.onMeasure) props.onMeasure(props.measureAt);
              }
            });

            requestAnimationFrame(function () {
              layoutRuler();
              placeRuler(measuredOnce ? props.measureAt : 0);
            });
            setTimeout(layoutRuler, 450);
            window.addEventListener('resize', layoutRuler);
          }
        }

        body.appendChild(map);

        if (torn) {
          var pieceBtn = document.createElement('button');
          pieceBtn.type = 'button';
          pieceBtn.className = 'btn-amber';
          pieceBtn.textContent = props.hasPiece ? '把残片拼上去' : '缺一角 · 找找残片';
          pieceBtn.disabled = !props.hasPiece;
          pieceBtn.addEventListener('click', function () {
            if (!props.hasPiece) return;
            if (props.onPiece) props.onPiece();
            torn = false;
            brief.textContent = '把度分换成小数，再点在海图上。';
            render();
          });
          body.appendChild(pieceBtn);

          var tornNote = p('tool-note', '海图的右下角整块不见了。撕口很新。');
          tornNote.style.textAlign = 'left';
          body.appendChild(tornNote);
          return;
        }

        body.appendChild(readout);

        var note = p('tool-note', props.note || '');
        note.style.textAlign = 'left';
        body.appendChild(note);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-amber';
        btn.textContent = solved ? '位置已确认' : '确认坐标';
        if (solved) { btn.disabled = true; btn.classList.add('is-done'); }
        body.appendChild(btn);

        btn.addEventListener('click', function () {
          if (solved) return;
          if (!picked) { Sub.hint('先在图上点出他的位置。', 2200); return; }
          if (Math.abs(picked.lat - answer.lat) <= TOL && Math.abs(picked.lon - answer.lon) <= TOL) {
            solved = true;
            Audio.sfx('lock');
            if (props.onSolved) props.onSolved();
            render();
          } else {
            Audio.sfx('switch');
            Sub.hint('这里没有浮标。再对一遍经纬度。', 2800);
          }
        });
      }

      render();
      return { destroy: function () {} };
    },

    /* ---------- 天线旋转器：粗调 + 微调 ---------- */
    rotator: function (root, props) {
      props = props || {};
      var target = props.target != null ? props.target : 224;
      var tol = props.tol != null ? props.tol : 1;
      var solved = !!props.solved;
      var coarse = props.coarse != null ? props.coarse : 180;
      var fine = props.fine != null ? props.fine : 0;

      var wrap = div('tool-block');
      wrap.appendChild(p('tool-caption', '天 线 · 方 位 旋 转 器'));
      wrap.appendChild(p('chart-brief', props.dead ? '没有电。表盘一动不动。' : '粗调每格 10°，微调每格 1°。'));

      function row(label, min, max, step, value, aria) {
        var r = div('rot-row');
        var l = document.createElement('span');
        l.textContent = label;
        var input = document.createElement('input');
        input.type = 'range';
        input.className = 'tool-slider';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(value);
        input.setAttribute('aria-label', aria);
        r.appendChild(l);
        r.appendChild(input);
        wrap.appendChild(r);
        return input;
      }

      var coarseEl = row('粗调', 0, 350, 10, coarse, '天线粗调，每格十度');
      var fineEl = row('微调', 0, 9, 1, fine, '天线微调，每格一度');

      var value = p('tool-value', '0');
      var unit = document.createElement('small');
      unit.textContent = '° 磁方位';
      value.appendChild(unit);
      wrap.appendChild(value);

      var tip = p('tool-note', props.dead
        ? '没有电。表盘一动不动。'
        : '表盘只报当前磁方位，不会告诉你对没对上。');
      tip.style.textAlign = 'left';
      wrap.appendChild(tip);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-amber';
      btn.textContent = solved ? '方向已发出' : '固定天线';
      if (solved || props.dead) {
        btn.disabled = true;
        if (solved) btn.classList.add('is-done');
      }
      wrap.appendChild(btn);
      root.appendChild(wrap);

      var busy = solved;

      function bearing() { return parseFloat(coarseEl.value) + parseFloat(fineEl.value); }

      function diffOf(b) {
        var d = ((b - target) % 360 + 540) % 360 - 180;
        return Math.abs(d);
      }

      function render() {
        value.childNodes[0].nodeValue = Math.round(bearing());
      }

      function onInput() {
        render();
        Audio.sfx('knob');
      }

      coarseEl.addEventListener('input', onInput);
      fineEl.addEventListener('input', onInput);

      btn.addEventListener('click', function () {
        if (busy) return;
        if (diffOf(bearing()) > tol) {
          Audio.sfx('switch');
          Sub.hint('耳机里还是静电。天线没对上。', 2600);
          return;
        }
        busy = true;
        btn.disabled = true;
        btn.textContent = '方向已发出';
        btn.classList.add('is-done');
        Audio.sfx('lock');
        if (props.onSolved) props.onSolved(parseFloat(coarseEl.value), parseFloat(fineEl.value));
      });

      render();
      return { destroy: function () {} };
    },

    /* ---------- 储物柜 ---------- */
    locker: function (root, props) {
      props = props || {};
      var fuseTaken = !!props.fuseTaken;
      var wireTaken = !!props.wireTaken;
      var pieceTaken = !!props.pieceTaken;
      var logRead = !!props.logRead;

      var wrap = div('tool-block');
      wrap.appendChild(p('tool-caption', '储 物 柜 · 第 三 格'));
      var list = div('locker-list');
      wrap.appendChild(list);
      root.appendChild(wrap);

      function render() {
        list.innerHTML = '';

        function row(name, desc, taken, label, onTake) {
          var r = div('locker-row' + (taken ? ' is-taken' : ''));
          var info = div('locker-info');
          info.appendChild(p('locker-name', name));
          info.appendChild(p('locker-desc', desc));
          r.appendChild(info);

          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'locker-take';
          b.textContent = taken ? '已拿走' : label;
          b.disabled = taken;
          b.addEventListener('click', function () {
            if (taken) return;
            onTake();
            render();
          });
          r.appendChild(b);
          list.appendChild(r);
        }

        row('烧断的保险丝', '玻璃管发黑，金属丝断成两截。', fuseTaken, '拿走', function () {
          fuseTaken = true;
          if (props.onFuse) props.onFuse();
        });

        row('一小卷铜线', '够绕一根保险丝。', wireTaken, '拿走', function () {
          wireTaken = true;
          if (props.onWire) props.onWire();
        });

        row('海图残片', '撕口很新，背面是潮汐镇的图例。', pieceTaken, '拿走', function () {
          pieceTaken = true;
          if (props.onPiece) props.onPiece();
        });

        row('值班日志', logRead ? '翻到折角那一页。' : '摊在最上层，页角折着。', logRead, '翻开', function () {
          logRead = true;
          if (props.onLog) props.onLog();
        });

        if (logRead && props.logText) {
          var log = p('tool-note', props.logText);
          log.style.textAlign = 'left';
          list.appendChild(log);
        }
      }

      render();
      return { destroy: function () {} };
    },

    /* ---------- 降噪 ---------- */
    denoise: function (root) {
      var G_TARGET = 70, F_TARGET = 55, PASS = 76;

      var wrap = div('tool-block');

      function makeSlider(label, init, ariaLabel) {
        var block = div('tool-block');
        block.style.marginBottom = '6px';
        var cap = p('tool-caption', label);
        var input = document.createElement('input');
        input.type = 'range';
        input.className = 'tool-slider';
        input.min = '0';
        input.max = '100';
        input.step = '1';
        input.value = String(Pro.denoised ? init : 0);
        input.setAttribute('aria-label', ariaLabel);
        block.appendChild(cap);
        block.appendChild(input);
        wrap.appendChild(block);
        return input;
      }

      var gain = makeSlider('增 益', G_TARGET, '增益');
      var filter = makeSlider('滤 波', F_TARGET, '滤波');

      var value = p('tool-value', '0');
      var unit = document.createElement('small');
      unit.textContent = ' % 可辨';
      value.appendChild(unit);
      wrap.appendChild(value);

      var meter = div('meter');
      var fill = div('meter-fill');
      var mark = div('meter-mark');
      mark.style.left = PASS + '%';
      meter.appendChild(fill);
      meter.appendChild(mark);
      wrap.appendChild(meter);

      var meterLabel = div('meter-label');
      var ml = document.createElement('span');
      ml.textContent = '清晰度';
      var mv = document.createElement('span');
      mv.textContent = '——';
      meterLabel.appendChild(ml);
      meterLabel.appendChild(mv);
      wrap.appendChild(meterLabel);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-amber';
      btn.textContent = '接入人声';
      wrap.appendChild(btn);

      function clarity() {
        var g = parseFloat(gain.value);
        var f = parseFloat(filter.value);
        return clamp(100 - (Math.abs(g - G_TARGET) + Math.abs(f - F_TARGET)) * 0.6, 0, 100);
      }

      function render() {
        var c = clarity();
        value.childNodes[0].nodeValue = Math.round(c);
        fill.style.width = c.toFixed(1) + '%';
        mv.textContent = c >= PASS ? '可辨' : '模糊';
        if (Pro.denoised) {
          btn.disabled = true;
          btn.textContent = '已接入';
          btn.classList.add('is-done');
        } else {
          btn.disabled = c < PASS;
        }
      }

      var lastSfx = 0;
      function onInput() {
        render();
        var now = Date.now();
        if (now - lastSfx > 80) { Audio.sfx('knob'); lastSfx = now; }
      }

      function onConnect() {
        Pro.onDenoiseTried(clarity() >= PASS);
        render();
      }

      gain.addEventListener('input', onInput);
      filter.addEventListener('input', onInput);
      btn.addEventListener('click', onConnect);
      root.appendChild(wrap);
      render();

      return {
        destroy: function () {
          gain.removeEventListener('input', onInput);
          filter.removeEventListener('input', onInput);
          btn.removeEventListener('click', onConnect);
        }
      };
    },

    /* ---------- 应答播放 ---------- */
    respond: function (root) {
      var wrap = div('tool-block');
      var caption = p('tool-caption', '应 答 · 播 放');
      wrap.appendChild(caption);

      var note = p('tool-note', Pro.step === 'respond'
        ? '电话那头还在等你。'
        : '听筒里只有电流声。还没有人打进来。');
      note.style.textAlign = 'left';
      wrap.appendChild(note);

      if (Pro.step === 'respond' || Pro.step === 'tape') {
        var list = div('choices');
        var options = [
          { id: 'music', title: '放一首曲子', desc: '从柜子里挑一段，替他把夜填满' },
          { id: 'beacon', title: '点亮航道灯', desc: '把港口的灯打开' },
          { id: 'news', title: '念一段气象', desc: '照常播报今晚的风力和潮位' }
        ];
        options.forEach(function (opt, i) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'choice';
          btn.disabled = !!Pro.used[opt.id] || Pro.finished;

          var idx = document.createElement('span');
          idx.className = 'choice-index';
          idx.textContent = '0' + (i + 1);

          var body = div('choice-body');
          var title = document.createElement('span');
          title.className = 'choice-title';
          title.textContent = opt.title;
          var desc = document.createElement('span');
          desc.className = 'choice-desc';
          desc.textContent = opt.desc;
          body.appendChild(title);
          body.appendChild(desc);

          btn.appendChild(idx);
          btn.appendChild(body);
          btn.addEventListener('click', function () {
            if (btn.disabled) return;
            btn.disabled = true;
            Pro.answer(opt.id);
          });
          list.appendChild(btn);
        });
        wrap.appendChild(list);
      }

      root.appendChild(wrap);
      return { destroy: function () {} };
    },

    /* ---------- 设备柜 / 值班手册 ---------- */
    manual: function (root) {
      var wrap = div('tool-block');
      var note = p('tool-note',
        '柜门里码着旧磁带，最上面一格空着，标签被撕掉了。\n\n' +
        '压在一摞纸下面是值班手册，纸页发脆：\n\n' +
        '“降噪出厂校准 —— 增益 70，滤波 55。”\n\n' +
        '下面还有一行，笔迹更旧：\n\n' +
        '“刻度不是真相。信海图。”');
      note.style.textAlign = 'left';
      wrap.appendChild(note);
      root.appendChild(wrap);
      return { destroy: function () {} };
    }
  };

  /* ============================================================
     特写：拖动旋转（伪 3D 视角）
     ============================================================ */
  var Rotate = {
    stage: null,
    root: null,
    dragging: false,
    sx: 0,
    sy: 0,
    rx: 0,
    ry: 0,
    raf: 0,

    init: function () {
      var el = document.getElementById('closeupShot');
      this.stage = document.getElementById('closeupStage');
      this.root = document.getElementById('closeup');
      if (!el || !this.stage) return;
      var self = this;

      el.addEventListener('pointerdown', function (e) {
        if (e.button && e.button !== 0) return;
        self.dragging = true;
        self.sx = e.clientX;
        self.sy = e.clientY;
        cancelAnimationFrame(self.raf);
        self.stage.classList.add('is-dragging');
        if (self.root) self.root.classList.add('is-turning');
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
      });

      el.addEventListener('pointermove', function (e) {
        if (!self.dragging) return;
        var dx = e.clientX - self.sx;
        var dy = e.clientY - self.sy;
        self.sx = e.clientX;
        self.sy = e.clientY;
        // 幅度收窄：像托着实物转，而不是翻一张卡片
        self.ry = clamp(self.ry + dx * 0.09, -11, 11);
        self.rx = clamp(self.rx - dy * 0.06, -6, 6);
        self.apply();
      });

      function end() {
        if (!self.dragging) return;
        self.dragging = false;
        self.stage.classList.remove('is-dragging');
        if (self.root) self.root.classList.remove('is-turning');
        self.release();
      }

      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('pointerleave', end);
    },

    apply: function () {
      if (!this.stage) return;
      var ry = this.ry;
      var rx = this.rx;
      this.stage.style.transform = 'perspective(1200px) rotateX(' +
        rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';

      // 分层视差：物件、背景虚化、高光以不同幅度移动，产生厚度
      if (this.root) {
        this.root.style.setProperty('--lift-x', (ry * 0.7).toFixed(1) + 'px');
        this.root.style.setProperty('--lift-y', (-rx * 0.7).toFixed(1) + 'px');
        this.root.style.setProperty('--bgx', (-ry * 3.2).toFixed(1) + 'px');
        this.root.style.setProperty('--sheen-x', (ry * 4.6).toFixed(1) + 'px');
      }
    },

    /* 松手后带阻尼回正 */
    release: function () {
      var self = this;
      cancelAnimationFrame(this.raf);

      function step() {
        self.rx *= 0.82;
        self.ry *= 0.82;
        if (Math.abs(self.rx) < 0.06 && Math.abs(self.ry) < 0.06) {
          self.rx = 0;
          self.ry = 0;
          self.apply();
          return;
        }
        self.apply();
        self.raf = requestAnimationFrame(step);
      }
      this.raf = requestAnimationFrame(step);
    },

    reset: function () {
      cancelAnimationFrame(this.raf);
      this.rx = 0;
      this.ry = 0;
      this.apply();
    }
  };

  /* ============================================================
     场景与特写
     ============================================================ */
  var Scene = {
    el: {},
    current: null,
    sceneId: null,
    area: null,
    traveling: false,
    onAreaChange: null,
    widget: null,
    opened: null,
    lastFocus: null,

    init: function () {
      this.el.art = $('#sceneArt');
      this.el.hotspots = $('#hotspots');
      this.el.lights = $('#lights');
      this.el.closeup = $('#closeup');
      this.el.tools = $('#closeupTools');
      this.el.title = $('#closeupTitle');
      this.el.back = $('#closeupBack');
      this.el.objective = $('#objective');

      this.el.back.addEventListener('click', function () { Scene.close(); });
      this.el.closeup.addEventListener('click', function (e) {
        if (e.target === Scene.el.closeup) Scene.close();
      });

      this.bindProximity();
    },

    /* 光标靠近物件时，光点自己亮一点：让"可交互"变成空间感 */
    bindProximity: function () {
      var stage = $('#stage');
      if (!stage) return;
      var raf = 0, px = -9999, py = -9999;

      function apply() {
        raf = 0;
        var nodes = document.querySelectorAll('.hotspot');
        for (var i = 0; i < nodes.length; i++) {
          var r = nodes[i].getBoundingClientRect();
          var dx = px - (r.left + r.width / 2);
          var dy = py - (r.top + r.height / 2);
          var near = clamp(1 - Math.sqrt(dx * dx + dy * dy) / 190, 0, 1);
          nodes[i].style.setProperty('--near', near.toFixed(2));
        }
      }

      stage.addEventListener('pointermove', function (e) {
        px = e.clientX; py = e.clientY;
        if (!raf) raf = requestAnimationFrame(apply);
      }, { passive: true });

      stage.addEventListener('pointerleave', function () {
        px = -9999; py = -9999;
        if (!raf) raf = requestAnimationFrame(apply);
      });
    },

    load: function (id, areaKey) {
      var scene = SCENES[id];
      if (!scene) return;
      this.current = scene;
      this.sceneId = id;

      if (scene.areas) {
        var key = (areaKey && scene.areas[areaKey]) ? areaKey : scene.start;
        this.area = key;
        this.renderArea(scene.areas[key]);
      } else {
        this.area = null;
        this.renderArea(scene);
      }
      this.renderHotspots();
    },

    currentArea: function () {
      if (!this.current) return null;
      if (this.current.areas) return this.current.areas[this.area] || null;
      return this.current;
    },

    renderArea: function (area) {
      if (!area) return;
      this.el.art.style.backgroundColor = '#0a141f';
      var jpg = (area.art || '').replace(/\.svg$/, '.jpg');
      this.el.art.style.backgroundImage = 'url("' + jpg + '"), url("' + area.art + '")';

      this.el.lights.innerHTML = '';
      (area.lights || []).forEach(function (light) {
        var node = div('light');
        node.id = 'light-' + light.id;
        node.style.left = light.x + '%';
        node.style.top = light.y + '%';
        Scene.el.lights.appendChild(node);
      });

      var tag = $('#roomTag');
      if (tag) tag.textContent = area.room || '';
    },

    renderHotspots: function () {
      var area = this.currentArea();
      if (!area) return;
      var self = this;
      this.el.hotspots.innerHTML = '';

      (area.hotspots || []).forEach(function (hs) {
        if (hs.visible && !hs.visible()) return;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hotspot' + (hs.cls ? ' ' + hs.cls : '');
        btn.id = 'hs-' + hs.id;
        btn.style.left = hs.x + '%';
        btn.style.top = hs.y + '%';
        btn.setAttribute('aria-label', hs.label + (hs.take ? '，可以拿走' : '，进入特写'));

        var label = document.createElement('span');
        label.className = 'hotspot-label';
        label.textContent = hs.label;
        btn.appendChild(label);

        btn.addEventListener('click', function () {
          if (self.traveling) return;

          if (hs.take) {
            if (Inv.has(hs.take.id)) return;
            Inv.add(hs.take.id);
            Audio.sfx('paper');
            Sub.hint('收进包里：' + hs.take.name + '。', 2600);
            if (hs.take.after) hs.take.after();
            return;
          }

          if (Inv.selected) {
            if (hs.use && hs.use.item === Inv.selected) {
              Inv.consume(hs.use.item);
              hs.use.then(btn, hs);
              return;
            }
            if (hs.use) {
              Sub.hint('手里这东西，用不上。', 2200);
              return;
            }
          }

          if (hs.action) { hs.action(btn, hs); return; }

          var w = hs.closeup && hs.closeup.widget;
          Audio.sfx(hs.id === 'cabinet' || hs.id === 'locker' ? 'drawer' : (w === 'note' ? 'paper' : 'open'));
          Scene.open(hs, btn);
        });

        self.el.hotspots.appendChild(btn);
      });

      (area.exits || []).forEach(function (ex) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'nav-arrow nav-' + (ex.dir || 'right');
        b.setAttribute('aria-label', '前往' + ex.label);

        var g = document.createElement('span');
        g.className = 'nav-glyph';
        g.setAttribute('aria-hidden', 'true');
        g.textContent = ex.dir === 'left' ? '←' : (ex.dir === 'down' ? '↓' : '→');

        b.appendChild(g);
        b.addEventListener('click', function () { Scene.travel(ex.to, ex.dir); });
        self.el.hotspots.appendChild(b);
      });
    },

    findHotspot: function (id) {
      var area = this.currentArea();
      var list = (area && area.hotspots) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) return list[i];
      }
      return null;
    },

    /* 房间之间来回走：先滑出，换景，再滑入 */
    travel: function (to, dir) {
      if (this.traveling || !this.current || !this.current.areas) return;
      if (!this.current.areas[to] || to === this.area) return;

      if (this.isOpen()) this.close();

      var scene = this.current;
      var self = this;
      var stage = $('#stage');
      var cls = 'is-walk-' + (dir || 'right');

      this.traveling = true;
      stage.classList.add(cls);
      Audio.sfx('step');

      setTimeout(function () {
        self.area = to;
        self.renderArea(scene.areas[to]);
        self.renderHotspots();
        stage.classList.remove(cls);
        stage.classList.add(cls + '-in');
        if (self.onAreaChange) self.onAreaChange();
        setTimeout(function () {
          stage.classList.remove(cls + '-in');
          self.traveling = false;
        }, 420);
      }, 300);
    },

    setObjective: function (text) {
      this.el.objective.textContent = text || '';
    },

    setActive: function (id, on) {
      var node = document.getElementById('hs-' + id);
      if (node) node.classList.toggle('is-active', !!on);
    },

    setLight: function (id, on) {
      var node = document.getElementById('light-' + id);
      if (node) node.classList.toggle('is-lit', !!on);
    },

    open: function (hs, sourceEl) {
      if (hs.gate && !hs.gate()) {
        Audio.sfx('switch');
        Sub.hint(hs.gateHint || '现在还不是时候。', 2800);
        return;
      }

      this.opened = hs;
      this.lastFocus = sourceEl || null;
      this.el.title.textContent = hs.closeup.title || hs.label;
      this.el.tools.innerHTML = '';

      if (hs.onOpen) hs.onOpen();

      var base = hs.closeup || {};
      var def = {};
      for (var key in base) {
        if (Object.prototype.hasOwnProperty.call(base, key)) def[key] = base[key];
      }
      if (typeof def.props === 'function') {
        var dyn = def.props() || {};
        for (var dk in dyn) {
          if (Object.prototype.hasOwnProperty.call(dyn, dk)) def[dk] = dyn[dk];
        }
      }

      var widget = WIDGETS[def.widget] || WIDGETS.note;
      this.widget = widget(this.el.tools, def) || null;

      // 物品特写：直接用实物插图铺满
      var shot = document.getElementById('closeupShot');
      var artPath = def.art || (this.current ? this.current.art : '');
      if (shot && artPath) {
        // 生成图优先（同名 .jpg），没有就回退手绘 SVG
        var jpgPath = artPath.replace(/\.svg$/, '.jpg');
        var pngPath = artPath.replace(/\.svg$/, '.png');
        var stack = 'url("' + pngPath + '"), url("' + jpgPath + '"), url("' + artPath + '")';
        shot.style.backgroundImage = stack;
        shot.style.backgroundPosition = '50% 50%, 50% 50%';
        shot.style.backgroundSize = 'contain, contain';
        shot.style.backgroundRepeat = 'no-repeat, no-repeat';
        var bg = document.getElementById('closeupBg');
        if (bg) bg.style.backgroundImage = stack;
      }

      // 文字已经烧进特写图（见 tools/paint.py），不再叠 HTML 浮层
      var textLayer = document.getElementById('closeupText');
      if (textLayer && !def.textBaked) {
        textLayer.innerHTML = '';
        (def.overlays || []).forEach(function (o) {
          var n = document.createElement('div');
          n.className = 'ovl' + (o.cls ? ' ' + o.cls : '');
          n.textContent = o.text;
          n.setAttribute('data-x', o.x);
          n.setAttribute('data-y', o.y);
          n.setAttribute('data-size', o.size || 15);
          if (o.rot) n.style.transform = 'rotate(' + o.rot + 'deg)';
          textLayer.appendChild(n);
        });
        this.placeOverlays();
      }

      this.el.closeup.hidden = false;
      clearTimeout(this.hideTimer);

      // 镜头推进：从物件所在的方向"凑近"，而不是硬切一张图
      var box = $('#stage').getBoundingClientRect();
      var target = sourceEl;
      var pushX = 0, pushY = 0;
      if (target) {
        var r = target.getBoundingClientRect();
        var cx = r.left + r.width / 2 - (box.left + box.width / 2);
        var cy = r.top + r.height / 2 - (box.top + box.height / 2);
        pushX = clamp(cx * 0.07, -56, 56);
        pushY = clamp(cy * 0.07, -36, 36);
      }
      this.el.closeup.style.setProperty('--push-x', pushX.toFixed(1) + 'px');
      this.el.closeup.style.setProperty('--push-y', pushY.toFixed(1) + 'px');

      var node = this.el.closeup;
      requestAnimationFrame(function () {
        node.classList.add('is-open');
        Scene.placeOverlays();
      });
      this.el.back.focus({ preventScroll: true });
    },

    /* 把叠加文字换算到 cover 后的实际图面坐标 */
    placeOverlays: function () {
      var art = document.getElementById('closeupShot');
      var box = document.getElementById('closeupText');
      if (!art || !box) return;
      var w = art.clientWidth;
      var h = art.clientHeight;
      if (!w || !h) return;

      var scale = Math.min(w / 1600, h / 900);
      var bw = 1600 * scale;
      var bh = 900 * scale;
      var ox = (w - bw) / 2;
      var oy = (h - bh) / 2;

      var nodes = box.querySelectorAll('.ovl');
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var x = parseFloat(n.getAttribute('data-x'));
        var y = parseFloat(n.getAttribute('data-y'));
        var size = parseFloat(n.getAttribute('data-size') || 15);
        n.style.left = (ox + x / 100 * bw).toFixed(1) + 'px';
        n.style.top = (oy + y / 100 * bh).toFixed(1) + 'px';
        n.style.fontSize = (size * scale).toFixed(1) + 'px';
      }
    },

    close: function () {
      var node = this.el.closeup;
      if (node.hidden) return;
      node.classList.remove('is-open');
      if (this.widget && this.widget.destroy) this.widget.destroy();
      this.widget = null;
      if (this.opened && this.opened.id === 'radio') Audio.releaseSignal();
      Rotate.reset();
      this.opened = null;
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(function () { node.hidden = true; }, 400);
      if (this.lastFocus) this.lastFocus.focus({ preventScroll: true });
      Audio.sfx('click');
    },

    isOpen: function () { return !this.el.closeup.hidden; }
  };

  /* ============================================================
     布局
     ============================================================ */
  var Layout = {
    landscape: false,

    apply: function () {
      var vp = $('#viewport');
      var stage = $('#stage');
      var isLandscape = window.innerWidth >= 600 && window.innerWidth > window.innerHeight;

      this.landscape = isLandscape;
      vp.classList.toggle('is-landscape', isLandscape);
      vp.classList.toggle('is-portrait', !isLandscape);
      vp.classList.toggle('is-compact', window.innerHeight <= 540);
      $('#topbar').classList.toggle('is-compact', window.innerHeight <= 540);

      var w = stage.clientWidth;
      var h = stage.clientHeight;
      if (w && h) {
        // 横屏 cover 铺满；竖屏 contain 保证整间屋子都能点到
        var scale = isLandscape
          ? Math.max(w / IMG_W, h / IMG_H)
          : Math.min(w / IMG_W, h / IMG_H);
        var fw = (IMG_W * scale).toFixed(2) + 'px';
        var fh = (IMG_H * scale).toFixed(2) + 'px';
        $$('.scene-frame').forEach(function (frame) {
          frame.style.width = fw;
          frame.style.height = fh;
        });
      }

      Fog.resize();
      Sub.resize();
      if (Scene.isOpen()) Scene.placeOverlays();
    }
  };

  /* ============================================================
     界面
     ============================================================ */
  var UI = {
    init: function () {
      $('#btnMute').addEventListener('click', function () {
        Audio.unlock();
        Audio.setMuted(!Audio.muted);
        Audio.sfx('click');
      });

      $('#setMute').addEventListener('change', function () {
        Audio.unlock();
        Audio.setMuted(this.checked);
      });

      $$('[data-close]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          UI.closeModal(btn.getAttribute('data-close'));
        });
      });

      $$('.modal').forEach(function (modal) {
        modal.addEventListener('click', function (e) {
          if (e.target === modal) UI.closeModal(modal.id);
        });
      });

      $$('#menu [data-action]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          Audio.unlock();
          Audio.sfx('click');
          UI.menuAction(btn.getAttribute('data-action'));
        });
      });

      var restartYes = $('#btnRestartYes');
      if (restartYes) {
        restartYes.addEventListener('click', function () {
          UI.closeModal('modalRestart');
          Game.restart();
        });
      }

      var menuBtn = $('#btnMenu');
      if (menuBtn) {
        menuBtn.addEventListener('click', function () {
          Audio.sfx('click');
          Game.toMenu();
        });
      }

      this.syncMute();
    },

    menuAction: function (action) {
      if (action === 'start') {
        Game.fadeTo(function () { Game.enter(); });
      } else if (action === 'restart') {
        UI.openModal('modalRestart');
      } else if (action === 'tapes') {
        UI.renderTapes();
        UI.openModal('modalTapes');
      } else if (action === 'settings') {
        $('#setMute').checked = Audio.muted;
        UI.openModal('modalSettings');
      } else if (action === 'credits') {
        UI.openModal('modalCredits');
      }
    },

    openModal: function (id) {
      var node = document.getElementById(id);
      if (!node) return;
      node.hidden = false;
      var focusable = node.querySelector('button, input');
      if (focusable) focusable.focus({ preventScroll: true });
    },

    closeModal: function (id) {
      var node = document.getElementById(id);
      if (node) node.hidden = true;
    },

    anyModalOpen: function () {
      return $$('.modal').some(function (m) { return !m.hidden; });
    },

    closeTopModal: function () {
      var open = $$('.modal').filter(function (m) { return !m.hidden; });
      if (!open.length) return false;
      open[open.length - 1].hidden = true;
      return true;
    },

    syncMute: function () {
      var btn = $('#btnMute');
      btn.setAttribute('aria-pressed', Audio.muted ? 'true' : 'false');
      btn.textContent = Audio.muted ? '已静音' : '静音';
      var set = $('#setMute');
      if (set) set.checked = Audio.muted;
      Sub.syncMuted();
    },

    renderTapes: function () {
      var list = $('#tapeList');
      var tapes = Store.get(K.tapes, []);
      list.innerHTML = '';
      if (!tapes.length) {
        var empty = p('tape-empty', '柜子还空着。每一夜结束后，那通电话会被收进来。');
        list.appendChild(empty);
        return;
      }
      tapes.forEach(function (tape) {
        var item = div('tape-item');
        item.textContent = tape.title || '未命名录音';
        var meta = document.createElement('span');
        meta.textContent = tape.night || '';
        item.appendChild(meta);
        list.appendChild(item);
      });
    }
  };

  /* ============================================================
     开篇动画
     ============================================================ */
  var Intro = {
    el: null,
    canvas: null,
    ctx: null,
    drops: [],
    raf: 0,
    timer: 0,
    finished: false,
    w: 0,
    h: 0,
    last: 0,

    init: function () {
      this.el = document.getElementById('intro');
      if (!this.el) return;

      this.canvas = document.getElementById('introRain');
      this.ctx = this.canvas.getContext('2d');
      this.resize();

      for (var i = 0; i < 110; i++) {
        this.drops.push({
          x: Math.random(),
          y: Math.random(),
          len: 0.05 + Math.random() * 0.16,
          speed: 0.24 + Math.random() * 0.7,
          a: 0.04 + Math.random() * 0.14
        });
      }

      var self = this;
      this._onEnd = function () { self.end(); };
      this.el.addEventListener('pointerdown', this._onEnd);
      document.addEventListener('keydown', this._onEnd);

      this._boundTick = this.tick.bind(this);
      this.raf = requestAnimationFrame(this._boundTick);
      this.timer = setTimeout(function () { self.end(); }, 11200);

      // 开篇帧序列：assets/intro/f001.jpg 起，真正的镜头运动
      this.reelTitle = document.querySelector('.intro-text');
      this.reelHint = document.querySelector('.intro-hint');
      if (this.reelTitle) { this.reelTitle.style.opacity = 0; this.reelTitle.style.transform = 'none'; }
      if (this.reelHint) this.reelHint.style.opacity = 0;
      this.startReel();

      window.addEventListener('resize', function () {
        if (!self.finished) self.resize();
      });
    },

    REEL_TOTAL: 192,
    REEL_FPS: 24,

    startReel: function () {
      var self = this;
      var el = document.getElementById('introCanvas');
      if (!el) return;
      this.reelEl = el;
      this.reelCtx = el.getContext('2d');
      this.reelImgs = [];
      this.reelLoaded = 0;
      this.reelStarted = false;

      for (var i = 1; i <= this.REEL_TOTAL; i++) {
        (function (idx) {
          var im = new Image();
          im.onload = im.onerror = function () {
            self.reelLoaded++;
            if (!self.reelStarted && self.reelLoaded >= 12) self.beginReel();
          };
          im.src = 'assets/intro/f' + ('00' + idx).slice(-3) + '.jpg';
          self.reelImgs[idx] = im;
        })(i);
      }
    },

    beginReel: function () {
      if (this.reelStarted || this.finished) return;
      this.reelStarted = true;
      this.reelEl.classList.add('is-on');
      this.el.classList.add('has-video');
      clearTimeout(this.timer);

      var self = this;
      var start = 0;
      var last = -1;
      var total = this.REEL_TOTAL;
      var step = function (ts) {
        if (self.finished) return;
        if (!start) start = ts;
        var idx = Math.min(total - 1, Math.floor((ts - start) / (1000 / self.REEL_FPS)));
        if (idx !== last) {
          var im = self.reelImgs[idx + 1];
          if (im && im.complete && im.naturalWidth) {
            self.drawReel(im);
            last = idx;
          }
        }
        var sec = (ts - start) / 1000;
        if (self.reelTitle) self.reelTitle.style.opacity = Math.max(0, Math.min(1, (sec - 3.4) / 1.4));
        if (self.reelHint) self.reelHint.style.opacity = Math.max(0, Math.min(1, (sec - 5.9) / 0.9));
        if (idx >= total - 1) {
          setTimeout(function () { self.end(); }, 280);
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },

    drawReel: function (im) {
      var c = this.reelEl;
      var ctx = this.reelCtx;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = c.clientWidth || window.innerWidth;
      var h = c.clientHeight || window.innerHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      var cw = c.width;
      var ch = c.height;
      var s = Math.max(cw / im.width, ch / im.height);
      var dw = im.width * s;
      var dh = im.height * s;
      ctx.drawImage(im, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    },

    resize: function () {
      if (!this.canvas) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = window.innerWidth;
      this.h = window.innerHeight;
      this.canvas.width = Math.floor(this.w * dpr);
      this.canvas.height = Math.floor(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    tick: function (now) {
      if (this.finished) return;
      var dt = this.last ? Math.min(now - this.last, 60) : 16;
      this.last = now;

      var ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.lineWidth = 1;

      for (var i = 0; i < this.drops.length; i++) {
        var d = this.drops[i];
        d.y += d.speed * (dt / 1000);
        if (d.y > 1.08) { d.y = -0.12; d.x = Math.random(); }
        var x = d.x * this.w;
        var y = d.y * this.h;
        ctx.strokeStyle = 'rgba(198, 220, 238, ' + d.a + ')';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 3, y + d.len * this.h);
        ctx.stroke();
      }

      this.raf = requestAnimationFrame(this._boundTick);
    },

    end: function () {
      if (this.finished || !this.el) return;
      this.finished = true;
      clearTimeout(this.timer);
      cancelAnimationFrame(this.raf);
      this.el.removeEventListener('pointerdown', this._onEnd);
      document.removeEventListener('keydown', this._onEnd);

      var node = this.el;
      node.classList.add('is-done');
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 1300);

      Audio.unlock();
    }
  };

  /* ============================================================
     开机：总闸 → 台灯 → 发射机（三个开关长在房间里）
     ============================================================ */
  var Power = {
    spots: {},
    step: 0,
    done: false,
    onLive: null,
    ORDER: ['main', 'lamp', 'tx'],
    POINTS: {
      main: { x: 79.0, y: 46.5, label: '总闸' },
      lamp: { x: 24.5, y: 55.2, label: '台灯' },
      tx: { x: 54.7, y: 68.8, label: '发射机' }
    },

    init: function () {},

    /* 首次进入：从一片黑里开始 */
    start: function (onLive) {
      this.onLive = onLive || null;
      this.step = 0;
      this.done = false;

      var stage = $('#stage');
      if (stage) {
        stage.classList.remove('is-lamp', 'is-live');
        stage.classList.add('is-dark');
      }
      Scene.setObjective('');
      this.build();
    },

    /* 把三个开关做成墙上的光点，而不是浮在屏幕上的按钮 */
    build: function () {
      var host = $('#hotspots');
      if (!host) return;
      $$('.hotspot.is-power').forEach(function (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
      });
      this.spots = {};
      var self = this;

      this.ORDER.forEach(function (key) {
        var pt = self.POINTS[key];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hotspot is-power';
        btn.style.left = pt.x + '%';
        btn.style.top = pt.y + '%';
        btn.setAttribute('aria-label', pt.label);

        var label = document.createElement('span');
        label.className = 'hotspot-label';
        label.textContent = pt.label;
        btn.appendChild(label);

        btn.addEventListener('click', function () { self.press(key, btn); });
        host.appendChild(btn);
        self.spots[key] = btn;
      });
    },

    /* 读档返回：电一直通着 */
    skip: function () {
      this.step = 3;
      this.done = true;
      this.clear();
      var stage = $('#stage');
      if (stage) {
        stage.classList.remove('is-dark', 'is-lamp');
        stage.classList.add('is-live');
      }
    },

    clear: function () {
      $$('.hotspot.is-power').forEach(function (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
      });
      this.spots = {};
    },

    wrongHint: function (key) {
      if (this.step === 0) {
        return key === 'lamp' ? '没有电，台灯不会亮。先合总闸。' : '发射机没电。先合总闸。';
      }
      if (this.step === 1) {
        return key === 'main' ? '总闸已经合上了。' : '先开台灯，你得看得见。';
      }
      return '都开着了。只差发射机。';
    },

    press: function (key, btn) {
      if (this.done) return;

      if (key !== this.ORDER[this.step]) {
        btn.classList.add('is-wrong');
        setTimeout(function () { btn.classList.remove('is-wrong'); }, 460);
        Audio.sfx('switch');
        Sub.hint(this.wrongHint(key), 2600);
        return;
      }

      btn.classList.add('is-on');
      this.step += 1;

      var stage = $('#stage');

      if (this.step === 1) {
        Audio.sfx('breaker');
        Sub.hint('电表走起来了。桌子左边是台灯。', 3200);
        return;
      }

      if (this.step === 2) {
        Audio.sfx('switch');
        if (stage) { stage.classList.remove('is-dark'); stage.classList.add('is-lamp'); }
        Sub.hint('灯丝亮了。最后一步，把发射机推上去。', 3200);
        return;
      }

      // 发射机：载波接通
      Audio.sfx('switch');
      Audio.powerOn();
      if (stage) { stage.classList.remove('is-lamp'); stage.classList.add('is-live'); }
      this.done = true;
      Sub.hint('载波接通。今晚的频率归你了。', 3000);

      var self = this;
      setTimeout(function () {
        self.clear();
        Pro.sync();
        if (self.onLive) self.onLive();
      }, 900);
    }
  };

  /* ============================================================
     章节卡
     ============================================================ */
  var Card = {
    el: null,

    init: function () {
      this.el = $('#chapter');
    },

    play: function (no, name, sub, done) {
      var el = this.el;
      if (!el) { if (done) done(); return; }

      $('#chapterNo').textContent = no || '';
      $('#chapterName').textContent = name || '';
      $('#chapterSub').textContent = sub || '';

      el.hidden = false;
      el.classList.remove('is-on');
      void el.offsetWidth;

      setTimeout(function () { el.classList.add('is-on'); }, 30);

      setTimeout(function () {
        el.classList.remove('is-on');
        setTimeout(function () {
          el.hidden = true;
          if (done) done();
        }, 900);
      }, 2600);
    }
  };

  /* ============================================================
     游戏主控
     ============================================================ */
  var Game = {
    inGame: false,
    hintedPortrait: false,

    init: function () {
      this.refreshEntry();

      window.addEventListener('resize', function () { Layout.apply(); });
      window.addEventListener('orientationchange', function () {
        setTimeout(function () { Layout.apply(); }, 220);
      });

      document.addEventListener('keydown', this.onKey);
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          Game.save();
          Voice.cancel();
        }
      });
    },

    refreshEntry: function () {
      var progress = Store.get(K.progress, null);
      var tapes = Store.get(K.tapes, []);
      var label = $('#entryStartLabel');
      var hint = $('#menuHint');
      var status = $('#menuStatus');
      var restart = $('#entryRestart');
      var hasSave = !!(progress && progress.prologue);
      var proDone = hasSave && progress.prologue.finished;
      var n1 = progress && progress.night1;
      var n1Done = !!(n1 && n1.finished);
      var n1Ready = proDone && !n1Done;

      if (restart) restart.hidden = !hasSave;

      if (status) {
        if (!hasSave) {
          status.textContent = '序章 · 空频待命';
        } else if (n1Done) {
          status.textContent = '第 1 夜已完成 · 收录 ' + tapes.length + ' 盘';
        } else if (n1Ready) {
          status.textContent = '第 1 夜 · 信号待命';
        } else if (proDone) {
          status.textContent = '序章已完成 · 收录 ' + tapes.length + ' 盘';
        } else {
          status.textContent = '守夜进行中 · 收录 ' + tapes.length + ' 盘';
        }
      }

      if (n1Done) {
        label.textContent = '重听这一夜';
        hint.textContent = '第 2 夜还在路上。';
      } else if (n1Ready) {
        label.textContent = (n1 && n1.step !== 'power') ? '继续第 1 夜' : '进入第 1 夜';
        hint.textContent = '雾里有人在呼叫。';
      } else if (proDone) {
        label.textContent = '重听序章';
        hint.textContent = '柜子里多了一盘没有标签的磁带。';
      } else if (hasSave) {
        label.textContent = '继续守夜';
        hint.textContent = '雨还没停，信号还亮着。';
      } else {
        label.textContent = '开始新游戏';
        hint.textContent = '点击亮着的那盏灯，开始今晚的守夜';
      }
    },

    /* 黑场转场：先压黑，再换画面 */
    fadeTo: function (fn) {
      var f = $('#fade');
      if (!f) { fn(); return; }
      f.classList.add('is-on');
      setTimeout(function () {
        fn();
        setTimeout(function () { f.classList.remove('is-on'); }, 160);
      }, 560);
    },

    restart: function () {
      this.fadeTo(function () {
        try {
          localStorage.removeItem(K.progress);
          localStorage.removeItem(K.tapes);
          localStorage.removeItem(K.ending);
          localStorage.removeItem(K.help);
        } catch (e) {}
        Pro.reset();
        Night1.reset();
        Game.enter();
        Game.refreshEntry();
      });
    },

    /* 自动横屏：进入游戏时借用户手势申请全屏并锁定方向 */
    requestLandscape: function () {
      if (!isTouch()) return;
      var doc = document.documentElement;

      function lockOrientation() {
        try {
          if (window.screen && screen.orientation && screen.orientation.lock) {
            var p = screen.orientation.lock('landscape');
            if (p && p.catch) p.catch(function () {});
          }
        } catch (e) {}
      }

      try {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
          var req = doc.requestFullscreen || doc.webkitRequestFullscreen;
          if (req) {
            var r = req.call(doc);
            if (r && r.then) r.then(lockOrientation).catch(lockOrientation);
            else lockOrientation();
            return;
          }
        }
        lockOrientation();
      } catch (e) {
        lockOrientation();
      }
    },

    enter: function () {
      Audio.unlock();
      this.requestLandscape();

      $('#menu').classList.remove('is-active');
      $('#game').classList.add('is-active');
      this.inGame = true;

      var progress = Store.get(K.progress, null) || {};
      var self = this;

      /* 序章通关后进入第 1 夜 */
      if (progress.chapter === 'night1') {
        Night1.restore(progress.night1);

        setTimeout(function () {
          Layout.apply();
          Scene.load('night1', Night1.area);
          Power.skip();
          Scene.setLight('beacon', Night1.finished);
          Night1.sync();

          Card.play('第 1 夜', '信号', 'MIDNIGHT SIGNAL · NIGHT ONE', function () {
            if (Night1.finished) {
              Sub.hint('信号已经断了。海面上只剩雾。', 3200);
            } else if (!Night1.powered) {
              Sub.hint('收音机是哑的。连指示灯都不亮。', 3600);
            } else if (!Night1.tuned) {
              Sub.hint('只有静电。翻翻值班日志，他知道自己的频道。', 3600);
            } else {
              Sub.hint('他还在那片雾里。', 3000);
            }
          });
        });

        progress.night = '第 1 夜 · 信号';
        progress.at = Date.now();
        Store.set(K.progress, progress);
        $('#tbNight').textContent = progress.night;
        return;
      }

      Pro.restore(progress.prologue);
      var resumed = Pro.introDone;

      setTimeout(function () {
        Layout.apply();
        Scene.load('studio');
        Pro.sync();
        Scene.setLight('beacon', Pro.finished);

        if (resumed) {
          Power.skip();
          Card.play('序章', '空频', 'MIDNIGHT SIGNAL · PROLOGUE', function () {
            self.intro();
          });
        } else {
          Power.start(function () { self.intro(); });
          Card.play('序章', '空频', 'MIDNIGHT SIGNAL · PROLOGUE', function () {
            Sub.hint('屋里是黑的。先把总闸推上去。', 4200);
          });
        }
      });

      progress.night = '序章 · 空频';
      progress.at = Date.now();
      Store.set(K.progress, progress);
      $('#tbNight').textContent = progress.night;
    },

    intro: function () {
      if (Pro.introDone) {
        Sub.hint('雨还在下。', 2200);
        return;
      }
      Pro.introDone = true;

      if (Pro.step === 'explore') {
        Pro.run([
          { who: '', text: '发射机嗡了一声。雨还在敲窗。', voice: 'intro_01' },
          { who: '', text: '今晚是你第一次守夜。', voice: 'intro_02' }
        ], function () {
          Sub.hint('屋子里有几样东西，值得凑近看看。', 3600);
        });
      } else {
        Sub.hint('雨还在下。', 2200);
      }

      if (isIOS() && !Store.get('mrs_ios_hint', false)) {
        Store.set('mrs_ios_hint', true);
        Pro.push(function () {
          Sub.hint('若听不到声音，请检查 iPhone 侧边的静音开关。', 5200);
        }, 8200);
      }

      if (!Layout.landscape && isTouch() && !this.hintedPortrait) {
        this.hintedPortrait = true;
        Pro.push(function () {
          if (Layout.landscape) return;
          Sub.hint('把手机横过来，播音室会更完整。', 3600);
        }, 12000);
      }
    },

    save: function () {
      var progress = Store.get(K.progress, null);
      if (!progress) return;
      progress.prologue = Pro.snapshot();
      if (progress.chapter === 'night1') {
        progress.night1 = Night1.snapshot();
        progress.night = '第 1 夜 · 信号';
      }
      progress.at = Date.now();
      Store.set(K.progress, progress);
    },

    /* 回到主页（ESC / 顶栏「菜单」/ 移动端） */
    toMenu: function () {
      if (!Game.inGame) return;
      Voice.cancel();
      Pro.clearTimers();
      if (Scene.isOpen()) Scene.close();
      Game.save();
      Game.inGame = false;
      Game.fadeTo(function () {
        $('#game').classList.remove('is-active');
        $('#menu').classList.add('is-active');
        Game.refreshEntry();
      });
    },

    onKey: function (e) {
      if (e.key === 'Escape') {
        if (UI.closeTopModal()) return;
        if (Scene.isOpen()) { Scene.close(); return; }
        Game.toMenu();
        return;
      }

      if (!Game.inGame || Scene.isOpen() || UI.anyModalOpen()) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        var spots = $$('.hotspot');
        if (!spots.length) return;
        var idx = spots.indexOf(document.activeElement);
        var dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
        var next = idx < 0 ? 0 : (idx + dir + spots.length) % spots.length;
        e.preventDefault();
        spots[next].focus({ preventScroll: true });
      }
    }
  };

  /* ============================================================
     主循环
     ============================================================ */
  var Loop = {
    last: 0,
    start: function () {
      this.last = performance.now();
      requestAnimationFrame(this.tick);
    },
    tick: function (now) {
      var dt = Math.min(now - Loop.last, 60);
      Loop.last = now;

      Parallax.tick(now);
      if (Game.inGame) {
        Fog.draw(dt);
      }

      requestAnimationFrame(Loop.tick);
    }
  };

  /* ============================================================
     启动
     ============================================================ */
  function boot() {
    Intro.init();
    Voice.init();
    Sub.init();
    Scene.init();
    Inv.init();
    Scene.onAreaChange = function () {
      if (Scene.sceneId !== 'night1') return;
      Night1.area = Scene.area;
      Night1.sync();
    };
    Power.init();
    Card.init();
    Rotate.init();
    UI.init();
    Parallax.init();
    Fog.init();
    Game.init();
    Layout.apply();

    var unlockOnce = function () {
      Audio.unlock();
      document.removeEventListener('pointerdown', unlockOnce);
      document.removeEventListener('keydown', unlockOnce);
    };
    document.addEventListener('pointerdown', unlockOnce);
    document.addEventListener('keydown', unlockOnce);
    // 任何一次点击都再尝试一次雨声/人声（浏览器拒绝自动播放时能自愈）
    document.addEventListener('pointerdown', function () {
      Audio.resumeRain();
      Voice.resume();
    });

    Loop.start();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
