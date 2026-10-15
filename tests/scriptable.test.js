// Führt widget/fortschritt-scriptable.js gegen eine strenge Nachbildung der
// Scriptable-API aus (nur Member, die es laut Scriptable-Typdefinitionen gibt).
// So fallen Tippfehler, Laufzeitfehler und falsch geplante Erinnerungen auf,
// ohne dass ein iPhone nötig ist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { computeStats, emptyState, reminderMessage, widgetSummary } from '../js/logic.js';

const SOURCE = fs.readFileSync(new URL('../widget/fortschritt-scriptable.js', import.meta.url), 'utf8');

const MEMBERS = {
  ListWidget:
    'backgroundColor backgroundImage backgroundGradient addAccessoryWidgetBackground spacing url refreshAfterDate addText addDate addImage addSpacer addStack setPadding useDefaultPadding presentSmall presentMedium presentLarge presentExtraLarge presentAccessoryInline presentAccessoryCircular presentAccessoryRectangular',
  WidgetStack:
    'backgroundColor backgroundImage backgroundGradient spacing size cornerRadius borderWidth borderColor url addText addDate addImage addSpacer addStack setPadding useDefaultPadding topAlignContent centerAlignContent bottomAlignContent layoutHorizontally layoutVertically',
  WidgetText:
    'text textColor font textOpacity lineLimit minimumScaleFactor shadowColor shadowRadius shadowOffset url leftAlignText centerAlignText rightAlignText',
  WidgetImage:
    'image resizable imageSize imageOpacity cornerRadius borderWidth borderColor containerRelativeShape tintColor url leftAlignImage centerAlignImage rightAlignImage applyFittingContentMode applyFillingContentMode',
  WidgetSpacer: 'length',
  DrawContext:
    'size respectScreenScale opaque getImage drawImageInRect drawImageAtPoint setFillColor setStrokeColor setLineWidth fill fillRect fillEllipse stroke strokeRect strokeEllipse addPath strokePath fillPath drawText drawTextInRect setFont setTextColor setTextAlignedLeft setTextAlignedCenter setTextAlignedRight',
  Path: 'move addLine addRect addEllipse addRoundedRect addCurve addQuadCurve addLines addRects closeSubpath',
  Notification:
    'identifier title subtitle body preferredContentHeight badge threadIdentifier userInfo sound openURL deliveryDate nextTriggerDate scriptName actions schedule remove setTriggerDate setDailyTrigger setWeeklyTrigger addAction',
  Request: 'url method headers body timeoutInterval response allowInsecureRequest load loadString loadJSON loadImage onRedirect',
  Alert: 'title message addAction addDestructiveAction addCancelAction addTextField addSecureTextField textFieldValue present presentAlert presentSheet',
  SFSymbol:
    'image applyFont applyUltraLightWeight applyThinWeight applyLightWeight applyRegularWeight applyMediumWeight applySemiboldWeight applyBoldWeight applyHeavyWeight applyBlackWeight',
  FileManager:
    'read readString readImage write writeString writeImage remove move copy fileExists isDirectory createDirectory temporaryDirectory cacheDirectory documentsDirectory libraryDirectory joinPath listContents fileName fileExtension',
};
const FONT_STATICS =
  'largeTitle headline subheadline body callout footnote systemFont ultraLightSystemFont thinSystemFont lightSystemFont regularSystemFont mediumSystemFont semiboldSystemFont boldSystemFont heavySystemFont blackSystemFont italicSystemFont regularMonospacedSystemFont boldMonospacedSystemFont regularRoundedSystemFont mediumRoundedSystemFont semiboldRoundedSystemFont boldRoundedSystemFont heavyRoundedSystemFont blackRoundedSystemFont';

// Proxy, der bei unbekannten Membern sofort einen Fehler wirft
function strict(target, kind) {
  const allowed = new Set(MEMBERS[kind].split(' '));
  return new Proxy(target, {
    get(obj, prop) {
      if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON' || prop === 'constructor') return obj[prop];
      if (!allowed.has(prop)) throw new TypeError(`${kind}.${prop} gibt es in Scriptable nicht`);
      return obj[prop];
    },
    set(obj, prop, value) {
      if (!allowed.has(prop)) throw new TypeError(`${kind}.${prop} gibt es in Scriptable nicht`);
      obj[prop] = value;
      return true;
    },
  });
}

