import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {validCar,validHit,validGame,resultEvidence} from '../src/room-guard.js';
import {html} from './served-game.mjs';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

async function roomFixture(name){
  let now=100000;const sockets=[],data=new Map([['room-name',name]]);
  const storage={get:async key=>data.get(key),list:async({prefix})=>new Map([...data].filter(([key])=>key.startsWith(prefix))),put:async(key,value)=>data.set(key,structuredClone(value)),delete:async key=>data.delete(key),setAlarm:async()=>{},deleteAlarm:async()=>{}};
  const ctx={storage,getWebSockets:id=>sockets.filter(ws=>ws.readyState===1&&(!id||ws.attachment.id===id)),setWebSocketAutoResponse(){},blockConcurrencyWhile(fn){this.ready=fn();}};
  const source=(await read('src/room.js')).replace(/^import .*;$/gm,'').replace('export class Room','class Room')+'\nglobalThis.TestRoom=Room;';
  const context=vm.createContext({validCar,validHit,validGame,resultEvidence,reply:Response.json,identify:async()=>({uid:'test'}),structuredClone,DurableObject:class{constructor(ctx,env){this.ctx=ctx;this.env=env;}},WebSocketRequestResponsePair:class{},TextEncoder,Response,Request,URL,JSON,Map,Set,Date:class extends Date{static now(){return now;}}});
  vm.runInContext(source,context);
  const fixture={data,advance:ms=>{now+=ms;},now:()=>now,async wake(){this.room=new context.TestRoom(ctx,{});await ctx.ready;return this.room;},
    socket(id){const ws={readyState:1,attachment:{id,ok:false},messages:[],serializeAttachment(value){this.attachment=structuredClone(value);},deserializeAttachment(){return structuredClone(this.attachment);},send(value){this.messages.push(JSON.parse(value));},close(){this.readyState=3;}};sockets.push(ws);return ws;},
    message(ws,value){return this.room.webSocketMessage(ws,JSON.stringify(value));}};
  await fixture.wake();return fixture;
}
const history=ws=>ws.messages.filter(m=>m.t==='chat-history').at(-1)?.msgs||[];

test('lobby chat: a player who arrives later sees recent messages, also after the lobby sleeps',async()=>{
  const f=await roomFixture('lobby'),a=f.socket('a');
  await f.message(a,{t:'hello',p:{nm:'Alice',lv:12}});
  await f.message(a,{t:'p',p:{ch:[['m1',f.now(),'hello everyone']]}});
  await f.message(a,{t:'p',p:{ch:[['m1',f.now(),'hello everyone'],['m2',f.now(),'anyone up for 2v2?']]}});
  const b=f.socket('b');await f.message(b,{t:'hello',p:{nm:'Bob'}});
  assert.deepEqual(history(b).map(m=>[m.k,m.nm,m.tx]),[['a:m1','Alice','hello everyone'],['a:m2','Alice','anyone up for 2v2?']]);
  // Alice leaves; her messages stay for players who arrive later, even after the lobby hibernates
  await f.message(a,{t:'bye'});await f.wake();
  const c=f.socket('c');await f.message(c,{t:'hello',p:{nm:'Cara'}});
  assert.deepEqual(history(c).map(m=>m.tx),['hello everyone','anyone up for 2v2?']);
  // a resync of the same messages never duplicates them
  const a2=f.socket('a');await f.message(a2,{t:'hello',p:{nm:'Alice',ch:[['m1',f.now(),'hello everyone']]}});
  assert.equal(f.room.chat.length,2);
});

test('lobby chat history expires, is capped, rate limited, and only kept in the lobby',async()=>{
  const f=await roomFixture('lobby'),a=f.socket('a');await f.message(a,{t:'hello',p:{nm:'Alice'}});
  for(let i=0;i<15;i++){await f.message(a,{t:'p',p:{ch:[['x'+i,f.now(),'spam '+i]]}});}
  assert.equal(f.room.chat.length,10,'at most 10 messages per player in 10 s');
  f.advance(11000);for(let i=0;i<40;i++){f.advance(1100);await f.message(a,{t:'p',p:{ch:[['y'+i,f.now(),'line '+i]]}});}
  assert.equal(f.room.chat.length,40);assert.equal(f.room.chat.at(-1).tx,'line 39');
  f.advance(2*3600000+1);const b=f.socket('b');await f.message(b,{t:'hello',p:{nm:'Bob'}});
  assert.equal(history(b).length,0,'messages older than two hours are not sent');
  const m=await roomFixture('np-m-abc'),x=m.socket('x');await m.message(x,{t:'hello',p:{nm:'X',ch:[['z',m.now(),'gg']]}});
  const y=m.socket('y');await m.message(y,{t:'hello',p:{nm:'Y'}});
  assert.equal(m.room.chat.length,0);assert.equal(history(y).length,0);
});

