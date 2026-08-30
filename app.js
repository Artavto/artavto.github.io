/* =====================================================================
   АРТ АВТО — калькулятор вартості авто з аукціонів США
   ---------------------------------------------------------------------
   Формула повністю з умов замовника. Кожна ставка — у налаштуваннях
   (data.js → ART.cfg), у коді жодного зашитого числа: коли партнери
   піднімуть ціну, це правиться в адмінці, а не тут.

   Порядок такий самий, як у замовника:
     1. авто на аукціоні     лот + збір аукціону + надбавки
     2. доставка             майданчик → порт + море до Клайпеди
     3. Європа               брокер + Ковель
     4. митні платежі        мито, акциз, ПДВ
     5. комісія
   ===================================================================== */
(function () {
'use strict';

var CFG = ART.cfg, LOC = ART.loc;
var $ = function (s) { return document.querySelector(s); };

/* Що обрала людина. Тримаємо в одному місці, щоб не збирати стан
   по полях: саме на цьому в минулому калькуляторі виникали баги, коли
   від попереднього авто лишалась ціна або майданчик. */
var S = {
  auc: 'copart',
  loc: null,        // обраний майданчик
  port: null,       // обраний порт
  lot: null,        // ціна лоту, $
  fee: null,        // збір аукціону, $
  year: null,
  fuel: 'petrol',   // petrol | diesel | hybrid | electric
  cc: null,         // обʼєм двигуна, см³
  kwh: null,        // ємність батареї, кВт·год
  body: 'sedan',    // sedan | suv | big
};

var AUC = [
  ['copart',  'Copart'],
  ['iaai',    'IAAI'],
  ['manheim', 'Manheim'],
  ['canada',  'Канада'],
];
var PORTS = ['NJ', 'GA', 'FL', 'TX', 'CA'];
var FUELS = [
  ['petrol',   'Бензин'],
  ['diesel',   'Дизель'],
  ['hybrid',   'Гібрид'],
  ['electric', 'Електро'],
];
var BODIES = [
  ['sedan', 'Легкове'],
  ['suv',   'Позашляховик'],
  ['big',   'Пікап / великий'],
];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function money(n) {
  return '$' + Math.round(n || 0).toLocaleString('uk-UA').replace(/ /g, ' ');
}
function num(v) {
  var x = parseFloat(String(v == null ? '' : v).replace(',', '.').replace(/[^\d.]/g, ''));
  return isFinite(x) ? x : null;
}

/* Штат витягуємо з назви майданчика: у Copart це «AL - Birmingham»,
   в IAAI — «ADESA Birmingham (AL)». Потрібен, щоб знати про закриті
   штати й утиль у Мічигані. */
function stateOf(l) {
  if (!l) return '';
  var m = /^([A-Z]{2})\s*[-–]/.exec(l.n) || /\(([A-Z]{2})\)/.exec(l.n) ||
          /,\s*([A-Z]{2})\s*$/.exec(l.c || '');
  return m ? m[1] : '';
}

/* ------------------------------------------------------------------ */
/* РОЗРАХУНОК                                                          */
/* ------------------------------------------------------------------ */
/* Повертає список рядків для показу і підсумок. Нічого не малює —
   так його можна перевірити тестом окремо від оформлення. */
function calc() {
  var r = { groups: [], total: 0, ready: true, need: [] };
  var add = function (g, name, sum, note) {
    if (!sum) return;
    g.rows.push({ n: name, v: sum, note: note || '' });
    r.total += sum;
  };

  var lot = S.lot || 0, fee = S.fee || 0;
  var st = stateOf(S.loc);
  var isEV = S.fuel === 'electric' || S.fuel === 'hybrid';
  var isBig = S.body === 'suv' || S.body === 'big';

  /* --- 1. авто --- */
  var g1 = { t: 'Авто на аукціоні', rows: [] };
  if (!lot) r.need.push('ціну лоту');
  add(g1, 'Ціна лоту', lot);
  add(g1, 'Збір аукціону', fee);
  add(g1, 'Комісія партнера', CFG.partnerFee);
  if (CFG.closedStates.states.indexOf(st) > -1)
    add(g1, 'Закритий штат (' + st + ')', CFG.closedStates.fee);
  if (st === 'MI') add(g1, 'Утиль (Мічиган)', CFG.utilMI);
  if (isEV) add(g1, 'Електро / гібрид', CFG.evFee);
  r.groups.push(g1);

  /* --- 2. доставка --- */
  var g2 = { t: 'Доставка до Клайпеди', rows: [] };
  if (!S.loc) r.need.push('майданчик');
  if (!S.port) r.need.push('порт');
  if (S.loc && S.port) {
    add(g2, 'Майданчик → порт', landCost(), portTitle(S.port));
    add(g2, 'Море до Клайпеди', CFG.sea[S.port] || 0);
    if (isEV) add(g2, 'Небезпечний вантаж', CFG.hazFee, 'батарея');
    if (isBig) add(g2, 'Великий кузов', CFG.suvSea);
  }
  r.groups.push(g2);

  /* --- 3. Європа --- */
  var g3 = { t: 'Європа', rows: [] };
  add(g3, 'Брокер у Клайпеді', CFG.broker);
  add(g3, 'Доставка до Ковеля', CFG.kovel);
  r.groups.push(g3);

  /* --- 4. митні платежі --- */
  var g4 = { t: 'Митні платежі', rows: [] };
  var c = customs();
  if (c.ok) {
    add(g4, 'Ввізне мито', c.duty, c.duty ? CFG.dutyPct + '%' : '');
    add(g4, 'Акциз', c.excise, c.exNote);
    add(g4, 'ПДВ', c.vat, CFG.vatPct + '%');
  } else {
    r.need = r.need.concat(c.need);
  }
  r.groups.push(g4);

  /* --- 5. комісія --- */
  var g5 = { t: 'Послуги', rows: [] };
  add(g5, 'Комісія АРТ АВТО', CFG.commission);
  r.groups.push(g5);

  r.ready = r.need.length === 0;
  return r;
}

/* Скільки коштує довезти з майданчика до порту. Для Канади ціна
   залежить від кузова, для США — ні. */
function landCost() {
  if (!S.loc || !S.port) return 0;
  if (S.auc === 'canada')
    return (S.body === 'sedan' ? S.loc.sedan : S.loc.big) || 0;
  return (S.loc.p && S.loc.p[S.port]) || 0;
}

/* Митні платежі України. Формула перевірена на попередньому проєкті —
   збігалась із еталоном до долара.

   Митна вартість = ціна лоту + збір аукціону + фіксовані $1600 доставки.
   Саме так рахує замовник, і саме так вимагає митниця: беруть не
   фактичну доставку, а нормативну.

   Електромобілі мита не платять зовсім — тільки акциз за кВт·год і ПДВ. */
function customs() {
  var out = { ok: false, need: [], duty: 0, excise: 0, vat: 0, exNote: '' };
  var lot = S.lot || 0, fee = S.fee || 0;
  if (!lot) { out.need.push('ціну лоту'); return out; }

  var base = lot + fee + CFG.customsShip;
  var eur = CFG.eur / CFG.usd;          // скільки доларів в одному євро

  if (S.fuel === 'electric') {
    if (!S.kwh) { out.need.push('ємність батареї'); return out; }
    out.excise = S.kwh * CFG.evPerKwh * eur;
    out.exNote = S.kwh + ' кВт·год';
    out.vat = (base + out.excise) * CFG.vatPct / 100;
  } else {
    if (!S.year) { out.need.push('рік випуску'); return out; }
    if (!S.cc)   { out.need.push('обʼєм двигуна'); return out; }
    var age = new Date().getFullYear() - S.year - 1;
    if (age < 1) age = 1;
    var t = (S.fuel === 'diesel') ? CFG.exDiesel : CFG.exPetrol;
    var rate = S.cc > t.border ? t.big : t.small;
    out.excise = (S.cc / 1000) * age * rate * eur;
    out.exNote = age + ' р. · ' + rate + ' € за літр';
    out.duty = base * CFG.dutyPct / 100;
    out.vat = (base + out.duty + out.excise) * CFG.vatPct / 100;
  }
  out.duty = Math.round(out.duty);
  out.excise = Math.round(out.excise);
  out.vat = Math.round(out.vat);
  out.ok = true;
  return out;
}

function portTitle(p) { return CFG.portName[p] || p; }

/* ------------------------------------------------------------------ */
/* ЕКРАН                                                               */
/* ------------------------------------------------------------------ */
function drawAuctions() {
  $('#auc').innerHTML = AUC.map(function (a) {
    return '<option value="' + a[0] + '"' + (S.auc === a[0] ? ' selected' : '') +
           '>' + esc(a[1]) + '</option>';
  }).join('');
}

function search(q) {
  var list = LOC[S.auc] || [];
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  return list.filter(function (l) {
    return (l.n + ' ' + (l.c || '') + ' ' + (l.z || '')).toLowerCase().indexOf(q) > -1;
  }).slice(0, 40);
}

function drawFound(q) {
  var box = $('#found');
  var res = search(q);
  if (!res.length) { box.innerHTML = ''; return; }
  box.innerHTML = res.map(function (l, i) {
    var where = [l.c, l.z].filter(Boolean).join(' · ');
    return '<button type="button" data-i="' + i + '"><b>' + esc(l.n) + '</b>' +
           (where ? '<small>' + esc(where) + '</small>' : '') + '</button>';
  }).join('');
  [].forEach.call(box.querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () {
      S.loc = res[+b.dataset.i];
      S.port = null;
      $('#q').value = '';
      draw();
    });
  });
}