function makeEnv({ data, family = null, runsInWidget = !!family, now, pending = [] }) {
  const texts = [];
  const log = { widget: null, alerts: [], scheduled: [], removed: [], presented: [] };
  const store = new Map(pending.map((p) => [p.identifier, p]));

  const container = (kind) => {
    const obj = { size: { width: 0, height: 0 } };
    obj.addText = (t) => {
      texts.push(t);
      return strict({ text: t, centerAlignText() {}, leftAlignText() {}, rightAlignText() {} }, 'WidgetText');
    };
    obj.addImage = (image) =>
      strict(
        { image, centerAlignImage() {}, leftAlignImage() {}, rightAlignImage() {}, applyFittingContentMode() {}, applyFillingContentMode() {} },
        'WidgetImage',
      );
    obj.addSpacer = (length) => strict({ length }, 'WidgetSpacer');
    obj.addDate = () => strict({}, 'WidgetText');
    obj.addStack = () => container('WidgetStack');
    for (const m of [
      'setPadding',
      'useDefaultPadding',
      'topAlignContent',
      'centerAlignContent',
      'bottomAlignContent',
      'layoutHorizontally',
      'layoutVertically',
    ])
      obj[m] = () => {};
    for (const m of [
      'presentSmall',
      'presentMedium',
      'presentLarge',
      'presentExtraLarge',
      'presentAccessoryInline',
      'presentAccessoryCircular',
      'presentAccessoryRectangular',
    ]) {
      obj[m] = async () => log.presented.push(m);
    }
    return strict(obj, kind);
  };

  class ListWidget {
    constructor() {
      return container('ListWidget');
    }
  }
  class Size {
    constructor(width, height) {
      Object.assign(this, { width, height });
    }
  }
  class Point {
    constructor(x, y) {
      Object.assign(this, { x, y });
    }
  }
  class Rect {
    constructor(x, y, width, height) {
      Object.assign(this, { x, y, width, height });
    }
  }
  class Color {
    constructor(hex, alpha = 1) {
      Object.assign(this, { hex, alpha });
    }
    static dynamic(light, dark) {
      return { light, dark };
    }
    static white() {
      return new Color('#ffffff');
    }
  }
  const Font = {};
  for (const name of FONT_STATICS.split(' ')) Font[name] = (size) => ({ name, size });
  class DrawContext {
    constructor() {
      const obj = { getImage: () => ({ image: true }) };
      for (const m of MEMBERS.DrawContext.split(' ')) if (!(m in obj) && !['size', 'respectScreenScale', 'opaque'].includes(m)) obj[m] = () => {};
      return strict(obj, 'DrawContext');
    }
  }
  class Path {
    constructor() {
      const obj = {};
      for (const m of MEMBERS.Path.split(' ')) obj[m] = () => {};
      return strict(obj, 'Path');
    }
  }
  const SFSymbol = {
    named: (name) => strict({ image: { symbol: name }, applyFont() {}, applyBoldWeight() {} }, 'SFSymbol'),
  };
  class Request {
    constructor(url) {
      return strict(
        {
          url,
          timeoutInterval: 60,
          async loadJSON() {
            if (!data) throw new Error('404');
            return JSON.parse(JSON.stringify(data));
          },
        },
        'Request',
      );
    }
  }
  const files = new Map();
  const FileManager = {
    local: () =>
      strict(
        {
          documentsDirectory: () => '/docs',
          joinPath: (a, b) => `${a}/${b}`,
          writeString: (p, s) => files.set(p, s),
          readString: (p) => files.get(p),
          fileExists: (p) => files.has(p),
        },
        'FileManager',
      ),
  };
  class Notification {
    constructor() {
      const obj = {
        identifier: '',
        title: '',
        body: '',
        sound: null,
        threadIdentifier: '',
        trigger: null,
        setTriggerDate(d) {
          obj.trigger = d;
        },
        async schedule() {
          log.scheduled.push({ identifier: obj.identifier, title: obj.title, body: obj.body, at: obj.trigger });
          store.set(obj.identifier, { identifier: obj.identifier, title: obj.title, body: obj.body, nextTriggerDate: obj.trigger });
        },
      };
      const proxy = strict(obj, 'Notification');
      return proxy;
    }
    static async allPending() {
      return [...store.values()];
    }
    static async removePending(ids) {
      for (const id of ids) {
        store.delete(id);
        log.removed.push(id);
      }
    }
  }
  class Alert {
    constructor() {
      const obj = {
        title: '',
        message: '',
        addAction() {},
        async present() {
          log.alerts.push({ title: obj.title, message: obj.message });
          return 0;
        },
      };
      return strict(obj, 'Alert');
    }
  }
  const FIXED = now.getTime();
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(FIXED);
      else super(...args);
    }
    static now() {
      return FIXED;
    }
  }

  const context = vm.createContext({
    ListWidget,
    Size,
    Point,
    Rect,
    Color,
    Font,
    DrawContext,
    Path,
    SFSymbol,
    Request,
    FileManager,
    Notification,
    Alert,
    Date: FakeDate,
    console: { log() {} },
    config: { widgetFamily: family, runsInWidget, runsInApp: !runsInWidget },
    args: { widgetParameter: null },
    Script: {
      setWidget: (w) => (log.widget = w),
      complete() {},
    },
  });
  return { context, log, texts, store };
}

