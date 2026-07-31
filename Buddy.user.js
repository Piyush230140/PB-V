// ==UserScript==
// @name         Pixel Buddy - Drink Water Companion
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Animated water reminder companion with right-click settings panel!
// @author       You
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    var defaults = {
        enabled: true,
        intervalMinutes: 30,
        walkSpeed: 1.0,
        size: 200,
        sound: false,
        soundUrl: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'
    };

    var settings = {
        enabled: GM_getValue('enabled', defaults.enabled),
        intervalMinutes: GM_getValue('intervalMinutes', defaults.intervalMinutes),
        walkSpeed: GM_getValue('walkSpeed', defaults.walkSpeed),
        size: GM_getValue('size', defaults.size),
        sound: GM_getValue('sound', defaults.sound)
    };

    // REPLACE THIS URL WITH YOUR DIRECT RAW GITHUB GIF LINK
    var GIF_URL = "https://github.com/Piyush230140/PB-V/blob/main/Use_this_attached_images_as_st-ezgif.com-video-to-gif-converter.gif?raw=true";

    var timerId = null;

    var style = document.createElement('style');
    style.textContent = '' +
        '#pb-companion-container {' +
            'position: fixed;' +
            'bottom: 20px;' +
            'right: 20px;' +
            'z-index: 999999;' +
            'cursor: pointer;' +
            'user-select: none;' +
            'display: none;' +
            'flex-direction: column;' +
            'align-items: center;' +
        '}' +
        '#pb-companion-img {' +
            'height: auto;' +
            'filter: drop-shadow(0px 4px 12px rgba(0,0,0,0.35));' +
        '}' +
        '#pb-settings-modal {' +
            'position: fixed;' +
            'top: 50%;' +
            'left: 50%;' +
            'transform: translate(-50%, -50%);' +
            'width: 320px;' +
            'background: #191428;' +
            'color: #ffffff;' +
            'border-radius: 16px;' +
            'border: 2px solid #ff5ebb;' +
            'box-shadow: 0 10px 30px rgba(0,0,0,0.6);' +
            'font-family: sans-serif;' +
            'z-index: 1000000;' +
            'display: none;' +
            'padding: 20px;' +
            'box-sizing: border-box;' +
        '}' +
        '#pb-settings-header {' +
            'display: flex;' +
            'justify-content: space-between;' +
            'align-items: center;' +
            'font-size: 18px;' +
            'font-weight: bold;' +
            'margin-bottom: 20px;' +
        '}' +
        '.pb-section-title {' +
            'font-size: 11px;' +
            'font-weight: 700;' +
            'color: #a291b9;' +
            'letter-spacing: 1px;' +
            'text-transform: uppercase;' +
            'margin-top: 15px;' +
            'margin-bottom: 10px;' +
        '}' +
        '.pb-setting-row {' +
            'display: flex;' +
            'justify-content: space-between;' +
            'align-items: center;' +
            'margin-bottom: 12px;' +
            'font-size: 14px;' +
        '}' +
        '.pb-checkbox {' +
            'width: 18px;' +
            'height: 18px;' +
            'accent-color: #ff5ebb;' +
            'cursor: pointer;' +
        '}' +
        '.pb-quick-set {' +
            'display: flex;' +
            'gap: 6px;' +
            'margin-top: 6px;' +
        '}' +
        '.pb-btn-quick {' +
            'background: rgba(255, 255, 255, 0.08);' +
            'border: 1px solid #ff5ebb;' +
            'color: #ffbbee;' +
            'padding: 4px 10px;' +
            'border-radius: 8px;' +
            'font-size: 12px;' +
            'cursor: pointer;' +
        '}' +
        '.pb-slider {' +
            'width: 120px;' +
            'accent-color: #ff5ebb;' +
            'cursor: pointer;' +
        '}' +
        '.pb-actions {' +
            'display: flex;' +
            'justify-content: flex-end;' +
            'gap: 10px;' +
            'margin-top: 20px;' +
        '}' +
        '.pb-btn {' +
            'padding: 8px 18px;' +
            'border-radius: 8px;' +
            'border: none;' +
            'font-weight: bold;' +
            'cursor: pointer;' +
            'font-size: 13px;' +
        '}' +
        '.pb-btn-reset {' +
            'background: #39304d;' +
            'color: #d1c4e9;' +
        '}' +
        '.pb-btn-save {' +
            'background: #ff5ebb;' +
            'color: #fff;' +
        '}' +
        '.pb-btn-close {' +
            'background: transparent;' +
            'border: none;' +
            'color: #a291b9;' +
            'font-size: 20px;' +
            'cursor: pointer;' +
        '}';
    document.head.appendChild(style);

    var companion = document.createElement('div');
    companion.id = 'pb-companion-container';

    var img = document.createElement('img');
    img.id = 'pb-companion-img';
    img.src = GIF_URL;
    companion.appendChild(img);
    document.body.appendChild(companion);

    var modal = document.createElement('div');
    modal.id = 'pb-settings-modal';

    var checkedAttr = settings.enabled ? 'checked' : '';
    var soundCheckedAttr = settings.sound ? 'checked' : '';

    modal.innerHTML = '' +
        '<div id="pb-settings-header">' +
            '<span>✨ Pixel Buddy Settings</span>' +
            '<button class="pb-btn-close" id="pb-close-x">✕</button>' +
        '</div>' +
        '<div class="pb-section-title">General</div>' +
        '<div class="pb-setting-row">' +
            '<span>Enable companion</span>' +
            '<input type="checkbox" id="pb-opt-enabled" class="pb-checkbox" ' + checkedAttr + '>' +
        '</div>' +
        '<div class="pb-section-title">Reminders</div>' +
        '<div class="pb-setting-row">' +
            '<span>Interval</span>' +
            '<span id="pb-val-interval" style="color:#ffbbee; font-weight:bold;">' + settings.intervalMinutes + ' min</span>' +
        '</div>' +
        '<div class="pb-quick-set">' +
            '<button class="pb-btn-quick" data-min="1">1m</button>' +
            '<button class="pb-btn-quick" data-min="15">15m</button>' +
            '<button class="pb-btn-quick" data-min="30">30m</button>' +
            '<button class="pb-btn-quick" data-min="60">1h</button>' +
        '</div>' +
        '<div class="pb-section-title">Appearance</div>' +
        '<div class="pb-setting-row">' +
            '<span>Walk speed</span>' +
            '<input type="range" id="pb-opt-speed" class="pb-slider" min="0.5" max="2" step="0.25" value="' + settings.walkSpeed + '">' +
        '</div>' +
        '<div class="pb-setting-row">' +
            '<span>Companion size</span>' +
            '<input type="range" id="pb-opt-size" class="pb-slider" min="100" max="400" step="20" value="' + settings.size + '">' +
        '</div>' +
        '<div class="pb-section-title">Behaviour</div>' +
        '<div class="pb-setting-row">' +
            '<span>Sound</span>' +
            '<input type="checkbox" id="pb-opt-sound" class="pb-checkbox" ' + soundCheckedAttr + '>' +
        '</div>' +
        '<div class="pb-actions">' +
            '<button class="pb-btn pb-btn-reset" id="pb-btn-test">Test Run</button>' +
            '<button class="pb-btn pb-btn-save" id="pb-btn-save">Save</button>' +
        '</div>';

    document.body.appendChild(modal);

    function applyVisualSettings() {
        img.style.width = settings.size + 'px';
    }

    function triggerReminder() {
        if (!settings.enabled) return;
        applyVisualSettings();
        companion.style.display = 'flex';
        if (settings.sound) {
            var audio = new Audio(defaults.soundUrl);
            audio.play().catch(function() {});
        }
        setTimeout(function() {
            companion.style.display = 'none';
        }, 12000);
    }

    function resetTimer() {
        if (timerId) clearInterval(timerId);
        if (settings.enabled) {
            timerId = setInterval(triggerReminder, settings.intervalMinutes * 60 * 1000);
        }
    }

    companion.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        modal.style.display = 'block';
    });

    companion.addEventListener('click', function() {
        companion.style.display = 'none';
    });

    var quickBtns = document.querySelectorAll('.pb-btn-quick');
    for (var i = 0; i < quickBtns.length; i++) {
        quickBtns[i].addEventListener('click', function(e) {
            var mins = parseInt(e.target.getAttribute('data-min'));
            settings.intervalMinutes = mins;
            document.getElementById('pb-val-interval').innerText = mins + ' min';
        });
    }

    document.getElementById('pb-close-x').onclick = function() {
        modal.style.display = 'none';
    };

    document.getElementById('pb-btn-test').onclick = function() {
        modal.style.display = 'none';
        triggerReminder();
    };

    document.getElementById('pb-btn-save').onclick = function() {
        settings.enabled = document.getElementById('pb-opt-enabled').checked;
        settings.walkSpeed = parseFloat(document.getElementById('pb-opt-speed').value);
        settings.size = parseInt(document.getElementById('pb-opt-size').value);
        settings.sound = document.getElementById('pb-opt-sound').checked;

        GM_setValue('enabled', settings.enabled);
        GM_setValue('intervalMinutes', settings.intervalMinutes);
        GM_setValue('walkSpeed', settings.walkSpeed);
        GM_setValue('size', settings.size);
        GM_setValue('sound', settings.sound);

        modal.style.display = 'none';
        resetTimer();
    };

    GM_registerMenuCommand("Pixel Buddy Settings", function() {
        modal.style.display = 'block';
    });

    applyVisualSettings();
    resetTimer();
})();
