const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(process.env.PARLINK_APP_FILE || path.join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Execute the full app with synthetic DOM, storage and location inputs.
// These tests do not claim to verify browser permissions or real GPS accuracy.
function app(storage = new Map(), options = {}) {
  const elements = new Map();
  const inputs = [];
  const windowEvents = {};
  const selection = { format: 'stroke', playerIds: ['brad'] };
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: '', textContent: '', value: '',
      classList: { add() {}, remove() {} }
    });
    return elements.get(id);
  }
  const context = vm.createContext({
    structuredClone,
    confirm: () => options.confirm !== false,
    setTimeout() { return 0; },
    window: { addEventListener(name, callback) { windowEvents[name] = callback; }, scrollTo() {}, location: { reload() {} } },
    document: {
      body: { appendChild() {} },
      createElement(tag) {
        assert.equal(tag, 'input');
        const input = { addEventListener() {}, click() {}, remove() {} };
        inputs.push(input);
        return input;
      },
      getElementById: element,
      querySelector(selector) {
        return selector === '.seg.active' ? { dataset: { format: selection.format } } : null;
      },
      querySelectorAll(selector) {
        return selector === '.pill.active' ? selection.playerIds.map(id => ({ dataset: { playerSelect: id } })) : [];
      }
    },
    navigator: options.navigator || {},
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) {
        if (options.failWrite?.(key)) throw new Error('Fixture storage unavailable');
        storage.set(key, String(value));
      },
      removeItem: key => storage.delete(key)
    }
  });
  vm.runInContext(script, context, { timeout: 1000 });
  const run = code => vm.runInContext(code, context, { timeout: 1000 });
  const value = code => JSON.parse(JSON.stringify(run(code)));
  function round(format = 'stroke', playerIds = ['brad']) {
    selection.format = format;
    selection.playerIds = playerIds;
    element('round-course').value = 'demo';
    run("setView('play')");
    run('startRound()');
  }
  return { run, value, round, storage, element, inputs, windowEvents };
}

test('homepage starts and renders V1.5.1', () => {
  const a = app();
  assert.match(a.element('app').innerHTML, /ParLink V1\.5\.1/);
  assert.equal(a.run('APP_KEY'), 'parlink.v1');
});

test('unmapped courses have no centre or nearby-course match', () => {
  const a = app();
  a.run('gpsPosition={latitude:-35,longitude:150,accuracy:5,timestamp:Date.now()}');
  assert.equal(a.run('courseCenter(state.courses[0])'), null);
  assert.equal(a.run('distanceToCourse(state.courses[0])'), null);
  assert.equal(a.run('nearestCourse()'), null);
});

test('partial course mapping averages only valid coordinates', () => {
  const a = app();
  const centre = a.value(`courseCenter({holes:[
    {lat:-35,lng:150},{lat:'-35.2',lng:'150.2'},
    {lat:null,lng:null},{lat:'',lng:' '},
    {lat:91,lng:150},{lat:-35,lng:181},
    {lat:false,lng:false},{lat:[],lng:[]}
  ]})`);
  assert.ok(Math.abs(centre.lat - (-35.1)) < 1e-10);
  assert.ok(Math.abs(centre.lng - 150.1) < 1e-10);
});

test('invalid green values never produce a distance', () => {
  const a = app();
  a.run('gpsPosition={latitude:0,longitude:0,accuracy:5,timestamp:Date.now()}');
  const invalid = [null, undefined, '', ' ', false, [], {}, 'unknown', NaN, Infinity];
  for (const v of invalid) {
    const literal = v === undefined ? 'undefined' : Number.isNaN(v) ? 'NaN' : v === Infinity ? 'Infinity' : JSON.stringify(v);
    assert.equal(a.run(`currentDistance({lat:${literal},lng:150})`), null);
    assert.equal(a.run(`currentDistance({lat:-35,lng:${literal}})`), null);
  }
  assert.equal(a.run('currentDistance({lat:91,lng:150})'), null);
  assert.equal(a.run('currentDistance({lat:-35,lng:181})'), null);
});

test('valid zero coordinates and numeric strings remain supported', () => {
  const a = app();
  a.run('gpsPosition={latitude:0,longitude:0,accuracy:5,timestamp:Date.now()}');
  assert.deepEqual(a.value("courseCenter({holes:[{lat:'0',lng:'0'}]})"), { lat: 0, lng: 0 });
  assert.equal(a.run("currentDistance({lat:'0',lng:'0'})"), 0);
  assert.ok(Math.abs(a.run('haversine(0,0,0,1)') - 111195) < 1);
});

