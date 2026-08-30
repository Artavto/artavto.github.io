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
  car: null,        // що знайшлось за номером лоту
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
/* Те саме, але без долара — для пробігу й інших не-грошей. */
function thou(n) {
  return Math.round(n || 0).toLocaleString('uk-UA').replace(/ /g, '\u00A0');
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

/* Збір аукціону зі ставки. Сходинки: до якої суми — який збір; понад
   останню береться відсоток. Зверху ворота, екозбір і збір за ставку.
   Точні цифри в кожного аукціону свої й міняються — тому вони не тут,
   а в адмінці, і власник тримає їх у відповідності до свого кабінету. */
function auctionFee(price) {
  var g = (CFG.fees && CFG.fees[S.auc]) || null;
  if (!g) return null;
  var out = { base: 0, gate: g.gate || 0, env: g.env || 0, bid: g.bid || 0, pct: false };
  var steps = g.steps || [];
  for (var i = 0; i < steps.length; i++) {
    if (price <= steps[i][0]) { out.base = steps[i][1]; break; }
  }
  if (!out.base) {
    out.base = Math.round(price * (g.pct || 0) / 100);
    out.pct = true;
  }
  out.total = out.base + out.gate + out.env + out.bid;
  return out;
}

/* ------------------------------------------------------------------ */
/* РОЗРАХУНОК                                                          */
/* ------------------------------------------------------------------ */
/* Повертає список рядків для показу і підсумок. Нічого не малює —
   так його можна перевірити тестом окремо від оформлення. */
function calc() {
  var r = { groups: [], total: 0, ready: true, need: [] };
  /* Ключ потрібен, щоб власник міг сховати саме цей рядок від клієнта.
     Сума при цьому нікуди не дінеться — вона вллється у сусідній
     видимий рядок, див. fold() нижче. */
  var add = function (g, key, name, sum, note) {
    if (!sum) return;
    g.rows.push({ k: key, n: name, v: sum, note: note || '' });
    r.total += sum;
  };

  var lot = S.lot || 0;
  var auto = (CFG.feeMode !== 'manual') ? auctionFee(lot) : null;
  var fee = auto ? auto.total : (S.fee || 0);
  var st = stateOf(S.loc);
  var isEV = S.fuel === 'electric' || S.fuel === 'hybrid';
  var isBig = S.body === 'suv' || S.body === 'big';

  /* --- 1. авто --- */
  var g1 = { t: 'Авто на аукціоні', rows: [] };
  if (!lot) r.need.push('ціну лоту');
  add(g1, 'lot', 'Ціна лоту', lot);
  if (auto && lot) {
    add(g1, 'fee', 'Збір аукціону', auto.base, auto.pct ? (CFG.fees[S.auc].pct + '% від ставки') : 'за шкалою');
    add(g1, 'gate', 'Ворота', auto.gate);
    add(g1, 'env', 'Екологічний збір', auto.env);
    add(g1, 'bid', 'Збір за ставку', auto.bid);
  } else {
    add(g1, 'fee', 'Збір аукціону', fee);
  }
  add(g1, 'partnerFee', 'Комісія партнера', CFG.partnerFee);
  if (CFG.closedStates.states.indexOf(st) > -1)
    add(g1, 'closed', 'Закритий штат (' + st + ')', CFG.closedStates.fee);
  if (st === 'MI') add(g1, 'utilMI', 'Утиль (Мічиган)', CFG.utilMI);
  if (isEV) add(g1, 'evFee', 'Електро / гібрид', CFG.evFee);
  r.groups.push(g1);

  /* --- 2. доставка --- */
  var g2 = { t: 'Доставка до Клайпеди', rows: [] };
  if (!S.loc) r.need.push('майданчик');
  if (!S.port) r.need.push('порт');
  if (S.loc && S.port) {
    add(g2, 'land', 'Майданчик → порт', landCost(), portTitle(S.port));
    add(g2, 'sea', 'Море до Клайпеди', CFG.sea[S.port] || 0);
    if (isEV) add(g2, 'haz', 'Небезпечний вантаж', CFG.hazFee, 'батарея');
    if (isBig) add(g2, 'suvSea', 'Великий кузов', CFG.suvSea);
  }
  r.groups.push(g2);

  /* --- 3. Європа --- */
  var g3 = { t: 'Європа', rows: [] };
  add(g3, 'broker', 'Брокер у Клайпеді', CFG.broker);
  add(g3, 'kovel', 'Доставка до Ковеля', CFG.kovel);
  r.groups.push(g3);

  /* --- 4. митні платежі --- */
  var g4 = { t: 'Митні платежі', rows: [] };
  var c = customs();
  if (c.ok) {
    add(g4, 'duty', 'Ввізне мито', c.duty, c.duty ? CFG.dutyPct + '%' : '');
    add(g4, 'excise', 'Акциз', c.excise, c.exNote);
    add(g4, 'vat', 'ПДВ', c.vat, CFG.vatPct + '%');
  } else {
    /* Ціну лоту питає і розрахунок, і митниця — щоб у підказці вона не
       стояла двічі, беремо лише те, чого ще немає в переліку. */
    for (var i = 0; i < c.need.length; i++)
      if (r.need.indexOf(c.need[i]) < 0) r.need.push(c.need[i]);
  }
  r.groups.push(g4);

  /* --- 5. комісія й довільні надбавки --- */
  var g5 = { t: 'Послуги', rows: [] };
  add(g5, 'commission', 'Комісія АРТ АВТО', CFG.commission);

  /* Те, чого не було в первинних умовах. Власник додає рядок в адмінці,
     і він одразу тут — без правки коду й без нової заливки. */
  var ex = CFG.extras || [];
  for (var i = 0; i < ex.length; i++) {
    var e = ex[i];
    if (!e || !e.v) continue;
    var fit =
      e.when === 'always'  ? true :
      e.when === 'suv'     ? S.body === 'suv' :
      e.when === 'big'     ? S.body === 'big' :
      e.when === 'ev'      ? S.fuel === 'electric' :
      e.when === 'hybrid'  ? S.fuel === 'hybrid' :
      e.when === 'diesel'  ? S.fuel === 'diesel' :
      e.when === 'canada'  ? S.auc === 'canada' : false;
    if (fit) add(g5, 'extra' + i, e.n, e.v);
  }
  r.groups.push(g5);

  r.ready = r.need.length === 0;
  fold(r);
  return r;
}

/* Приховані рядки. Власник може не показувати клієнту окремі збори — але
   сума мусить лишитись у підсумку, інакше калькулятор бреше.

   Тому прихована сума не зникає, а вливається в перший видимий рядок
   того ж розділу. Так стовпчик сходиться: клієнт може скласти цифри й
   отримати рівно підсумок. Якщо в розділі не лишилось жодного видимого
   рядка — сума переноситься в перший видимий узагалі.

   Ховати ВСЕ не можна: тоді ні підсумок, ні розклад не мали б сенсу.
   У такому разі показуємо як є. */
function fold(r) {
  var hide = CFG.hide || {};
  var carry = 0, groups = [];

  for (var i = 0; i < r.groups.length; i++) {
    var g = r.groups[i], vis = [], hid = 0;
    for (var j = 0; j < g.rows.length; j++) {
      if (hide[g.rows[j].k]) hid += g.rows[j].v;
      else vis.push(g.rows[j]);
    }
    if (vis.length) {
      /* Куди саме вливати. Ніколи не в «Ціну лоту»: це єдине число, яке
         клієнт вписав сам, і побачити там $10 143 замість своїх $10 000 —
         однозначно виглядає як помилка калькулятора. Беремо перший інший
         рядок, і лише коли іншого немає — доводиться в лот. */
      if (hid) {
        var at = 0;
        while (at < vis.length && vis[at].k === 'lot') at++;
        if (at >= vis.length) at = 0;
        vis[at].v += hid;
        /* Якщо іншого рядка не лишилось і гроші все ж лягли на лот —
           підпис «Ціна лоту» вже неправда. Називаємо чесно. */
        if (vis[at].k === 'lot') { vis[at].n = 'Вартість під ключ'; vis[at].note = ''; }
      }
      groups.push({ t: g.t, rows: vis });
    } else {
      carry += hid;
    }
  }

  if (!groups.length) return;              // сховано геть усе — лишаємо як було
  if (carry) {
    var g0 = groups[0], at0 = 0;
    while (at0 < g0.rows.length && g0.rows[at0].k === 'lot') at0++;
    if (at0 >= g0.rows.length) at0 = 0;
    g0.rows[at0].v += carry;
    if (g0.rows[at0].k === 'lot') { g0.rows[at0].n = 'Вартість під ключ'; g0.rows[at0].note = ''; }
  }
  r.groups = groups;
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
  var lot = S.lot || 0;
  if (!lot) { out.need.push('ціну лоту'); return out; }

  /* Митна вартість = ціна лоту + збір аукціону + фрахт. Збір мусить бути
     ТОЙ САМИЙ, що в розрахунку вище: якщо взяти тут порожнє ручне поле,
     мито, акциз і ПДВ порахуються з меншої суми — і людина недоплатить
     на митниці, дізнавшись про це вже на кордоні. */
  var au = (CFG.feeMode !== 'manual') ? auctionFee(lot) : null;
  var fee = au ? au.total : (S.fee || 0);

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
    /* Коефіцієнт віку за Податковим кодексом: повні календарні роки від
       року, наступного за роком випуску. Закон обмежує його з обох боків —
       не менше 1 і не більше 15. Верхньої межі тут бракувало, і на авто
       2005 року акциз виходив завищеним на третину. */
    var age = new Date().getFullYear() - S.year - 1;
    if (age < 1) age = 1;
    if (age > 15) age = 15;
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
/* ------------------------------------------------------------------
   Пошук авто за номером лоту або VIN
   ------------------------------------------------------------------ */

/* Довідник називає філію «sc - columbia», наша таблиця — «SC - Columbia».
   Звіряємо за повною назвою зі штатом, а НЕ за містом: Columbia у списку
   дві (Міссурі й Південна Кароліна), і за містом калькулятор мовчки взяв
   би не ту доставку. Якщо точного збігу немає — краще не підставляти
   нічого, ніж підставити сусідній штат. */
function matchBranch(branch) {
  var b = String(branch || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!b) return null;
  var groups = ['copart', 'iaai', 'manheim', 'canada'];
  for (var gi = 0; gi < groups.length; gi++) {
    var list = LOC[groups[gi]] || [];
    for (var i = 0; i < list.length; i++) {
      var n = String(list[i].n || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (n === b) return { auc: groups[gi], loc: list[i] };
    }
  }
  return null;
}

function lotMsg(text, kind) {
  var e = $('#lotMsg');
  e.textContent = text || '';
  e.className = 'msg' + (text ? ' ' + (kind || 'inf') : ' hide');
}

/* Підставляємо лише те, що знаємо напевно. Порожнє поле людина заповнить
   сама; невірно підставлене — не помітить, і воно піде в розрахунок. */
function useCar(c) {
  S.car = c;
  if (c.year) S.year = c.year;
  if (c.cc)   S.cc = c.cc;
  if (c.fuel) S.fuel = c.fuel;
  if (c.body) S.body = c.body;

  var m = matchBranch(c.branch);
  if (m) {
    S.auc = m.auc;
    S.loc = m.loc;
    S.port = null;
    drawAuctions();
  }

  $('#year').value = S.year || '';
  $('#cc').value = S.cc || '';
  draw();

  var miss = [];
  if (!m && c.branch) miss.push('майданчик «' + c.branch + '» не знайшовся в таблиці');
  if (!c.fuel) miss.push('паливо');
  if (!c.body) miss.push('тип кузова');
  lotMsg(miss.length
    ? 'Знайшли. Перевірте вручну: ' + miss.join(', ') + '.'
    : 'Знайшли. Лишилось вписати ціну лоту й збір аукціону.',
    miss.length ? 'er' : 'inf');
}

function drawCarFound() {
  var box = $('#carBox');
  if (!S.car) { box.innerHTML = ''; return; }
  var c = S.car;
  var bits = [];
  if (c.odo) bits.push(thou(c.odo) + ' миль');
  if (c.damage) bits.push(c.damage);
  if (c.branch) bits.push(c.branch.toUpperCase());

  var ph = c.photos || [];
  var first = ph.length ? ph[0].t : (c.photo || '');

  /* Скільки днів запису. У старих лотів джерело вже прибрало фото, а
     пробіг і пошкодження лишились торішні — і саме про це треба сказати:
     порахувати суму по торішніх даних людина може, а знати, що вони
     торішні, — ні. */
  var old = 0;
  if (c.upd && /^\d{4}-\d{2}-\d{2}$/.test(c.upd)) {
    var tms = Date.parse(c.upd + 'T12:00:00');
    if (isFinite(tms)) old = Math.floor((Date.now() - tms) / 86400000);
  }

  box.innerHTML =
    '<div class="car">' +
      (first
        ? '<img src="' + esc(first) + '" alt="" referrerpolicy="no-referrer">'
        : '<span class="nopic">' + picIcon() + '</span>') +
      '<div><b>' + esc(c.title || 'Авто') + '</b>' +
      '<small><span class="lotno">' + esc(c.lotNo || '') + '</span>' +
        (bits.length ? ' · ' + esc(bits.join(' · ')) : '') + '</small>' +
      (c.vin ? '<small>' + esc(c.vin) + '</small>' : '') +
      '</div>' +
    '</div>' +
    (ph.length > 1
      ? '<div class="shots">' + ph.map(function (x, i) {
          /* Без відкладеного завантаження: дванадцять мініатюр важать 48 КБ,
             а «lazy» додає лише спосіб не завантажитись зовсім. */
          return '<img src="' + esc(x.t) + '" alt="" referrerpolicy="no-referrer" data-i="' + i + '">';
        }).join('') + '</div>'
      : '') +
    (old > 60
      ? '<div class="stale">Дані про лот від ' + esc(dateTxt(c.upd)) + ' — це ' +
        esc(monthsTxt(old)) + ' тому. Фото за цей час прибрали, а пробіг і ' +
        'пошкодження могли змінитись. Стан авто звіряйте на аукціоні.</div>'
      : (!ph.length
          ? '<div class="stale">Фотографій до цього лота джерело не дає.</div>'
          : ''));

  [].forEach.call(box.querySelectorAll('.shots img'), function (im) {
    im.addEventListener('click', function () { openShot(+im.dataset.i); });
  });
  if (first) {
    var big = box.querySelector('.car img');
    if (big && ph.length) big.addEventListener('click', function () { openShot(0); });
  }
}

/* Перегляд на весь екран. Велике фото тягнемо лише тут — у смужці
   мініатюри по 4 КБ, і дванадцять із них важать менше за одне велике. */
var SHOT = 0;

function openShot(i) {
  var ph = (S.car && S.car.photos) || [];
  if (!ph.length) return;
  SHOT = Math.max(0, Math.min(i, ph.length - 1));

  var v = $('#viewer');
  v.className = 'viewer';
  v.innerHTML =
    '<button type="button" class="cl" id="vClose" aria-label="Закрити">×</button>' +
    '<button type="button" class="nav pv" id="vPrev" aria-label="Назад">‹</button>' +
    '<img id="vImg" src="' + esc(ph[SHOT].f) + '" alt="" referrerpolicy="no-referrer">' +
    '<button type="button" class="nav nx" id="vNext" aria-label="Далі">›</button>' +
    '<div class="cnt" id="vCnt">' + (SHOT + 1) + ' / ' + ph.length + '</div>';

  $('#vClose').addEventListener('click', closeShot);
  $('#vPrev').addEventListener('click', function () { stepShot(-1); });
  $('#vNext').addEventListener('click', function () { stepShot(1); });
  v.addEventListener('click', function (e) { if (e.target === v) closeShot(); });
  document.addEventListener('keydown', shotKey);
  document.body.style.overflow = 'hidden';
}

function stepShot(d) {
  var ph = (S.car && S.car.photos) || [];
  if (!ph.length) return;
  SHOT = (SHOT + d + ph.length) % ph.length;
  $('#vImg').src = ph[SHOT].f;
  $('#vCnt').textContent = (SHOT + 1) + ' / ' + ph.length;
}

function closeShot() {
  var v = $('#viewer');
  v.className = ''; v.innerHTML = '';
  document.removeEventListener('keydown', shotKey);
  document.body.style.overflow = '';
}

function shotKey(e) {
  if (e.key === 'Escape') closeShot();
  else if (e.key === 'ArrowLeft') stepShot(-1);
  else if (e.key === 'ArrowRight') stepShot(1);
}

/* 2025-08-21 → 21.08.2025 */
function dateTxt(iso) {
  var p = String(iso || '').split('-');
  return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : String(iso || '');
}

/* «майже рік», «8 місяців» — людською мовою й з правильним закінченням.
   Сухе «427 днів» ніхто в голові не переводить. */
function monthsTxt(days) {
  if (days >= 700) return 'понад два роки';
  if (days >= 330) return 'майже рік';
  var m = Math.round(days / 30.4);
  if (m < 2) return 'близько місяця';
  var last = m % 10, two = m % 100;
  var word = (last === 1 && two !== 11) ? 'місяць'
           : (last >= 2 && last <= 4 && (two < 12 || two > 14)) ? 'місяці' : 'місяців';
  return m + ' ' + word;
}

/* Значок замість фото. Порожнє місце в картці читається як поломка,
   а значок — як «фото немає». Це різні речі. */
function picIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2v8.6l4.2-4.2 ' +
    '3.1 3.1 3-3L19 14V7H5Zm3.6 1.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Z"/></svg>';
}

function seekLot() {
  var q = String($('#lotq').value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (q.length < 6) { lotMsg('Вкажіть номер лоту (8 цифр) або VIN (17 знаків).', 'er'); return; }
  if (!window.ART_API) { lotMsg('Пошук недоступний — заповніть поля вручну.', 'er'); return; }

  $('#lotgo').disabled = true;
  lotMsg('Шукаю…', 'inf');

  var done = false;
  var t = setTimeout(function () {
    if (done) return;
    done = true; $('#lotgo').disabled = false;
    lotMsg('Довго немає відповіді. Заповніть поля вручну.', 'er');
  }, 15000);

  fetch(ART_API.replace(/\/+$/, '') + '/lot?v=' + encodeURIComponent(q), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (done) return;
      done = true; clearTimeout(t); $('#lotgo').disabled = false;
      if (!d || !d.ok) { S.car = null; drawCarFound(); lotMsg((d && d.error) || 'Не знайшли.', 'er'); return; }
      useCar(d.car);
      drawCarFound();
    })
    .catch(function () {
      if (done) return;
      done = true; clearTimeout(t); $('#lotgo').disabled = false;
      lotMsg('Пошук не відповідає. Заповніть поля вручну.', 'er');
    });
}

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

  /* Коли збір рахується за шкалою, поле для нього тільки заплутує:
     людина вписала б своє число, а розрахунок узяв би інше. */
  var auto = CFG.feeMode !== 'manual' && CFG.fees && CFG.fees[S.auc];
  $('#feeBox').style.display = auto ? 'none' : '';
  $('#lotBox').className = auto ? 'fld' : 'fld half';
}

/* Контакти показуємо тільки якщо власник їх вписав: порожній блок з
   написом «звʼязок» гірший, ніж його відсутність. */
/* Український номер показуємо як його читають уголос: +38 067 123 45 67.
   Голий рядок цифр виглядає як помилка, а не як телефон. */
function phoneText(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10 && d[0] === '0') d = '38' + d;          // 067…
  if (d.length === 11 && d.slice(0, 2) === '80') d = '3' + d; // 8067…
  if (d.length === 12 && d.slice(0, 2) === '38')
    return '+38 ' + d.slice(2, 5) + ' ' + d.slice(5, 8) + ' ' + d.slice(8, 10) + ' ' + d.slice(10);
  return String(raw || '').trim();
}
function phoneHref(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10 && d[0] === '0') d = '38' + d;
  return '+' + d;
}

