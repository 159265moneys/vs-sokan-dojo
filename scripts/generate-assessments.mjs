// Reproducible, independent finite verifier for the original assessment bank.
// No engine score is used to reject a move; a failed bounded search is unknown.
import { parse, coord } from '../dist/game.js';
import { pathToFileURL } from 'node:url';
export const points = (s='') => s.trim().split(/\s+/).filter(Boolean).map(parse);
export const board = (black, white) => {
  const b = Array(225).fill(0);
  for (const [text,side] of [[black,1],[white,2]]) for (const i of points(text)) {
    if (b[i]) throw Error(`overlap ${coord(i)}`); b[i]=side;
  }
  return b;
};
export const windows=[];
export const sixWindows=[];
for(let y=0;y<15;y++) for(let x=0;x<15;x++) for(const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]) {
  for(const [length,out] of [[5,windows],[6,sixWindows]]) {
    if(x+(length-1)*dx<0||x+(length-1)*dx>=15||y+(length-1)*dy<0||y+(length-1)*dy>=15)continue;
    out.push(Array.from({length},(_,k)=>(y+k*dy)*15+x+k*dx));
  }
}
export const empty = b => b.flatMap((v,i)=>v?[]:[i]);
export const won = (b,s) => windows.some(w=>w.every(i=>b[i]===s));
export function wins(b,s){
  const result = new Set();
  for(const w of windows){let own=0,gap=-1,bad=false;for(const i of w){if(b[i]===s)own++;else if(b[i]){bad=true;break;}else gap=i;}if(!bad&&own===4)result.add(gap);}
  return [...result].sort((a,b)=>a-b);
}
export function fours(b,s){
  const result=new Set();for(const w of windows){let own=0,bad=false;for(const i of w){if(b[i]===s)own++;else if(b[i]){bad=true;break;}}if(!bad&&own===3)for(const i of w)if(!b[i])result.add(i);}return [...result].sort((a,b)=>a-b);
}
export function forks(b,s){return fours(b,s).filter(i=>{b[i]=s;const good=wins(b,s).length>=2&&!wins(b,3-s).length;b[i]=0;return good;});}
export function openThrees(b,s,placed=null){return sixWindows.filter(w=>!b[w[0]]&&!b[w[5]]&&w.slice(1,5).every(i=>!b[i]||b[i]===s)&&w.slice(1,5).filter(i=>b[i]===s).length===3&&(placed===null||w.slice(1,5).includes(placed)));}
export function vcf(input,side=1,maxPly=9,maxNodes=1600){
  const b=[...input];let nodes=0,aborted=false;
  function search(left){if(++nodes>maxNodes){aborted=true;return null;}const immediate=wins(b,side);if(immediate.length)return [immediate[0]];if(left<3)return null;const danger=wins(b,3-side);if(danger.length>1)return null;for(const i of danger.length?danger:fours(b,side)){b[i]=side;const own=wins(b,side),enemy=wins(b,3-side);if(!own.length||enemy.length){b[i]=0;continue;}if(own.length>1){b[i]=0;return [i,own[0],own[1]];}b[own[0]]=3-side;const sub=search(left-2);b[own[0]]=0;b[i]=0;if(sub)return [i,own[0],...sub];if(aborted)return null;}return null;}
  if(won(b,1)||won(b,2))return {proven:false,line:[],nodes,terminal:true};
  for(let ply=1;ply<=maxPly;ply+=2){const line=search(ply);if(line)return {proven:true,line,nodes};if(aborted)break;}
  return {proven:false,line:[],nodes,aborted};
}
export function afterFirst(b,i,maxPly=9,maxNodes=1600){
  const n=[...b];n[i]=1;if(won(n,1))return {status:'win',line:[i]};const own=wins(n,1),enemy=wins(n,2);if(enemy.length)return {status:'loss',line:[i,enemy[0]]};if(own.length>1)return {status:'win',line:[i,own[0],own[1]]};if(own.length){n[own[0]]=2;const proof=vcf(n,1,maxPly,maxNodes);if(proof.proven)return {status:'win',line:[i,own[0],...proof.line]};n[own[0]]=0;}const white=vcf(n,2,maxPly,maxNodes);return white.proven?{status:'loss',line:[i,...white.line]}:{status:'unknown',line:[]};
}
export function allReplies(b,first,maxPly=9,maxNodes=1600){
  const n=[...b];n[first]=1;const result=[];for(const i of empty(n)){n[i]=2;const proof=won(n,2)?{proven:false,line:[],whiteWins:true}:vcf(n,1,maxPly,maxNodes);result.push({reply:i,...proof});n[i]=0;}return result;
}
export function fingerprint(b){
  const stones=b.flatMap((s,i)=>s?[[i%15,Math.floor(i/15),s]]:[]);
  return Array.from({length:8},(_,t)=>{const a=stones.map(([x,y,s])=>{if(t&4)[x,y]=[y,x];if(t&1)x=-x;if(t&2)y=-y;return [x,y,s];});const minX=Math.min(...a.map(p=>p[0])),minY=Math.min(...a.map(p=>p[1]));return a.map(([x,y,s])=>[x-minX,y-minY,s].join(',')).sort().join(';');}).sort()[0];
}
export function exerciseCandidates(b,exercise){return empty(b).filter(i=>{b[i]=1;const required=[...exercise.cells,i];const found=exercise.objective==='four'?windows.some(w=>required.every(j=>w.includes(j))&&w.filter(j=>b[j]===1).length===4&&w.every(j=>b[j]!==2)):sixWindows.some(w=>!b[w[0]]&&!b[w[5]]&&required.every(j=>w.slice(1,5).includes(j))&&w.slice(1,5).filter(j=>b[j]===1).length===3&&w.slice(1,5).every(j=>b[j]!==2));b[i]=0;return found;});}
// Exhaustive first-move certificate discovery. Failure means only that this
// bounded VCF certificate is absent; it never labels the position as lost.
export function firstMoveCertificates(p) {
  const known = fours(p.board, 1), out = [];
  // Test the known vulnerable replies before distant filler points. This is
  // ordering only: a positive certificate still checks every legal reply.
  const baselineStops = [];
  if (vcf(p.board,1).proven) for (const reply of empty(p.board)) {
    const b = [...p.board]; b[reply] = 2;
    if (won(b,2) || !vcf(b,1).proven) baselineStops.push(reply);
  }
  for (const move of empty(p.board)) {
    const b = [...p.board]; b[move] = 1;
    if (won(b, 1)) { out.push({move, outcome:'win'}); continue; }
    if (p.judge.firstObjective === 'forcing-four' && !wins(b,1).length) { out.push({move,outcome:'goal-miss'}); continue; }
    if (p.judge.kind === 'prevent-fork') {
      out.push({move,outcome:!wins(b,2).length&&!forks(b,2).length?'local-goal':'goal-miss'}); continue;
    }
    if (p.judge.kind === 'open-four-first' && (wins(b,1).length<2 || wins(b,2).length)) {
      out.push({move,outcome:'goal-miss'}); continue;
    }
    const direct = afterFirst(p.board, move);
    if (direct.status !== 'unknown' || wins(b,1).length || wins(b,2).length) {
      out.push({move,outcome:direct.status}); continue;
    }
    let all = true, replyCount = 0;
    for (const reply of [...new Set([...baselineStops,...known,...fours(b,1),...empty(b)])].filter(i=>!b[i])) {
      b[reply] = 2; const proof = won(b,2)?{proven:false}:vcf(b,1); b[reply] = 0; replyCount++;
      if (!proof.proven) { all = false; break; }
    }
    out.push({move,outcome:all?'setup':'unknown',repliesChecked:replyCount});
  }
  return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {assessmentProblems}=await import('../dist/assessment-bank.js');
  let totals={problems:assessmentProblems.length,legalFirstMoves:0,setupReplies:0};
  for (const p of assessmentProblems) {
    if(p.kind!=='play')continue;
    const firstMoves=firstMoveCertificates(p);totals.legalFirstMoves+=firstMoves.length;
    const certified=firstMoves.filter(v=>['win','setup','local-goal'].includes(v.outcome)).map(v=>v.move).sort((a,b)=>a-b);
    if(JSON.stringify(certified)!==JSON.stringify([...p.guide].sort((a,b)=>a-b)))throw Error('alternative mismatch: '+p.id);
    let replies=0;
    for(const setup of p.judge.setups||[]){const proof=allReplies(p.board,setup.move);if(!proof.every(v=>v.proven))throw Error('unproved setup: '+p.id);replies+=proof.length;}
    totals.setupReplies+=replies;
    console.log(JSON.stringify({id:p.id,family:p.family,branchId:p.branchId,legalFirstMoves:firstMoves.length,certifiedAlternatives:certified.length,setupReplies:replies}));
  }
  console.log(JSON.stringify(totals));
}