async function run(opts, url = 'https://example.test/fortschritt-widget.json') {
  const env = makeEnv(opts);
  const src = SOURCE.replace("'__DATA_URL__'", JSON.stringify(url));
  await vm.runInContext(`(async () => {\n${src}\n;globalThis.__test = { reminderMessage, todayContext };\n})()`, env.context);
  return env;
}

// ---------------------------------------------------------------- Testdaten

const TODAY = '2026-10-15'; // Donnerstag
const AT_18 = new Date(2026, 9, 15, 18, 0, 0);

function summary({ readToday = 25, workToday = 45 } = {}) {
  const s = emptyState();
  s.profile.name = 'Fabian';
  let n = 0;
  const add = (day, rec) => {
    const id = `s${n++}`;
    s.sessions[id] = { id, day, createdAt: n, updatedAt: n, ...rec };
  };
  for (const day of ['2026-10-12', '2026-10-13', '2026-10-14']) add(day, { kind: 'work', minutes: 70 });
  if (workToday) add(TODAY, { kind: 'work', minutes: workToday });
  if (readToday) add(TODAY, { kind: 'read', pages: readToday, minutes: 30 });
  return JSON.parse(JSON.stringify(widgetSummary(s, computeStats(s, TODAY), 'https://example.test/app/')));
}

// ---------------------------------------------------------------- Tests

test('Widget-Skript nutzt nur echte Scriptable-API – in allen Größen', async () => {
  for (const family of ['small', 'medium', 'large', 'accessoryCircular', 'accessoryRectangular', 'accessoryInline']) {
    const env = await run({ data: summary(), family, now: AT_18 });
    assert.ok(env.log.widget, `${family}: kein Widget gesetzt`);
    assert.ok(env.texts.length > 0, `${family}: kein Text`);
  }
});

test('Widget zeigt Level, Streak und Tagesstand', async () => {
  const env = await run({ data: summary(), family: 'medium', now: AT_18 });
  const all = env.texts.join(' | ');
  assert.match(all, /Level 3 \| Lehrling/);
  assert.match(all, /🔥 4 Tage/);
  assert.match(all, /45\/60 Min/);
  assert.match(all, /25\/20 S\. ✓/);
});

test('Erinnerungen: erledigte Ziele werden heute ausgelassen, Rest für 7 Tage geplant', async () => {
  // Lese-Ziel geschafft → heute weder Lese- noch Streak-Erinnerung; 09:00 ist schon vorbei
  const env = await run({ data: summary(), family: 'small', now: AT_18 });
  const ids = env.log.scheduled.map((n) => n.identifier).sort();
  assert.equal(ids.filter((id) => id.endsWith(TODAY)).length, 0);
  assert.deepEqual(
    ids.filter((id) => id.startsWith('fortschritt:focus:')),
    ['fortschritt:focus:2026-10-16', 'fortschritt:focus:2026-10-19', 'fortschritt:focus:2026-10-20', 'fortschritt:focus:2026-10-21'],
  );
  assert.equal(ids.filter((id) => id.startsWith('fortschritt:read:')).length, 6);
  assert.equal(ids.filter((id) => id.startsWith('fortschritt:streak:')).length, 6);
});