function drawPicked() {
  var box = $('#picked');
  if (!S.loc) { box.innerHTML = ''; box.className = ''; return; }
  var where = [S.loc.c, S.loc.z].filter(Boolean).join(' · ');
  box.className = 'picked';
  box.innerHTML = '<div><b>' + esc(S.loc.n) + '</b>' +
    (where ? '<small>' + esc(where) + '</small>' : '') + '</div>' +
    '<button type="button" id="unpick">змінити</button>';
  $('#unpick').addEventListener('click', function () {
    S.loc = null; S.port = null; draw();
  });
}

/* Порти показуємо тільки ті, куди з цього майданчика справді возять.
   Так неможливо обрати напрямок, якого не існує, — а таких у таблиці
   більшість: у Техас, наприклад, возять лише з чверті майданчиків. */
function drawPorts() {
  var box = $('#ports');
  if (!S.loc) {
    box.className = 'nogo';
    box.textContent = 'Спершу знайдіть майданчик — тоді буде видно, куди звідти возять.';
    return;
  }
  if (S.auc === 'canada') {
    box.className = 'nogo';
    box.textContent = 'Канада: ціна залежить від кузова, порт обирати не треба.';
    if (!S.port) S.port = 'NJ';
    return;
  }
  var have = PORTS.filter(function (p) { return S.loc.p && S.loc.p[p]; });
  if (!have.length) {
    box.className = 'nogo';
    box.textContent = 'З цього майданчика ціни доставки немає в таблиці. ' +
                      'Уточніть у партнерів.';
    return;
  }
  box.className = 'ports';
  box.innerHTML = have.map(function (p) {
    return '<button type="button" data-p="' + p + '"' + (S.port === p ? ' class="on"' : '') +
      '><b>' + esc(portTitle(p)) + '</b><i>' + money(S.loc.p[p]) + '</i></button>';
  }).join('');
  [].forEach.call(box.querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () { S.port = b.dataset.p; draw(); });
  });
}