var ICON = {
  phone: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.6 3.2 8 6.1 6.5 7.6a10 10 0 0 0 5.9 5.9L14 12l2.9 1.4c.6.3.9 1 .7 1.6l-.5 1.6a1.5 1.5 0 0 1-1.7 1A15.5 15.5 0 0 1 2.4 4.6a1.5 1.5 0 0 1 1-1.7l1.6-.5c.6-.2 1.3.1 1.6.7Z"/></svg>',
  tg:    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M17.6 3.3 2.4 9.1c-.7.3-.7 1.2 0 1.4l3.8 1.2 1.4 4.3c.2.6 1 .8 1.4.3l2-2.1 3.9 2.9c.5.4 1.2.1 1.3-.5l2.4-12c.2-.7-.5-1.3-1-1.3ZM7.9 11.6l7-4.4-5.6 5.2-.3 2.5-1.1-3.3Z"/></svg>',
  site:  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm5.9 7.6h-2.5a13 13 0 0 0-1-4.3 6.9 6.9 0 0 1 3.5 4.3ZM10 3.2c.6.9 1.3 2.7 1.5 5.9h-3c.2-3.2.9-5 1.5-5.9ZM4.1 9.1a6.9 6.9 0 0 1 3.5-4.3 13 13 0 0 0-1 4.3H4.1Zm0 1.8h2.5c.1 1.7.4 3.1 1 4.3a6.9 6.9 0 0 1-3.5-4.3Zm5.9 5.9c-.6-.9-1.3-2.7-1.5-5.9h3c-.2 3.2-.9 5-1.5 5.9Zm2.4-1.6c.5-1.2.9-2.6 1-4.3h2.5a6.9 6.9 0 0 1-3.5 4.3Z"/></svg>',
};