test('Erinnerungen: offenes Ziel heute mit konkretem Text, veraltete werden entfernt', async () => {
  const pending = [
    { identifier: 'fortschritt:read:2026-10-14', title: 'alt', body: '', nextTriggerDate: null },
    { identifier: 'anderes-skript:1', title: 'fremd', body: '', nextTriggerDate: null },
  ];
  const env = await run({ data: summary({ readToday: 0, workToday: 0 }), family: 'small', now: AT_18, pending });
  const today = env.log.scheduled.filter((n) => n.identifier.endsWith(TODAY));
  const read = today.find((n) => n.identifier === `fortschritt:read:${TODAY}`);
  const streak = today.find((n) => n.identifier === `fortschritt:streak:${TODAY}`);
  assert.equal(read.at.getHours(), 20);
  assert.equal(read.at.getMinutes(), 30);
  assert.match(read.body, /20 Seiten warten/);
  assert.match(streak.title, /3-Tage-Streak ist in Gefahr/);
  assert.deepEqual(env.log.removed, ['fortschritt:read:2026-10-14']);
  assert.ok(env.store.has('anderes-skript:1'), 'fremde Mitteilungen bleiben unangetastet');
});

test('Zweiter Lauf plant nichts doppelt', async () => {
  const first = await run({ data: summary(), family: 'small', now: AT_18 });
  const pending = [...first.store.values()];
  const second = await run({ data: summary(), family: 'small', now: AT_18, pending });
  assert.equal(second.log.scheduled.length, 0);
  assert.equal(second.log.removed.length, 0);
});

test('Am Folgetag: Werte zurückgesetzt, Streak bleibt erhalten', async () => {
  const env = await run({ data: summary(), family: 'small', now: new Date(2026, 9, 16, 8, 0, 0) });
  const c = env.context.__test.todayContext(summary(), new Date(2026, 9, 16, 8, 0, 0));
  assert.equal(c.workMin, 0);
  assert.equal(c.readPages, 0);
  assert.equal(c.streak, 4);
  assert.equal(c.todayMet, false);
  const focus = env.log.scheduled.find((n) => n.identifier === 'fortschritt:focus:2026-10-16');
  assert.match(focus.body, /Starte deine erste Fokus-Session/);
});

test('Erinnerungstexte im Skript und in der App sind identisch', async () => {
  const env = await run({ data: summary(), family: 'small', now: AT_18 });
  const scriptMessage = env.context.__test.reminderMessage;
  for (const type of ['focus', 'read', 'streak', 'unbekannt']) {
    for (const c of [
      { workMin: 0, workGoal: 60, readPages: 0, readGoal: 20, streak: 0, todayMet: false, freezes: 0 },
      { workMin: 30, workGoal: 60, readPages: 19, readGoal: 20, streak: 5, todayMet: false, freezes: 1 },
      { workMin: 60, workGoal: 60, readPages: 20, readGoal: 20, streak: 5, todayMet: true, freezes: 0 },
      { workMin: 0, workGoal: 0, readPages: 0, readGoal: 0, streak: null, todayMet: false, freezes: 0 },
    ]) {
      assert.deepEqual(JSON.parse(JSON.stringify(scriptMessage(type, c))), reminderMessage(type, c), `${type} ${JSON.stringify(c)}`);
    }
  }
});

test('Ohne Daten-Link zeigt das Skript einen Hinweis statt abzustürzen', async () => {
  const env = makeEnv({ data: null, family: null, runsInWidget: false, now: AT_18 });
  await vm.runInContext(`(async () => {\n${SOURCE}\n})()`, env.context);
  assert.equal(env.log.alerts[0].title, 'Noch keine Daten');
  assert.deepEqual(env.log.presented, ['presentMedium']);
});

test('In der Scriptable-App: Bestätigung mit Anzahl geplanter Erinnerungen', async () => {
  const env = await run({ data: summary(), family: null, runsInWidget: false, now: AT_18 });
  assert.match(env.log.alerts[0].message, /16 Erinnerungen/);
});