function drawCar() {
  $('#fuel').innerHTML = FUELS.map(function (f) {
    return '<option value="' + f[0] + '"' + (S.fuel === f[0] ? ' selected' : '') +
           '>' + esc(f[1]) + '</option>';
  }).join('');
  $('#body').innerHTML = BODIES.map(function (b) {
    return '<option value="' + b[0] + '"' + (S.body === b[0] ? ' selected' : '') +
           '>' + esc(b[1]) + '</option>';
  }).join('');
  var ev = S.fuel === 'electric';
  $('#ccBox').style.display = ev ? 'none' : '';
  $('#kwhBox').style.display = ev ? '' : 'none';
}

function drawSum() {
  var r = calc();
  var hero = document.getElementById('hero');
  var card = document.getElementById('sumCard');

  /* Поки бракує даних — плашка сіра й каже, чого саме бракує. Показувати
     нуль або половину суми не можна: людина повірить у неправильну цифру. */
  if (!r.ready) {
    hero.className = 'hero wait';
    hero.innerHTML = '<div class="lb">Ще не рахується</div>' +
      '<div class="need">Вкажіть<b>' + esc(r.need.join(', ')) + '</b></div>';
    card.style.display = 'none';
    return;
  }

  hero.className = 'hero';
  hero.innerHTML = '<div class="lb">Разом під ключ</div>' +
    '<div class="big">' + money(r.total) + '<em>USD</em></div>' +
    '<div class="uah">' + Math.round(r.total * CFG.usd).toLocaleString('uk-UA').replace(/ /g, '\u00A0') +
    ' ₴ за курсом ' + CFG.usd + '</div>';

  var h = '';
  r.groups.forEach(function (g) {
    if (!g.rows.length) return;
    h += '<div class="row grp">' + esc(g.t) + '</div>';
    g.rows.forEach(function (x) {
      h += '<div class="row"><span>' + esc(x.n) +
        (x.note ? ' <i>' + esc(x.note) + '</i>' : '') + '</span><b>' + money(x.v) + '</b></div>';
    });
  });
  h += '<div class="row tot"><span>Разом</span><b>' + money(r.total) + '</b></div>';
  document.getElementById('rows').innerHTML = h;
  card.style.display = '';
}