/* Кнопка з написом «що це» і «куди веде»: людина має розуміти, що
   станеться після натискання, ще до натискання. */
function talkBtn(kind, title, sub, href, blank) {
  return '<a class="tb" href="' + esc(href) + '" data-kind="' + kind + '"' +
    (blank ? ' target="_blank" rel="noopener"' : '') + '>' +
    '<span class="ic">' + ICON[kind] + '</span>' +
    '<span class="tx"><b>' + esc(title) + '</b><i>' + esc(sub) + '</i></span>' +
    '</a>';
}

/* Читаємо Telegram щоразу, а не один раз при завантаженні: порядок
   завантаження скриптів — не те, на що варто спиратись. */
function tgApp() {
  try { return (window.Telegram && window.Telegram.WebApp) || null; }
  catch (e) { return null; }
}

/* Усередині Telegram звичайне посилання нікуди не веде: вебперегляд не
   випускає ні tel:, ні зовнішній сайт. Для сайту й Telegram у нього є
   свої виклики, а для телефона — немає жодного.

   Тому на телефон робимо дві дії одразу: пробуємо відкрити набирач і
   копіюємо номер. Якщо набирач відкрився — людина його вже не побачить.
   Якщо ні — номер у неї в буфері, і про це сказано. Головне, щоб
   натискання ніколи не лишалось без наслідків. */
