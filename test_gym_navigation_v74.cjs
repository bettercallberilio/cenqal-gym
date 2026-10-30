// Regression tests for CENQAL Gym navigation: data are fictitious.
// Run: node --test test_gym_navigation_v74.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const main = html.match(/<script>\s*([\s\S]*?)<\/script>/);
assert.ok(main, 'Inline student script exists');
new vm.Script(main[1]);

function between(start, end) {
  const i=html.indexOf(start), j=html.indexOf(end,i);
  assert.ok(i>=0&&j>i, 'Expected code anchors '+start);
  return html.slice(i,j);
}
const storageCode=between('const GYM_STORE_TIMEOUT_MS','function keyMastery(t)').replace('GYM_STORE_TIMEOUT_MS=1200','GYM_STORE_TIMEOUT_MS=12');
const nextCode=between('async function nextQuestion(){','async function pauseTraining(){');

function sandboxWithCloud(cloud) {
 const items=new Map();
 const localStorage={
  getItem:key=>items.get(key)??null,
  setItem:(key,val)=>{items.set(key,String(val))},
  removeItem:key=>{items.delete(key)}
 };
 const ctx={console,Promise,Math,JSON,Number,String,Object,setTimeout,clearTimeout,localStorage,tg:{CloudStorage:cloud}};
 vm.createContext(ctx);
 vm.runInContext(storageCode+'\nthis.storageRef=storage;',ctx);
 return {ctx,items};
}

test('Telegram CloudStorage without callbacks cannot freeze read or write; local mirror survives',async()=>{
 const x=sandboxWithCloud({getItem:()=>{},setItem:()=>{},removeItem:()=>{}});
 await x.ctx.storageRef.set('cq_gym_session_t3_v1','{"index":2}');
 assert.equal(x.items.get('cq_gym_session_t3_v1'),'{"index":2}');
 assert.equal(await x.ctx.storageRef.get('cq_gym_session_t3_v1'),'{"index":2}');
});

test('Local session newer than stale cloud is not rolled back',async()=>{
 const cloud={getItem:(k,cb)=>cb(null,JSON.stringify({startedAt:111,roundId:'r',index:1})),setItem:(k,v,cb)=>cb(null),removeItem:(k,cb)=>cb(null)};
 const x=sandboxWithCloud(cloud);
 const current=JSON.stringify({startedAt:111,roundId:'r',index:4});
 x.items.set('cq_gym_session_t3_v1',current);
 assert.equal(await x.ctx.storageRef.get('cq_gym_session_t3_v1'),current);
});

test('Most recent cloud session is recoverable when local copy is missing',async()=>{
 const remote=JSON.stringify({startedAt:111,roundId:'r',index:9});
 const x=sandboxWithCloud({getItem:(k,cb)=>cb(null,remote),setItem:(k,v,cb)=>cb(null),removeItem:(k,cb)=>cb(null)});
 assert.equal(await x.ctx.storageRef.get('cq_gym_session_t3_v1'),remote);
 assert.equal(x.items.get('cq_gym_session_t3_v1'),remote);
});

test('Latest mastery backup cannot be overwritten by stale cloud snapshot',async()=>{
 const older=JSON.stringify({'T3-Q01':{updatedAt:100}});
 const newer=JSON.stringify({'T3-Q01':{updatedAt:300},'T3-Q02':{updatedAt:200}});
 const x=sandboxWithCloud({getItem:(k,cb)=>cb(null,older),setItem:(k,v,cb)=>cb(null),removeItem:(k,cb)=>cb(null)});
 x.items.set('cq_gym_mastery_t3_v1',newer);
 assert.equal(await x.ctx.storageRef.get('cq_gym_mastery_t3_v1'),newer);
});

test('Siguiente renders the next question BEFORE storing local progress',async()=>{
 const events=[];
 const state={session:{topic:3,index:1,order:['a','b','c','d']},answered:true};
 const ctx={state,console,showCurrent:async()=>{events.push('screen');state.answered=false;},
   saveJSON:async()=>{events.push('save')},keySession:t=>'session'+t,
   finishSession:async()=>{events.push('finish')}};
 vm.createContext(ctx);
 vm.runInContext(nextCode,ctx);
 await ctx.nextQuestion();
 assert.deepEqual(events,['screen','save']);
 assert.equal(state.session.index,2);
});

test('Final Siguiente shows results without resurrecting a finished session',async()=>{
 const events=[],state={session:{topic:3,index:1,order:['a','b']},answered:true};
 const ctx={state,console,showCurrent:async()=>{events.push('screen')},
  saveJSON:async()=>{events.push('save')},keySession:t=>'session'+t,
  finishSession:async()=>{events.push('finish');state.session=null}};
 vm.createContext(ctx);
 vm.runInContext(nextCode,ctx);
 await ctx.nextQuestion();
 assert.deepEqual(events,['finish']);
 assert.equal(state.session,null);
});

test('Double Siguiente taps cannot skip an unanswered question',async()=>{
 const events=[],state={session:{topic:3,index:0,order:['a','b','c','d']},answered:true};
 const ctx={state,console,showCurrent:async()=>{events.push('screen');state.answered=false},
  saveJSON:async()=>{},keySession:()=>'',finishSession:async()=>{events.push('finish')}};
 vm.createContext(ctx);
 vm.runInContext(nextCode,ctx);
 await ctx.nextQuestion();
 await ctx.nextQuestion();
 assert.equal(state.session.index,1);
 assert.deepEqual(events,['screen']);
});