function draw() {
  drawPicked();
  drawPorts();
  drawCar();
  drawSum();
}

/* ------------------------------------------------------------------ */
function start() {
  drawAuctions();

  $('#auc').addEventListener('change', function () {
    S.auc = this.value; S.loc = null; S.port = null; $('#q').value = ''; $('#found').innerHTML = '';
    draw();
  });
  $('#q').addEventListener('input', function () { drawFound(this.value); });

  [['lot','lot'],['fee','fee'],['year','year'],['cc','cc'],['kwh','kwh']].forEach(function (p) {
    $('#' + p[0]).addEventListener('input', function () { S[p[1]] = num(this.value); drawSum(); });
  });
  $('#fuel').addEventListener('change', function () { S.fuel = this.value; draw(); });
  $('#body').addEventListener('change', function () { S.body = this.value; drawSum(); });

  draw();
}

/* Telegram відкриває це як міні-застосунок; у звичайному браузері
   просто працює як сторінка. */
try {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
} catch (e) {}

start();

/* Свіжі ставки з сервера — але вже ПІСЛЯ того, як калькулятор запрацював
   на вбудованих. Так він відкривається миттєво й працює навіть коли
   сервер лежить: у найгіршому разі цифри будуть учорашні, а не жодних.
   Це рішення навмисне — замовник не має лишитись без калькулятора через
   нашу поломку. */
(function () {
  if (!window.ART_API) return;
  var t = setTimeout(function () { t = 0; }, 6000);   // довго не чекаємо
  fetch(ART_API.replace(/\/+$/, '') + '/cfg', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!t || !d || !d.ok) return;
      clearTimeout(t);
      if (d.cfg) { for (var k in d.cfg) CFG[k] = d.cfg[k]; }
      if (d.loc && d.loc.copart && d.loc.copart.length) {
        for (var g in d.loc) LOC[g] = d.loc[g];
      }
      draw();
    })
    .catch(function () {});
})();
window.__art = { get S() { return S; }, calc: calc, draw: draw };
})();
