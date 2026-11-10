import test from 'node:test';
import assert from 'node:assert/strict';
import {makeMatePuzzle,createMateState,judgeMateMove} from '../dist/mate-puzzles.js';
import {winner,winningLine,winningMoves} from '../dist/game.js';

const count=(b,c)=>Array.from(b).filter(v=>v===c).length;
function play(board,line){const b=board.slice();for(const m of line){assert.equal(winner(b),0);assert.equal(b[m.i],0);b[m.i]=m.side;}return b;}

test('all six mate settings generate legal translated positions with distinct tactical geometry',()=>{
  for(const mode of ['attack','survive'])for(const moves of [1,2,3]){
    const layouts=new Set(),answerLocations=new Set();
    for(let seed=0;seed<20;seed++){
      const p=makeMatePuzzle({mode,moves,seed});
      assert.equal(count(p.board,1),count(p.board,2));assert.equal(winner(p.board),0);
      assert.equal(p.metadata.ownMoves,moves);assert.equal(p.metadata.mode,mode);
      assert(p.answers.length);p.answers.forEach(i=>{assert.equal(p.board[i],0);answerLocations.add(i);});
      layouts.add(p.variantId);
      const b=play(p.board,[...p.certificate.line,...p.certificate.finish]);
      assert.equal(winner(b),1);
    }
    assert(layouts.size>=12);assert(answerLocations.size>=10,`${mode}${moves} must not be a fixed-coordinate exercise`);
  }
});

test('every excluded reverse move at every answer state immediately loses, without unknowns',()=>{
  for(const moves of [1,2,3])for(let seed=0;seed<12;seed++){
    const p=makeMatePuzzle({mode:'survive',moves,seed});
    function inspect(state){
      const before=state.board.slice();
      let accepted=0,rejected=0;
      for(let i=0;i<225;i++)if(!before[i]){
        const r=judgeMateMove(state,i);
        assert.deepEqual(state.board,before,'judgment must be pure');
        if(!r.correct){
          rejected++;
          assert.equal(r.refutationColor,2);assert(Number.isInteger(r.refutation));
          assert.equal(winner(play(before,r.replay)),2,`reverse ${moves}/${seed}: ${i}`);
          assert.equal(r.status,'failed');
        }else{
          accepted++;
          assert.equal(r.state.ownMovesPlayed,state.ownMovesPlayed+1);
          if(r.done){
            assert.equal(r.state.ownMovesPlayed,moves);
            if(r.status==='five')assert.equal(winner(r.state.board),1);
            else{
              assert.equal(r.status,'forced-win');assert.equal(winner(r.state.board),0,'do not pretend the four is already five');
              assert.equal(winner(play(r.state.board,r.finish)),1);
              // Independently enumerate all legal white replies at the final fork.
              for(let d=0;d<225;d++)if(!r.state.board[d]){
                const b=r.state.board.slice();b[d]=2;
                assert.equal(winningLine(b,d).length,0);
                assert(winningMoves(b,1).length);
              }
            }
          }else{
            assert.equal(winner(r.state.board),0);
            // The selected white response is forced: every alternative loses now.
            const afterBlack=before.slice();afterBlack[i]=1;
            for(let d=0;d<225;d++)if(!afterBlack[d]){
              const b=afterBlack.slice();b[d]=2;assert.equal(winningLine(b,d).length,0);
              if(d!==r.whiteMove)assert(winningMoves(b,1).length);
            }
            inspect(r.state);
          }
        }
      }
      assert.equal(accepted,state.answers.length);
      assert.equal(accepted+rejected,225-count(before,1)-count(before,2));
    }
    inspect(createMateState(p));
  }
});

test('attack puzzles require one/two/three actual black placements and accept both endpoint wins',()=>{
  const attackEnds=new Set();
  for(const moves of [1,2,3])for(let seed=0;seed<12;seed++){
    const p=makeMatePuzzle({mode:'attack',moves,seed});
    function inspect(state){
      for(const i of state.answers){
        const r=judgeMateMove(state,i);assert(r.correct);
        if(r.done){assert.equal(r.status,'five');assert.equal(winner(r.state.board),1);assert.equal(r.state.ownMovesPlayed,moves);attackEnds.add(i);}
        else{
          const b=state.board.slice();b[i]=1;
          for(let d=0;d<225;d++)if(!b[d]){
            const reply=b.slice();reply[d]=2;assert.equal(winningLine(reply,d).length,0);
            if(d!==r.whiteMove)assert(winningMoves(reply,1).length,'an omitted defender reply must lose immediately');
          }
          inspect(r.state);
        }
      }
    }
    inspect(createMateState(p));
  }
  assert(attackEnds.size>10);
});

test('reverse one-move questions include all four structural families and all genuine winning answers',()=>{
  const families=new Map();
  for(let seed=0;seed<80;seed++){
    const p=makeMatePuzzle({mode:'survive',moves:1,seed});families.set(p.metadata.templateId,p);
    if(p.metadata.templateId==='race-of-fours'){
      assert.equal(p.answers.length,2);
      assert.deepEqual(p.answers,winningMoves(p.board,1));
    }
  }
  assert.deepEqual([...families.keys()].sort(),['block-and-five','gap-and-five','race-of-fours','relay-1']);
});

test('attack wrong moves are not falsely declared fatal; certificate playback and seeds are deterministic',()=>{
  const p=makeMatePuzzle({mode:'attack',moves:3,seed:'deterministic'});
  assert.deepEqual(p,makeMatePuzzle({mode:'attack',moves:3,seed:'deterministic'}));
  const state=createMateState(p),wrong=Array.from({length:225},(_,i)=>i).find(i=>!state.board[i]&&!state.answers.includes(i));
  const r=judgeMateMove(state,wrong);
  assert.equal(r.correct,false);assert.equal(r.refutation,null);assert.equal(r.status,'outside-scope');assert.equal(r.replay.length,0);
  assert.equal(winner(play(p.board,p.certificate.line)),1);
  assert.throws(()=>makeMatePuzzle({mode:'survive',moves:4}));
});

test('reverse variant identity ignores relocated balancing stones',()=>{
  const seen=new Map();let matched=false;
  for(let seed=0;seed<400&&!matched;seed++){
    const p=makeMatePuzzle({mode:'survive',moves:3,seed});
    const key=[p.metadata.transform,p.metadata.dx,p.metadata.dy].join(',');
    const old=seen.get(key);
    if(old&&Array.from(old.board).some((v,i)=>v!==p.board[i])){
      assert.equal(old.variantId,p.variantId,'same tactical core must not become a new mastery layout because filler moved');
      assert.deepEqual(old.answers,p.answers);matched=true;
    }
    seen.set(key,p);
  }
  assert(matched,'fixture must exercise different filler with the same tactical placement');
});