function talkGo(e, a) {
  var kind = a.dataset.kind, href = a.getAttribute('href');
  var T = tgApp();

  if (kind === 'tg' && T && T.openTelegramLink) {
    e.preventDefault(); T.openTelegramLink(href); return;
  }
  if (kind === 'site' && T && T.openLink) {
    e.preventDefault(); T.openLink(href); return;
  }
  if (kind !== 'phone') return;

  var num = href.replace(/^tel:/, '');
  copyNum(num);
  try { window.location.href = href; } catch (err) {}
  e.preventDefault();
  say(a, 'Номер скопійовано: ' + phoneText(num));
}

function copyNum(num) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(num); return;
    }
  } catch (e) {}
  /* Запасний спосіб для старих вебпереглядів: поле мусить бути в
     сторінці, інакше на iPhone копіювання мовчки не спрацює. */
  try {
    var t = document.createElement('textarea');
    t.value = num;
    t.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(t);
    t.select(); t.setSelectionRange(0, 99);
    document.execCommand('copy');
    document.body.removeChild(t);
  } catch (e) {}
}

/* Коротке повідомлення під кнопкою. Своє, а не alert: alert у Telegram
   виглядає як помилка застосунку. */
var SAY_T = 0;
function say(near, text) {
  var box = $('#saidIt');
  if (!box) {
    box = document.createElement('div');
    box.id = 'saidIt';
    box.className = 'said';
    document.body.appendChild(box);
  }
  box.textContent = text;
  box.className = 'said on';
  clearTimeout(SAY_T);
  SAY_T = setTimeout(function () { box.className = 'said'; }, 2600);
}