test('served game shows the lobby chat history and waits for the host to confirm your ball hit',()=>{
  assert.match(html,/room\.on\("chat-history", m => lchatHistory\(m && m\.msgs\)\)/);
  assert.match(html,/function lchatHistory\(list\)/);
  assert.match(html,/ha: Object\.fromEntries\(\[\.\.\.hitSeen\]\.slice\(0, 8\)\)/);
  assert.match(html,/else if \(npBallSettled\(\)\) \{/);
  assert.doesNotMatch(html,/nowS\(\) - me\.lastHit > 0\.4\) \{/);
});

test('your hit is kept until the host has applied it, with a fallback for older hosts and lost hits',()=>{
  const src=html.slice(html.indexOf('let npHitAck = null;'),html.indexOf('function applyHostState(g) {'));
  const ctx={me:{lastHit:0,hitN:3},t:0};vm.createContext(ctx);vm.runInContext(src.replace('let npHitAck','var npHitAck')+';var nowS=()=>t;',ctx);
  const settled=(t,ack)=>{ctx.t=t;ctx.npHitAck=ack;return vm.runInContext('npBallSettled()',ctx);};
  assert.equal(settled(0.6,2),false,'the host has not applied hit 3 yet: an older ball must not snap back');
  assert.equal(settled(0.6,3),true);
  assert.equal(settled(0.3,null),false);assert.equal(settled(0.5,null),true,'older hosts: the old 0.4 s wait');
  assert.equal(settled(1.6,1),true,'a refused or lost hit never freezes the ball');
});

test('Legend bots and a level floor for matchmade bots (experienced players got Bronze bots)',()=>{
  const start=html.indexOf('const BOT_DF = [');const src=html.slice(start,html.indexOf('\n',html.indexOf('function npBotSkill',start)));
  const ctx={clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),lv:1,Ranked:{botSkill:m=>m<300?0.5:1.1}};vm.createContext(ctx);
  vm.runInContext(src+'\n;var myLevel=()=>lv;globalThis.r={BOT_DF,npBotSkill,npLevelBotFloor};',ctx);
  const {BOT_DF,npBotSkill}=ctx.r;
  assert.deepEqual([...BOT_DF],[0.6,0.88,1.08,1.22]);
  ctx.lv=1;assert.equal(npBotSkill(100),0.5,'new players keep bots at their MMR');
  ctx.lv=10;assert.equal(npBotSkill(100),0.64);
  ctx.lv=80;assert(Math.abs(npBotSkill(100)-0.97)<1e-9,'a high level never plays Bronze bots');
  assert.equal(npBotSkill(1500),1.1,'a high MMR still gets its own (harder) bots');
  assert.match(html,/segInto\(\$\("exDiff"\), \["Rookie", "Pro", "All-Star", "Legend"\]/);
  assert.match(html,/match\.df = clamp\(g\.df \| 0, 0, 3\);/);
  assert.equal((html.match(/Ranked\.botSkill\(bm\), team/g)||[]).length,0,'matchmade searches use npBotSkill');
});

test('guests are told before signing up that guest progress does not move into a new account',()=>{
  assert.doesNotMatch(html,/Your current level, name and settings move into the new account/);
  assert.match(html,/let acctWarned = 0;/);
  assert.match(html,/Press Create account again to go ahead/);
});

test('the release build number matches in the game, version.txt and the build header',async()=>{
  const build=html.match(/const BUILD = (\d+);/)[1];
  assert.equal((await read('public/version.txt')).trim(),build);
  assert.match(await read('src/worker.js'),new RegExp('"X-Nitropitch-Build", "'+build+'"'));
  assert.match(html,/const PATCH_NOTES = \{\n  "v": "5\.62"/);
  for(const fn of ['checkVersion','noteBuild','showUpdateBar'])assert.match(html,new RegExp('function '+fn+'\\('),fn+' refresh popup kept');
});
