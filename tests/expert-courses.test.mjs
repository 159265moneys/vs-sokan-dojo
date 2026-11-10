import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {winningMoves,winningLine,winner,parse,coord} from '../dist/game.js';
import {annotateMove} from '../dist/expert-guidance.js';

const data=JSON.parse(fs.readFileSync(new URL('../dist/expert-courses.json',import.meta.url),'utf8'));
const same=(a,b)=>assert.deepEqual([...a].sort((x,y)=>x-y),[...b].sort((x,y)=>x-y));
function forkGains(input,side){
  const b=input.slice(),out=[];
  for(let i=0;i<225;i++)if(!b[i]){
    b[i]=side;
    if(!winningLine(b,i).length&&winningMoves(b,side).length>=2)out.push(i);
    b[i]=0;
  }
  return out;
}

test('expert material contains actual complete black wins against the configured strongest white',()=>{
  assert.equal(data.version,1);
  assert.equal(data.rule,'freestyle15');
  assert.equal(data.engine.strength,100);
  assert.equal(data.engine.independentSides,true);
  assert.equal(data.engine.sha256,crypto.createHash('sha256').update(fs.readFileSync(new URL('../dist/engine/rapfi-single-simd128.wasm',import.meta.url))).digest('hex'));
  assert(data.courses.length>=1);
  assert(data.courses.some(c=>c.openingKind==='natural'),'at least one game must allow all white moves to be selected by the engine');
  assert(data.limitations.some(s=>s.includes('完全戦略')));
  const ids=new Set();
  for(const course of data.courses){
    assert(!ids.has(course.id));ids.add(course.id);
    assert.equal(course.whiteMs,8000);
    assert(course.blackMs>=8000);
    assert.equal(course.result,'win');
    assert(course.moves.length<=225);
    const board=new Uint8Array(225);
    let searchedWhite=0;
    for(let j=0;j<course.moves.length;j++){
      const m=course.moves[j];
      assert.equal(winner(board),0,`${course.id}: no moves after a terminal position`);
      assert(Number.isInteger(m.i)&&m.i>=0&&m.i<225);
      assert.equal(board[m.i],0);
      assert.equal(m.side,j%2+1);
      assert(m.info&&typeof m.info==='object');
      if(m.forced){
        assert.equal(j,1);
        assert.equal(m.side,2);
        assert.equal(m.i,course.forcedOpening.i);
        assert.equal(m.searchMs,0);
        assert(course.openingKind.startsWith('forced-white-'));
      }else{
        assert.equal(m.searchMs,m.side===1?course.blackMs:8000);
        if(m.side===2)searchedWhite++;
      }
      board[m.i]=m.side;
    }
    assert(searchedWhite>=4,'course must contain an actual played response sequence');
    assert.equal(winner(board),1,course.id);
    assert.equal(course.moves.at(-1).side,1);
    assert(winningLine(board,course.moves.at(-1).i).length>=5);
    if(course.openingKind==='natural')assert(!course.moves.some(m=>m.forced));
  }
});

