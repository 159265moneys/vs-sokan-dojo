import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parse,coord,winner} from '../dist/game.js';
import {annotateMove} from '../dist/expert-guidance.js';
export const explainCourseMove=annotateMove;

async function loadEngine(){
  const dir=path.resolve('dist/engine'),file=path.join(dir,'rapfi-single-simd128.js');
  const mod=new Module(file);mod.filename=file;mod._compile(fs.readFileSync(file,'utf8'),file);
  const data=Buffer.concat([0,1,2].map(i=>fs.readFileSync(path.join(dir,`weights-${i}.bin`))));
  let resolveSearch=null,info={},banner=[];
  const instance=await mod.exports({
    wasmBinary:fs.readFileSync(path.join(dir,'rapfi-single-simd128.wasm')),
    getPreloadedPackage:()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),
    onReceiveStdout:line=>{
      if(line.startsWith('INFO ')){const [,key,...value]=line.split(' ');info[key]=value.join(' ');}
      else if(/^\d+,\d+$/.test(line)){const [x,y]=line.split(',').map(Number);const resolve=resolveSearch;resolveSearch=null;resolve?.({i:y*15+x,info:{...info}});}
      else if(line.startsWith('ERROR'))throw Error(line);
      else if(line!=='OK')banner.push(line);
    },
    onReceiveStderr:line=>console.error(line),
  });
  const command=s=>instance.sendCommand(s);
  for(const s of ['ABOUT','START 15','INFO RULE 0','INFO THREAD_NUM 1','INFO HASH_SIZE 65536','INFO PONDERING 0','INFO SHOW_DETAIL 3','INFO STRENGTH 100','INFO MAX_DEPTH 100','INFO MAX_NODE 0','INFO TIMEOUT_MATCH 100000000','INFO TIME_LEFT 100000000'])command(s);
  return {banner,search:async(moves,ms)=>{
    info={};const side=moves.length%2+1;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Engine search timeout')),ms+30000);
      resolveSearch=r=>{clearTimeout(timer);resolve(r);};
      command('INFO TIMEOUT_TURN '+ms);
      command('YXBOARD '+moves.map((m,j)=>`${m.i%15},${Math.floor(m.i/15)},${j%2+1===side?1:2}`).join(' ')+' DONE');
      command('YXNBEST 1');
    });
  }};
}

async function main(){
  const args=process.argv.slice(2),option=(name,fallback)=>{const j=args.indexOf('--'+name);return j>=0?args[j+1]:fallback;};
  if(args.includes('--refresh-annotations')){
    const output='dist/expert-courses.json',data=JSON.parse(fs.readFileSync(output,'utf8'));
    for(const course of data.courses){const board=new Uint8Array(225);course.moves=course.moves.map(m=>{const move={...m,...annotateMove(board,m.i,m.side)};board[m.i]=m.side;return move;});}
    fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');
    console.log('Updated factual annotations without changing recorded moves or engine output.');return;
  }
  const id=option('id','max-natural'),blackMs=Number(option('black-ms','8000')),whiteMs=Number(option('white-ms','8000'));
  if(!Number.isFinite(blackMs)||blackMs<=0||whiteMs!==8000)throw Error('White must use the app maximum, 8000 ms.');
  const forcedCoordinate=option('white-opening',null),forcedIndex=forcedCoordinate?parse(forcedCoordinate):null;
  fs.mkdirSync('artifacts',{recursive:true});
  const logFile='artifacts/expert-courses-progress.jsonl',checkpointFile=`artifacts/expert-course-${id}.json`;
  const log=value=>{fs.appendFileSync(logFile,JSON.stringify({timestamp:new Date().toISOString(),course:id,...value})+'\n');console.log(JSON.stringify(value));};
  log({status:'loading',blackMs,whiteMs,forcedWhiteOpening:forcedCoordinate});
  const blackEngine=await loadEngine(),whiteEngine=await loadEngine();
  const course={id,title:option('title',forcedCoordinate?`最強CPU実戦・白${forcedCoordinate}分岐`:'最強CPU実戦・中央からの勝ち筋'),openingKind:forcedCoordinate?`forced-white-${forcedCoordinate}`:'natural',blackMs,whiteMs,forcedOpening:forcedCoordinate?{ply:2,i:forcedIndex,side:2}:null,moves:[],result:null};
  const board=new Uint8Array(225);
  for(let ply=1;ply<=225;ply++){
    const side=ply%2?1:2,ms=side===1?blackMs:whiteMs,forced=ply===2&&forcedIndex!==null;
    const start=Date.now();
    const r=forced?{i:forcedIndex,info:{SOURCE:'forced-opening'}}:await(side===1?blackEngine:whiteEngine).search(course.moves,ms);
    if(!Number.isInteger(r.i)||r.i<0||r.i>=225||board[r.i]||winner(board))throw Error('Engine returned an illegal move');
    const facts=explainCourseMove(board,r.i,side,ply);
    course.moves.push({i:r.i,side,...facts,info:r.info,searchMs:forced?0:ms,elapsedMs:Date.now()-start,forced});
    board[r.i]=side;
    course.result=winner(board)===1?'win':winner(board)===2?'loss':ply===225?'draw':null;
    fs.writeFileSync(checkpointFile,JSON.stringify(course,null,2)+'\n');
    log({ply,side,move:coord(r.i),kind:facts.kind,eval:r.info.EVAL,depth:r.info.DEPTH,elapsedMs:Date.now()-start,result:course.result});
    if(course.result)break;
  }
  if(course.result!=='win'){log({status:'not-published',result:course.result,checkpoint:checkpointFile});process.exitCode=2;return;}
  const output='dist/expert-courses.json';
  const existing=fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8')):null;
  const document={version:1,engine:{name:'Rapfi',version:'0.43.01',platform:'Wasm SIMD / single thread / Node.js generation',rule:0,strength:100,threads:1,hashKiB:65536,independentSides:true,source:'engine/SOURCE.txt',sha256:crypto.createHash('sha256').update(fs.readFileSync('dist/engine/rapfi-single-simd128.wasm')).digest('hex'),banner:blackEngine.banner.filter(s=>s.includes('Rapfi')||s.includes('version'))},rule:'freestyle15',limitations:['実際に終局まで打った特定の対局例。全応手の完全戦略ではない。','白は本アプリ最強と同じ strength 100・8000 ms。端末性能や探索状態で着手は変わる。','評価値と読み筋は着手時の探索記録であり、最短勝利や完全最適の証明ではない。','相手の初手を固定した教材は forcedOpening に明記。以後の白は最強設定で探索。','この教材だけで人間の最強CPUへの勝利・無敗・習得を保証しない。'],courses:[...(existing?.courses||[]).filter(c=>c.id!==course.id),course]};
  fs.writeFileSync(output,JSON.stringify(document,null,2)+'\n');
  log({status:'published',result:course.result,plies:course.moves.length,output});
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  main().then(()=>process.exit(process.exitCode||0)).catch(error=>{console.error(error);process.exit(1);});
}
