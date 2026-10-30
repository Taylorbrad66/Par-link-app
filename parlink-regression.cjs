const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(process.env.PARLINK_APP_FILE || path.join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Execute the full app with synthetic DOM, storage and location inputs.
// These tests do not claim to verify browser permissions or real GPS accuracy.
function app(storage = new Map()) {
  const elements = new Map();
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
    setTimeout() { return 0; },
    window: { addEventListener() {}, scrollTo() {} },
    document: {
      getElementById: element,
      querySelector(selector) {
        return selector === '.seg.active' ? { dataset: { format: selection.format } } : null;
      },
      querySelectorAll(selector) {
        return selector === '.pill.active' ? selection.playerIds.map(id => ({ dataset: { playerSelect: id } })) : [];
      }
    },
    navigator: {},
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
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
  return { run, value, round, storage, element };
}

test('homepage starts and renders V1.4.1', () => {
  const a = app();
  assert.match(a.element('app').innerHTML, /ParLink V1\.4\.1/);
  assert.equal(a.run('APP_KEY'), 'parlink.v1');
});

test('unmapped courses have no centre or nearby-course match', () => {
  const a = app();
  a.run('gpsPosition={latitude:-35,longitude:150,accuracy:5}');
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
  a.run('gpsPosition={latitude:0,longitude:0,accuracy:5}');
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
  a.run('gpsPosition={latitude:0,longitude:0,accuracy:5}');
  assert.deepEqual(a.value("courseCenter({holes:[{lat:'0',lng:'0'}]})"), { lat: 0, lng: 0 });
  assert.equal(a.run("currentDistance({lat:'0',lng:'0'})"), 0);
  assert.ok(Math.abs(a.run('haversine(0,0,0,1)') - 111195) < 1);
});

test('nearby-course lookup ignores unmapped courses', () => {
  const a = app();
  a.run(`gpsPosition={latitude:-35,longitude:150,accuracy:5};
    state.courses.push({id:'mapped',name:'Mapped fixture',activated:true,holes:[{lat:-35,lng:150}]});`);
  assert.equal(a.run('nearestCourse().c.id'), 'mapped');
  assert.equal(a.run('nearestCourse().d'), 0);
});

test('zero-metre round shows zero and no example or carry-club advice', () => {
  const a = app();
  a.round();
  a.run(`gpsPosition={latitude:-35,longitude:150,accuracy:5};
    state.courses[0].holes[0].lat=-35;
    state.courses[0].holes[0].lng=150;
    roundCaddie();`);
  const modal = a.run('modal');
  assert.match(modal, /club-rec">0 m/);
  assert.doesNotMatch(modal, /135 m|Safe option|normal carry/);
  assert.match(a.run('roundView()'), /gps-number">0<\/div><div class="gps-label">metres to green/);
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
  a.run(`gpsPosition={latitude:0,longitude:0,accuracy:5};
    state.courses[0].holes[0].lat=0;
    state.courses[0].holes[0].lng=0.001214084432;
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

