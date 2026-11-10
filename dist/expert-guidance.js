import {coord,dirs,inside,index,winningMoves,winningLine,classify} from './game.js';
import {openFourMoves} from './training-positions.js';

const distance=(a,b)=>Math.max(Math.abs(a%15-b%15),Math.abs(Math.floor(a/15)-Math.floor(b/15)));
function supports(board,from,side){
  const out=[];
  for(let axis=0;axis<dirs.length;axis++)for(const sign of [-1,1]){
    const [dx,dy]=dirs[axis];
    for(let k=1;k<=4;k++){
      const x=from%15+dx*k*sign,y=Math.floor(from/15)+dy*k*sign;
      if(!inside(x,y)||board[index(x,y)]===3-side)break;
      if(board[index(x,y)]===side)out.push({i:index(x,y),axis});
    }
  }
  return out;
}

/** Board facts only. Connection geometry is not a claim of perfect optimality. */
export function annotateMove(input,i,side){
  if(!Number.isInteger(i)||i<0||i>=225||input[i]||![1,2].includes(side))throw Error('Invalid annotation move');
  const before=Uint8Array.from(input),board=before.slice(),ply=Array.from(before).filter(Boolean).length+1;
  const ownWinsBefore=winningMoves(before,side),opponentWinsBefore=winningMoves(before,3-side);
  const judgment=classify(before,i,side);
  board[i]=side;
  const ownWinsAfter=winningMoves(board,side),opponentWinsAfter=winningMoves(board,3-side);
  const connectedOwn=[],nearbyOwn=[],links=supports(before,i,side).map(s=>s.i);
  for(let j=0;j<225;j++)if(before[j]===side){
    if(distance(i,j)===1)connectedOwn.push(j);
    if(distance(i,j)<=2)nearbyOwn.push(j);
  }
  const terminal=!!winningLine(board,i).length;
  const nextOpenFours=terminal?[]:openFourMoves(board,side);
  const enemyOpenFoursBefore=terminal?[]:openFourMoves(before,3-side),enemyOpenFoursAfter=terminal?[]:openFourMoves(board,3-side);
  const stoppedOpenFours=enemyOpenFoursBefore.filter(p=>!enemyOpenFoursAfter.includes(p));
  const connectionTargets=[];
  if(!links.length&&!terminal){
    for(let p=0;p<225;p++)if(!board[p]){
      const lines=supports(board,p,side),newStone=lines.find(s=>s.i===i);
      if(newStone&&lines.some(s=>s.i!==i&&s.axis!==newStone.axis))connectionTargets.push(p);
    }
    connectionTargets.sort((a,b)=>distance(a,i)-distance(b,i)||a-b);
  }
  const nearestOpponent=Array.from(before,(_,p)=>p).filter(p=>before[p]===3-side).sort((a,b)=>distance(a,i)-distance(b,i)||a-b)[0]??null;
  let title,text,phase=ply<=6?'opening':'build',kind=judgment.type;
  const who=side===1?'黒':'白',other=side===1?'白':'黒';
  if(kind==='win'){
    title='五連を完成';text=`${who}${coord(i)}で五つ以上がつながる。`;phase='finish';
  }else if(kind==='miss-win'){
    title='即勝ちが残る';text=`着手前には${ownWinsBefore.map(coord).join('・')}で五連にできた。`;
  }else if(kind==='miss-block'){
    title='相手に即勝ちが残る';text=`${other}は${opponentWinsAfter.map(coord).join('・')}で五連を完成できる。`;
  }else if(kind==='forced-loss'){
    title='二つの勝ち口を受ける';text=`着手前から${other}に${opponentWinsBefore.map(coord).join('・')}の勝ち口があり、一手では塞ぎ切れない。`;phase='attack';
  }else if(kind==='fork'){
    title='勝ち口を二つ以上に';text=`勝ち口は${ownWinsAfter.map(coord).join('・')}。${other}には今すぐ五連にする手がない。`;phase='attack';
  }else if(kind==='block'){
    title='四を受ける';text=`${other}が${coord(i)}に打つと五連。その交点を先に塞ぐ。`;phase='attack';
  }else if(kind==='four'){
    title='四で応手を絞る';text=`${ownWinsAfter.map(coord).join('・')}で次に五連。${other}はこの勝ち口への対応が必要。`;phase='attack';
  }else if(nextOpenFours.length){
    kind='prepare-four';title='二つの勝ち口を狙う';text=`${nextOpenFours.map(coord).join('・')}への一手で、勝ち口が二つ以上になる。`;
  }else if(stoppedOpenFours.length){
    kind='stop-three';title='四になる前に受ける';text=`${other}${stoppedOpenFours.map(coord).join('・')}から二つの勝ち口を作る形を止める。`;
  }else if(links.length){
    kind='connect';title='石の連携を増やす';text=`${coord(i)}から${[...new Set(links)].map(coord).join('・')}へ、それぞれ相手の石を挟まない線が通る。`;
  }else if(connectionTargets.length){
    kind='prepare-connection';title='二方向の連結点を残す';text=`${connectionTargets.slice(0,3).map(coord).join('・')}は、${coord(i)}と別の自石を異なる方向から結べる空点。`;
  }else if(ply===1){
    kind='opening';title=i===112?'中央から始める':'初手を置く';text=i===112?`黒${coord(i)}。四方向へ伸ばす場所を残す。`:`黒${coord(i)}から始める。`;
  }else if(nearestOpponent!==null){
    kind='placement';title='相手との距離';
    const dx=Math.abs(i%15-nearestOpponent%15),dy=Math.abs(Math.floor(i/15)-Math.floor(nearestOpponent/15));
    text=`${who}${coord(i)}は${other}${coord(nearestOpponent)}から横${dx}・縦${dy}路。まだ自分の四はできていない。`;
  }else{
    kind='placement';title='四になる前の配置';text=`${who}${coord(i)}。即勝ち点はまだない。`;
  }
  return {phase,title,text,kind,facts:{ownWinsBefore,opponentWinsBefore,ownWinsAfter,opponentWinsAfter,connectedOwn,nearbyOwn,links:[...new Set(links)],nextOpenFours,stoppedOpenFours,connectionTargets,nearestOpponent}};
}