test('every expert annotation agrees with legal tactical and connection facts',()=>{
  for(const course of data.courses){
    const board=new Uint8Array(225);
    for(const m of course.moves){
      const f=m.facts,before=board.slice();
      assert.deepEqual(annotateMove(before,m.i,m.side),{phase:m.phase,title:m.title,text:m.text,kind:m.kind,facts:m.facts},'live guidance and recorded course use the same factual annotations');
      assert.deepEqual(board,before,'live annotation never mutates the supplied board');
      assert(m.title&&m.text);
      assert(['opening','build','attack','finish'].includes(m.phase));
      same(f.ownWinsBefore,winningMoves(board,m.side));
      same(f.opponentWinsBefore,winningMoves(board,3-m.side));
      const adjacent=[],nearby=[];
      for(let j=0;j<225;j++)if(board[j]===m.side){
        const d=Math.max(Math.abs(m.i%15-j%15),Math.abs(Math.floor(m.i/15)-Math.floor(j/15)));
        if(d===1)adjacent.push(j);
        if(d<=2)nearby.push(j);
      }
      same(f.connectedOwn,adjacent);same(f.nearbyOwn,nearby);
      for(const linked of f.links){
        assert.equal(before[linked],m.side);
        const dx=linked%15-m.i%15,dy=Math.floor(linked/15)-Math.floor(m.i/15);
        assert(dx===0||dy===0||Math.abs(dx)===Math.abs(dy));
        const n=Math.max(Math.abs(dx),Math.abs(dy));assert(n<=4&&n>=1);
        for(let k=1;k<n;k++)assert.notEqual(before[(Math.floor(m.i/15)+Math.sign(dy)*k)*15+m.i%15+Math.sign(dx)*k],3-m.side);
      }
      board[m.i]=m.side;
      same(f.ownWinsAfter,winningMoves(board,m.side));
      same(f.opponentWinsAfter,winningMoves(board,3-m.side));
      if(m.kind==='win'){assert(winningLine(board,m.i).length);assert.equal(m.phase,'finish');}
      if(m.kind==='fork'){assert(f.ownWinsAfter.length>=2);assert.equal(f.opponentWinsAfter.length,0);}
      if(m.kind==='four')assert(f.ownWinsAfter.length>=1);
      if(m.kind==='block'){assert(f.opponentWinsBefore.includes(m.i));assert.equal(f.opponentWinsAfter.length,0);}
      if(m.kind==='forced-loss')assert(f.opponentWinsBefore.length>=2);
      if(m.kind==='connect')assert(f.links.length>0);
      if(m.kind==='prepare-four'){assert(f.nextOpenFours.length>0);same(f.nextOpenFours,forkGains(board,m.side));}
      if(m.kind==='stop-three'){
        const old=forkGains(before,3-m.side),next=forkGains(board,3-m.side);
        assert(f.stoppedOpenFours.length>0);
        same(f.stoppedOpenFours,old.filter(i=>!next.includes(i)));
      }
      if(m.kind==='prepare-connection'){
        assert(f.connectionTargets.length>0);
        for(const target of f.connectionTargets){
          assert.equal(board[target],0);
          const lines=new Set();let seesNewStone=false;
          for(let point=0;point<225;point++)if(board[point]===m.side){
            const dx=point%15-target%15,dy=Math.floor(point/15)-Math.floor(target/15),n=Math.max(Math.abs(dx),Math.abs(dy));
            if(n>4||(!(!dx||!dy||Math.abs(dx)===Math.abs(dy))))continue;
            let blocked=false;for(let k=1;k<n;k++)if(board[(Math.floor(target/15)+Math.sign(dy)*k)*15+target%15+Math.sign(dx)*k]===3-m.side)blocked=true;
            if(!blocked){lines.add(!dx?'vertical':!dy?'horizontal':Math.sign(dx)===Math.sign(dy)?'diagonal':'antidiagonal');if(point===m.i)seesNewStone=true;}
          }
          assert(seesNewStone&&lines.size>=2);
        }
      }
      const pv=m.info.BESTLINE?.match(/\d+,\d+/g);
      if(pv?.length){
        // A stopped iteration's last INFO PV can differ from the final chosen move.
        // Preserve the raw trace; never relabel it as the actually played continuation.
        const pvBoard=before.slice();let side=m.side;
        for(const point of pv){const [x,y]=point.split(',').map(Number),i=y*15+x;assert(x>=0&&x<15&&y>=0&&y<15);assert.equal(pvBoard[i],0);assert.equal(winner(pvBoard),0);pvBoard[i]=side;side=3-side;}
      }
      for(const point of m.text.match(/[A-O](?:1[0-5]|[1-9])(?!\d)/g)||[])assert.equal(coord(parse(point)),point);
    }
  }
});
