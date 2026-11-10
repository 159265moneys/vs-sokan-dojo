import {parse,coord,winner,winningLine,winningMoves,proveVCF} from './game.js';
import {lessons,transformPoint} from './lessons.js';
import {makeTrainingPosition} from './training-positions.js';

const points=s=>s.split(' ').filter(Boolean).map(parse);
const distance=(a,b)=>Math.max(Math.abs(a%15-b%15),Math.abs(Math.floor(a/15)-Math.floor(b/15)));
function random(seed){let h=2166136261;for(const c of String(seed))h=Math.imul(h^c.charCodeAt(0),16777619);return()=>{h+=0x6d2b79f5;let t=Math.imul(h^(h>>>15),h|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const pick=(rng,list)=>list[Math.floor(rng()*list.length)];
const integer=(rng,min,max)=>min+Math.floor(rng()*(max-min+1));
const move=(i,side)=>({i,side});
const emptyCells=b=>Array.from({length:225},(_,i)=>i).filter(i=>!b[i]);

/** All accepted attacks have a continuous-four certificate within the own-move budget. */
function attackChoices(input,remaining,defenseChoice=0){
  if(remaining<1||winner(input))return {};
  const choices={},ownWins=winningMoves(input,1);
  if(ownWins.length){for(const i of ownWins)choices[i]={terminal:'five',whiteMove:null,finish:[],line:[move(i,1)]};return choices;}
  const danger=winningMoves(input,2);
  if(danger.length>1||remaining===1)return choices;
  for(const i of danger.length?danger:emptyCells(input)){
    const b=input.slice();b[i]=1;
    if(winningMoves(b,2).length)continue;
    const threats=winningMoves(b,1);
    if(!threats.length)continue;
    const defense=threats[Math.abs(defenseChoice)%threats.length];
    b[defense]=2;
    if(winningLine(b,defense).length)continue;
    const proof=proveVCF(b,1,{maxPly:2*(remaining-1)-1,maxNodes:2000});
    if(proof.proven)choices[i]={terminal:null,whiteMove:defense,finish:[],line:[move(i,1),move(defense,2),...proof.line.map((p,j)=>move(p,j%2+1))]};
  }
  return choices;
}

/** Check every possible white move before claiming an unavoidable black win. */
function finishingCertificate(board){
  if(winningMoves(board,2).length)return null;
  const endpoints=winningMoves(board,1);
  if(endpoints.length<2)return null;
  const replies={};
  for(const white of emptyCells(board)){
    const b=board.slice();b[white]=2;
    if(winningLine(b,white).length)return null;
    const black=winningMoves(b,1)[0];
    if(black===undefined)return null;
    replies[white]=black;
  }
  const white=endpoints[0];
  return {line:[move(white,2),move(replies[white],1)],replies};
}

/** Reject a template if any excluded legal black move lacks an immediate-loss proof. */
function certifySurvival(input,remaining){
  if(remaining<1||winner(input)||!winningMoves(input,2).length)return null;
  const branches={},wrongReplies={};
  for(const i of emptyCells(input)){
    const b=input.slice();b[i]=1;
    if(winningLine(b,i).length){
      if(remaining!==1)return null;
      branches[i]={terminal:'five',whiteMove:null,finish:[],line:[move(i,1)]};continue;
    }
    const whiteWins=winningMoves(b,2);
    if(whiteWins.length){wrongReplies[i]=whiteWins[0];continue;}
    if(remaining===1){
      const finish=finishingCertificate(b);
      if(!finish)return null;
      branches[i]={terminal:'forced-win',whiteMove:null,finish:finish.line,finishReplies:finish.replies,line:[move(i,1)]};continue;
    }
    const forced=winningMoves(b,1);
    if(forced.length!==1)return null;
    const whiteMove=forced[0];b[whiteMove]=2;
    if(winningLine(b,whiteMove).length)return null;
    const child=certifySurvival(b,remaining-1);
    if(!child)return null;
    branches[i]={terminal:null,whiteMove,child,line:[move(i,1),move(whiteMove,2),...child.line],finish:child.finish};
  }
  const answers=Object.keys(branches).map(Number).sort((a,b)=>a-b);
  if(!answers.length)return null;
  const first=branches[answers[0]];
  return {answers,branches,wrongReplies,line:first.line,finish:first.finish,legalCount:emptyCells(input).length};
}

function survivalTemplate(moves,rng){
  const chain={id:`relay-${moves}`,black:points('H6 H7 H9 G8 I8 I7 I10 C3'),white:points('H5 E8 D4 E5 F6 G7 D6 E7 G9 F12 G11'),critical:points('H8 H10 F8 J8 I9 I6 I11')};
  if(moves<=2){chain.black.push(parse('H8'));chain.white.push(parse('H10'));}
  if(moves===1){chain.black.push(parse('F8'));chain.white.push(parse('J8'));}
  if(moves!==1)return chain;
  return pick(rng,[
    chain,
    {id:'block-and-five',black:points('H4 H5 H6 H7 C8'),white:points('H3 D8 E8 F8 G8'),critical:points('H8')},
    {id:'gap-and-five',black:points('E8 K8 H4 H5 H6 H7'),white:points('F8 G8 I8 J8 H3'),critical:points('H8')},
    {id:'race-of-fours',black:points('F8 G8 H8 I8'),white:points('F5 G5 H5 I5'),critical:points('E8 J8 E5 J5')},
  ]);
}

function transformedTemplate(template,rng){
  const t=integer(rng,0,7),critical=[...template.black,...template.white,...template.critical].map(i=>transformPoint(i,t));
  const xs=critical.map(i=>i%15),ys=critical.map(i=>Math.floor(i/15));
  const dx=integer(rng,-Math.min(...xs),14-Math.max(...xs)),dy=integer(rng,-Math.min(...ys),14-Math.max(...ys));
  const map=i=>transformPoint(i,t)+dx+15*dy;
  const black=template.black.map(map),white=template.white.map(map),board=new Uint8Array(225);
  black.forEach(i=>board[i]=1);white.forEach(i=>board[i]=2);
  const geometry=[black,white].map(a=>[...a].sort((a,b)=>a-b).join('.')).join('/');
  const reserved=[...new Set([...template.black,...template.white,...template.critical].map(map))];
  const target=Math.max(black.length,white.length);
  for(const [color,stones] of [[1,black],[2,white]])for(let n=stones.length;n<target;n++){
    const possible=emptyCells(board).filter(i=>reserved.every(j=>distance(i,j)>=3));
    if(!possible.length)return null;
    const i=pick(rng,possible);board[i]=color;reserved.push(i);
  }
  return {board,geometry,transform:t,dx,dy};
}

function previewSteps(line){return line.map((m,j)=>({...m,marks:[],move:coord(m.i),title:m.side===1?'黒の一手':'白の応手',text:`${m.side===1?'黒':'白'}${coord(m.i)}`,step:j+1}));}

export function makeMatePuzzle({mode='attack',moves=1,seed}={}){
  if(!['attack','survive'].includes(mode)||![1,2,3].includes(moves))throw Error('Unsupported mate-puzzle mode or own-move count');
  const rng=seed===undefined?Math.random:random(seed),defenseChoice=integer(rng,0,3);
  if(mode==='attack'){
    const family=pick(rng,moves===1?['five','overline']:moves===2?['openfour','doublefour']:['chain']);
    const base=makeTrainingPosition(lessons.find(l=>l.id===family),{rng});
    const choices=attackChoices(base.board,moves,defenseChoice),answers=Object.keys(choices).map(Number).sort((a,b)=>a-b);
    if(!answers.length||moves>1&&Object.keys(attackChoices(base.board,moves-1)).length)throw Error('Attack template has incorrect move distance');
    const line=choices[answers[0]].line;
    return {type:'mate',lessonId:`mate-attack-${moves}`,board:base.board,variantId:`mate:attack:${moves}:${base.variantId}`,label:`詰め ${moves}手`,goal:`自分の${moves}手以内で五連`,answers,steps:previewSteps(line),metadata:{mode,ownMoves:moves,goalType:'force-win',scope:'continuous-four',templateId:family,completeStrategy:false,defenseChoice,...{transform:base.metadata.transform,dx:base.metadata.dx,dy:base.metadata.dy}},certificate:{line,finish:[],scope:'continuous-four'}};
  }
  for(let attempt=0;attempt<80;attempt++){
    const template=survivalTemplate(moves,rng),placed=transformedTemplate(template,rng);
    if(!placed||winner(placed.board))continue;
    const tree=certifySurvival(placed.board,moves);
    if(!tree)continue;
    const {board,geometry,transform,dx,dy}=placed;
    return {type:'mate',lessonId:`mate-survive-${moves}`,board,variantId:`mate:survive:${moves}:${geometry}`,label:`逆詰め ${moves}手`,goal:`自分の${moves}手で負けを回避`,answers:tree.answers,steps:previewSteps(tree.line),metadata:{mode,ownMoves:moves,goalType:'certified-survival',scope:'every-wrong-move-loses-immediately',templateId:template.id,completeStrategy:false,transform,dx,dy},certificate:{...tree,scope:'all-legal-black-moves',allWrongCertified:true}};
  }
  throw Error('No fully certified survival position could be generated');
}

export function createMateState(position){
  if(position?.type!=='mate')throw Error('Mate position required');
  return {position,board:Uint8Array.from(position.board),answers:[...position.answers],ply:0,ownMovesPlayed:0,last:-1,whiteMove:null,done:false,status:'continue',node:position.metadata.mode==='survive'?position.certificate:null,history:[]};
}

export function judgeMateMove(state,i){
  const neutral={correct:false,done:state.done,state,whiteMove:null,refutation:null,refutationColor:null,replay:[],finish:[],status:'failed'};
  if(state.done||!Number.isInteger(i)||i<0||i>=225||state.board[i])return {...neutral,feedback:'空いている交点を選ぶ。'};
  const survive=state.position.metadata.mode==='survive',remaining=state.position.metadata.ownMoves-state.ownMovesPlayed;
  const choices=survive?state.node.branches:attackChoices(state.board,remaining,state.position.metadata.defenseChoice);
  const branch=choices[i];
  if(!branch){
    const b=state.board.slice();b[i]=1;
    const reply=survive?state.node.wrongReplies[i]:winningMoves(b,2)[0];
    if(reply!==undefined)return {...neutral,feedback:`白${coord(reply)}で五連。`,refutation:reply,refutationColor:2,replay:[move(i,1),move(reply,2)]};
    return {...neutral,feedback:`この問題は残り${remaining}手以内の四追い。相手の応手を絞れる手を探す。`,status:'outside-scope'};
  }
  const board=state.board.slice(),replay=[move(i,1)];board[i]=1;
  const done=!!branch.terminal;
  if(branch.whiteMove!==null){board[branch.whiteMove]=2;replay.push(move(branch.whiteMove,2));}
  const ownMovesPlayed=state.ownMovesPlayed+1;
  const node=survive&&!done?branch.child:null;
  const answers=done?[]:survive?[...node.answers]:Object.keys(attackChoices(board,state.position.metadata.ownMoves-ownMovesPlayed,state.position.metadata.defenseChoice)).map(Number).sort((a,b)=>a-b);
  if(!done&&!answers.length)throw Error('Certified continuation unexpectedly missing');
  const status=branch.terminal||'continue';
  const next={...state,board,answers,ply:state.ply+replay.length,ownMovesPlayed,last:branch.whiteMove??i,blackMove:i,whiteMove:branch.whiteMove,done,status,node,history:[...state.history,...replay]};
  return {correct:true,done,state:next,whiteMove:branch.whiteMove,refutation:null,refutationColor:null,replay,finish:done?branch.finish:[],status,feedback:done?status==='five'?'五連。':`勝ち確定。${winningMoves(board,1).map(coord).join('・')}の両方は止められない。`:`白${coord(branch.whiteMove)}。次の黒を選ぶ。`};
}