test('nearby-course lookup ignores unmapped courses', () => {
  const a = app();
  a.run(`gpsPosition={latitude:-35,longitude:150,accuracy:5,timestamp:Date.now()};
    state.courses.push({id:'mapped',name:'Mapped fixture',activated:true,holes:[{lat:-35,lng:150}]});`);
  assert.equal(a.run('nearestCourse().c.id'), 'mapped');
  assert.equal(a.run('nearestCourse().d'), 0);
});

test('zero-metre round shows zero and no example or carry-club advice', () => {
  const a = app();
  a.round();
  a.run(`gpsPosition={latitude:-35,longitude:150,accuracy:5,timestamp:Date.now()};
    state.activeRound.courseSnapshot.holes[0].lat=-35;
    state.activeRound.courseSnapshot.holes[0].lng=150;
    roundCaddie();`);
  const modal = a.run('modal');
  assert.match(modal, /club-rec">0 m/);
  assert.doesNotMatch(modal, /135 m|Safe option|normal carry/);
  assert.match(a.run('roundView()'), /gps-number">0<\/div><div class="gps-label">metres to green centre/);
});

test('missing distance retains the explicitly labelled example', () => {
  const a = app();
  a.round();
  a.run('roundCaddie()');
  assert.match(a.run('modal'), /target 135 m/);
  assert.match(a.run('modal'), /showing a 135 m example/);
});

test('real supplied target and custom club carries drive the advice', () => {
  const a = app();
  a.round();
  a.run(`gpsPosition={latitude:0,longitude:0,accuracy:5,timestamp:Date.now()};
    state.activeRound.courseSnapshot.holes[0].lat=0;
    state.activeRound.courseSnapshot.holes[0].lng=0.001214084432;
    state.profile.clubs=[{name:'Fixture short',carry:120},{name:'Fixture long',carry:138}];
    roundCaddie();`);
  assert.match(a.run('modal'), /target 135 m/);
  assert.match(a.run('modal'), /club-rec">Fixture long/);
  assert.doesNotMatch(a.run('modal'), /showing a 135 m example/);
  a.run('state.profile.clubs=[]');
  assert.match(a.run('caddieRecommendation(135)'), /Add club distances/);
});

test('saved scores, club distances and profile survive a reload', () => {
  const a = app();
  a.round();
  a.run(`state.profile.name='Regression fixture';
    state.profile.clubs=[{name:'Fixture iron',carry:127}];
    state.activeRound.scores.brad[0]=5;
    save();`);
  const before = a.storage.get('parlink.v1');
  const b = app(a.storage);
  assert.equal(b.run('state.profile.name'), 'Regression fixture');
  assert.deepEqual(b.value('state.profile.clubs'), [{ name: 'Fixture iron', carry: 127 }]);
  assert.equal(b.run('state.activeRound.scores.brad[0]'), 5);
  assert.equal(b.storage.get('parlink.v1'), before);
});

test('old address redirects to the homepage with query and fragment intact', () => {
  const redirect = fs.readFileSync(path.join(__dirname, 'index-15.html'), 'utf8');
  const redirectScript = redirect.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const [search, hash, expected] of [
    ['', '', '/'],
    ['?round=demo', '#caddie', '/?round=demo#caddie'],
    ['?name=A%26B', '#play', '/?name=A%26B#play']
  ]) {
    let destination;
    vm.runInNewContext(redirectScript, { window: { location: { search, hash, replace: value => { destination = value; } } } });
    assert.equal(destination, expected);
  }
});

for (const format of ['stroke', 'stableford', 'ambrose']) {
  for (const players of [['brad'], ['brad', 'paul', 'andrew', 'wayne']]) {
    test(`${format}: finish 18 demo holes with ${players.length} players and reopen`, () => {
      const a = app();
      a.round(format, players);
      for (let hole = 1; hole <= 18; hole++) {
        for (const pid of players) a.run(`changeScore(${JSON.stringify(pid)}, 0)`);
        if (hole < 18) a.run('nextHole()');
      }
      a.run('finishRound()');
      assert.equal(a.run('state.activeRound'), null);
      assert.equal(a.run('state.rounds.length'), 1);
      assert.match(a.element('app').innerHTML, /Round complete/);
      assert.match(a.element('app').innerHTML, new RegExp(`${players.length} player${players.length === 1 ? '' : 's'}`));
      const completed = a.value('state.rounds[0]');
      assert.deepEqual(completed.playerIds, players);
      assert.equal(completed.results[0].gross, 72);
      assert.equal(completed.results[0].points, 54);
      a.run('finishRound()');
      assert.equal(a.run('state.rounds.length'), 1, 'duplicate finish does not save twice');
      a.run("actions['close-modal']()");
      assert.match(a.element('app').innerHTML, /Round history/);
      a.run("setView('home')");
      assert.match(a.element('app').innerHTML, /Last round/);
      const saved = a.storage.get('parlink.v1');
      const b = app(a.storage);
      assert.match(b.element('app').innerHTML, /Last round/);
      assert.deepEqual(b.value('state.rounds[0]'), completed);
      assert.equal(b.storage.get('parlink.v1'), saved);
      b.run("setView('stats')");
      assert.match(app(b.storage).element('app').innerHTML, /Round history/);
      b.run("openShareRound(state.rounds[0].id)");
      assert.match(b.element('app').innerHTML, /Share round/);
    });
  }
}

test('already-saved V1.4 round reopens without rewriting scores, profile or courses', () => {
  const a = app();
  a.round();
  a.run(`state.profile.name='Recovery fixture';
    state.profile.clubs=[{name:'Fixture iron',carry:127}];
    state.activeRound.scores.brad=state.courses[0].holes.map(h=>h.par+1);
    state.rounds=[{...state.activeRound,completedAt:'2026-10-30T12:00:00.000Z',
      courseName:'ParLink Demo Course',results:[{playerId:'brad',name:'Recovery fixture',gross:90,net:72,points:36,toPar:18,handicapUsed:18,scoreDifferential:18}]}];
    state.activeRound=null;state.view='stats';save();`);
  const saved = a.storage.get('parlink.v1');
  const b = app(a.storage);
  assert.match(b.element('app').innerHTML, /Round history/);
  assert.match(b.element('app').innerHTML, /1 player<\/div>/);
  assert.equal(b.run('state.rounds[0].results[0].gross'), 90);
  assert.equal(b.run('state.profile.name'), 'Recovery fixture');
  assert.equal(b.run('state.profile.clubs[0].carry'), 127);
  assert.equal(b.storage.get('parlink.v1'), saved);
});

test('finish does not discard an active round with a missing final-hole score', () => {
  const a = app();
  a.round();
  a.run('state.activeRound.hole=18;finishRound()');
  assert.equal(a.run('state.rounds.length'), 0);
  assert.equal(a.run('state.activeRound.hole'), 18);
  assert.equal(a.element('toast').textContent, 'Enter a score for each player');
});

test('round cards handle legacy players, results-only and empty participant data', () => {
  const a = app();
  for (const [fields, count] of [
    [{playerIds:['brad','paul'],players:[]},2],
    [{players:[{id:'brad'}]},1],
    [{results:[{playerId:'brad'},{playerId:'paul'}]},2],
    [{},0]
  ]) {
    const card = a.run(`roundCard(${JSON.stringify({id:'fixture',courseId:'demo',format:'stroke',...fields})})`);
    assert.match(card, new RegExp(`${count} player${count === 1 ? '' : 's'}<`));
  }
});

test('real course setup and demo are separate, with no invented real courses', () => {
  const a = app();
  a.run("setView('play')");
  assert.equal(a.run('roundSetup.mode'), 'real');
  assert.match(a.element('app').innerHTML, /No real courses saved yet/);
  a.run("chooseMode('demo')");
  assert.match(a.element('app').innerHTML, /Start demo round/);
  assert.equal(a.run('state.courses.filter(c=>!c.isDemo).length'), 0);
});

test('resume retains entered scores and the original course after editing the library', () => {
  const a = app();
  a.round();
  a.run("setParScore('brad');nextHole();state.courses[0].holes[0].par=6;setView('home')");
  assert.equal(a.storage.get('parlink.v1'), a.storage.get('parlink.v1.backup'));
  const b = app(a.storage);
  assert.match(b.element('app').innerHTML, /Resume round/);
  assert.equal(b.run('state.activeRound.hole'), 2);
  assert.equal(b.run('state.activeRound.scores.brad[0]'), 4);
  assert.equal(b.run('roundCourse(state.activeRound).holes[0].par'), 4);
  assert.equal(b.run('state.courses[0].holes[0].par'), 6);
});

test('damaged primary storage recovers from backup without discarding the damaged text', () => {
  const a = app();
  a.round();
  a.run("setParScore('brad')");
  a.storage.set('parlink.v1', '{damaged');
  const b = app(a.storage);
  assert.equal(b.run('state.activeRound.scores.brad[0]'), 4);
  assert.equal(b.storage.get('parlink.v1.damaged'), '{damaged');
  assert.match(b.element('app').innerHTML, /Recovered your last saved data/);
});

test('the newer recovery copy wins when primary writes failed', () => {
  const a = app();
  a.round();
  const oldPrimary = a.storage.get('parlink.v1');
  a.run("setParScore('brad')");
  a.storage.set('parlink.v1', oldPrimary);
  assert.equal(app(a.storage).run('state.activeRound.scores.brad[0]'), 4);
});

test('unreadable storage shows recovery and stays untouched', () => {
  const storage = new Map([['parlink.v1', '{damaged'], ['parlink.v1.backup', 'null']]);
  const before = [...storage];
  const a = app(storage);
  assert.match(a.element('app').innerHTML, /Your data has been kept/);
  assert.equal(a.run('save()'), false);
  assert.deepEqual([...storage], before);
});

test('one surviving storage copy keeps scores and reports reduced redundancy', () => {
  const a = app(new Map(), { failWrite: key => key === 'parlink.v1' });
  a.round();
  a.run("setParScore('brad')");
  assert.equal(a.run('storageStatus'), 'single');
  assert.match(a.run('saveStatusHtml()'), /one copy/);
  assert.equal(app(a.storage).run('state.activeRound.scores.brad[0]'), 4);
});

test('failed round completion keeps all scores for retry, then saves exactly once', () => {
  let unavailable = false;
  const a = app(new Map(), { failWrite: () => unavailable });
  a.round();
  a.run('state.activeRound.scores.brad=roundCourse(state.activeRound).holes.map(h=>h.par);state.activeRound.hole=18;save()');
  unavailable = true;
  a.run('finishRound()');
  assert.equal(a.run('state.rounds.length'), 0);
  assert.equal(a.run('state.activeRound.scores.brad.length'), 18);
  assert.match(a.element('toast').textContent, /could not be saved/);
  unavailable = false;
  a.run('finishRound();finishRound()');
  assert.equal(app(a.storage).run('state.rounds.length'), 1);
});

test('finish sends the player back to a skipped hole without inventing a score', () => {
  const a = app();
  a.round();
  a.run('state.activeRound.scores.brad=roundCourse(state.activeRound).holes.map(h=>h.par);state.activeRound.scores.brad[2]=null;state.activeRound.hole=18;finishRound()');
  assert.equal(a.run('state.activeRound.hole'), 3);
  assert.equal(a.run('state.activeRound.scores.brad[2]'), null);
  assert.equal(a.run('state.rounds.length'), 0);
  assert.match(a.element('toast').textContent, /Hole 3 needs a score/);
});

test('real rounds with no reliable distance do not receive demo club advice', () => {
  const a = app();
  a.round();
  a.run('state.activeRound.courseSnapshot.isDemo=false;roundCaddie()');
  assert.match(a.run('modal'), /No reliable distance/);
  assert.doesNotMatch(a.run('modal'), /135 m|club-rec/);
});

test('stale, inaccurate and distant GPS readings suppress yardage', () => {
  const a = app();
  for (const expression of [
    '{latitude:0,longitude:0,accuracy:5,timestamp:Date.now()-31000}',
    '{latitude:0,longitude:0,accuracy:26,timestamp:Date.now()}',
    '{latitude:0,longitude:1,accuracy:5,timestamp:Date.now()}'
  ]) {
    a.run(`gpsPosition=${expression}`);
    assert.equal(a.run('currentDistance({lat:0,lng:0})'), null);
  }
});

test('course validation rejects duplicate indexes, partial mapping and invalid ratings', () => {
  const a = app();
  assert.equal(a.run('validatedCourse(state.courses[0]).holes.length'), 18);
  for (const mutation of [
    'c.holes[1].si=c.holes[0].si',
    'c.holes[0].lat=-35',
    'c.slopeRating=156',
    'c.scratchRating=0',
    'c.holes[0].par=2'
  ]) assert.throws(() => a.run(`{const c=structuredClone(state.courses[0]);${mutation};validatedCourse(c)}`));
});

test('updates cannot replace an active round or proceed when data cannot save', () => {
  let unavailable = false;
  const a = app(new Map(), { failWrite: () => unavailable });
  a.round();
  a.run("window.sent=[];waitingWorker={postMessage:m=>window.sent.push(m)};actions['apply-update']()");
  assert.equal(a.run('window.sent.length'), 0);
  a.run('state.activeRound=null');
  unavailable = true;
  a.run("actions['apply-update']()");
  assert.equal(a.run('window.sent.length'), 0);
  unavailable = false;
  a.run("actions['apply-update']()");
  assert.deepEqual(a.value('window.sent'), [{ type: 'SKIP_WAITING' }]);
});

test('backup restore preserves scores and rejects invalid files without replacing data', async () => {
  const source = app();
  source.round();
  source.run("setParScore('brad');nextHole()");
  const backup = JSON.stringify({ kind: 'parlink-backup', schemaVersion: 1, state: source.value('state') });
  const a = app();
  a.run('restoreBackup()');
  a.inputs.at(-1).files = [{ text: async () => backup }];
  await a.inputs.at(-1).onchange();
  assert.equal(a.run('state.activeRound.hole'), 2);
  assert.equal(app(a.storage).run('state.activeRound.scores.brad[0]'), 4);
  const before = a.storage.get('parlink.v1');
  a.run('restoreBackup()');
  a.inputs.at(-1).files = [{ text: async () => '{"kind":"parlink-backup","schemaVersion":1,"state":{}}' }];
  await a.inputs.at(-1).onchange();
  assert.equal(a.storage.get('parlink.v1'), before);
  assert.match(a.element('toast').textContent, /Nothing was replaced/);
});

test('a backup that cannot be saved leaves the current round in memory', async () => {
  const a = app(new Map(), { failWrite: () => true });
  a.round();
  a.run("setParScore('brad')");
  const before = a.value('state');
  const backup = JSON.stringify({ kind: 'parlink-backup', schemaVersion: 1, state: app().value('state') });
  a.run('restoreBackup()');
  a.inputs.at(-1).files = [{ text: async () => backup }];
  await a.inputs.at(-1).onchange();
  assert.deepEqual(a.value('state'), before);
  assert.match(a.element('toast').textContent, /Existing data has been kept/);
});

test('offline worker serves cached app shell and waits for explicit update activation', async () => {
  const handlers = {};
  const removed = [];
  let skipped = 0;
  let installed = [];
  const cache = {
    addAll: async requests => { installed = requests.map(r => r.url); },
    match: async key => key === '/' ? 'cached app' : undefined
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8'), {
    self: { location: { origin: 'https://parlink.test' }, clients: { claim: async () => {} },
      addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: () => { skipped++; } },
    caches: { open: async () => cache, keys: async () => ['parlink-shell-1.4.1', 'unrelated-cache', 'parlink-shell-1.5.1'],
      delete: async key => { removed.push(key); } },
    Request: class { constructor(url) { this.url = url; } }, URL,
    fetch: async () => { throw new Error('Offline fixture'); }
  });
  let pending;
  handlers.install({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.ok(installed.includes('/') && installed.includes('/manifest.webmanifest'));
  assert.equal(skipped, 0);
  handlers.activate({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.deepEqual(removed, ['parlink-shell-1.4.1']);
  handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://parlink.test/' },
    respondWith: promise => { pending = promise; } });
  assert.equal(await pending, 'cached app');
  handlers.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(skipped, 1);
  handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://other.test/' },
    respondWith: () => assert.fail('Third-party requests must not be intercepted') });
});

test('an activated service worker clears its update notice', async () => {
  const serviceEvents = {};
  const registrationEvents = {};
  let onWorkerChange;
  const worker = { state: 'installed', addEventListener(name, callback) { onWorkerChange = callback; } };
  const registration = { waiting: worker, installing: worker,
    addEventListener(name, callback) { registrationEvents[name] = callback; } };
  const a = app(new Map(), { navigator: { serviceWorker: {
    register: async () => registration, ready: Promise.resolve(registration),
    addEventListener(name, callback) { serviceEvents[name] = callback; }
  } } });
  await a.windowEvents.load();
  assert.match(a.run('saveStatusHtml()'), /Apply update/);
  registrationEvents.updatefound();
  worker.state = 'activated';
  registration.waiting = null;
  registration.installing = null;
  onWorkerChange();
  assert.equal(a.run('waitingWorker'), null);
  assert.doesNotMatch(a.run('saveStatusHtml()'), /Apply update/);
  assert.match(a.run('saveStatusHtml()'), /Offline reopening ready/);
});