function drawContacts() {
  var c = CFG.contacts || {};
  var box = $('#contacts');
  if (!box) return;

  var out = [];
  if (c.phone)
    out.push(talkBtn('phone', 'Зателефонувати', phoneText(c.phone), 'tel:' + phoneHref(c.phone)));
  if (c.tg) {
    var u = c.tg.replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
    out.push(talkBtn('tg', 'Написати в Telegram', '@' + u, 'https://t.me/' + u, true));
  }
  if (c.site) {
    var w = c.site.replace(/^https?:\/\//, '').replace(/\/$/, '');
    out.push(talkBtn('site', 'Сайт', w, 'https://' + w, true));
  }

  if (!out.length && !c.note) { box.innerHTML = ''; box.className = ''; return; }
  box.className = 'card glass talk';
  box.innerHTML =
    '<h2>Маєте питання<u></u></h2>' +
    (out.length ? '<div class="links">' + out.join('') + '</div>' : '') +
    (c.note ? '<div class="hint">' + esc(c.note) + '</div>' : '');

  [].forEach.call(box.querySelectorAll('a.tb'), function (a) {
    a.addEventListener('click', function (e) { talkGo(e, a); });
  });
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
    $('#bar').className = 'bar';         // поки нема суми — смужки теж нема
    return;
  }

  var uah = Math.round(r.total * CFG.usd).toLocaleString('uk-UA').replace(/ /g, '\u00A0');

  hero.className = 'hero';
  hero.innerHTML = '<div class="lb">Разом під ключ</div>' +
    '<div class="big">' + money(r.total) + '<em>USD</em></div>' +
    '<div class="uah">' + uah + ' ₴ за курсом ' + esc(CFG.usd) + '</div>';

  $('#bar').innerHTML =
    '<div><div class="lb">Разом під ключ</div>' +
    '<div class="vv">' + money(r.total) + '</div></div>' +
    '<div class="uah">' + uah + ' ₴</div>';

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
  drawContacts();
  drawCarFound();
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

  $('#lotgo').addEventListener('click', seekLot);
  $('#lotq').addEventListener('keydown', function (e) { if (e.key === 'Enter') seekLot(); });

  [['lot','lot'],['fee','fee'],['year','year'],['cc','cc'],['kwh','kwh']].forEach(function (p) {
    $('#' + p[0]).addEventListener('input', function () { S[p[1]] = num(this.value); drawSum(); });
  });
  $('#fuel').addEventListener('change', function () { S.fuel = this.value; draw(); });
  $('#body').addEventListener('change', function () { S.body = this.value; drawSum(); });

  /* Смужка з підсумком зʼявляється, коли велика плашка пішла за екран.
     Так сума завжди під рукою, але не займає третину телефона, поки
     людина заповнює поля. */
  var hero = $('#hero');
  var onScroll = function () {
    var gone = hero.getBoundingClientRect().bottom < 4;
    var bar = $('#bar');
    var want = (gone && bar.innerHTML) ? 'bar on' : 'bar';
    if (bar.className !== want) bar.className = want;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  $('#bar').addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  onScroll();

  /* Клавіатура на телефоні не має свого «готово» для числових полів —
     тому ховаємо її дотиком будь-де поза полем. Без цього вона стоїть і
     закриває половину екрана, де саме й зʼявляється відповідь. */
  document.addEventListener('touchstart', function (e) {
    var a = document.activeElement;
    if (!a || (a.tagName !== 'INPUT' && a.tagName !== 'SELECT')) return;
    if (e.target === a || (e.target.closest && e.target.closest('.seek'))) return;
    a.blur();
  }, { passive: true });
  document.addEventListener('mousedown', function (e) {
    var a = document.activeElement;
    if (a && a.tagName === 'INPUT' && e.target !== a &&
        !(e.target.closest && e.target.closest('.found, .seek'))) a.blur();
  });

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
/* Вікно для перевірок. Тільки читання стану — жодної логіки тут немає,
   тому воно нічого не може зламати, зате дозволяє прогнати розрахунок
   на справжньому коді, а не на копії. */
window.__art = {
  get S() { return S; }, get CFG() { return CFG; }, get LOC() { return LOC; },
  calc: calc, draw: draw,
};
})();
