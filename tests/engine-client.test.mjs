import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../dist/engine-client.js';

test('loading progress, preparation, failure and retry remain separate from ready',t=>{
  const original=globalThis.Worker;
  class FakeWorker{postMessage(){} terminate(){this.terminated=true;} emit(data){this.onmessage({data});}}
  globalThis.Worker=FakeWorker;
  t.after(()=>{if(original===undefined)delete globalThis.Worker;else globalThis.Worker=original;});
  const statuses=[],progress=[];
  const engine=new Engine(s=>statuses.push(s),()=>{},d=>progress.push(d));
  engine.worker.emit({type:'progress',percent:31,stage:'download'});
  engine.worker.emit({type:'progress',percent:100,stage:'initialize'});
  assert.equal(engine.ready,false);assert.equal(progress.length,2);
  assert.equal(progress[1].stage,'initialize');
  const previous=engine.worker;
  engine.worker.emit({type:'error',message:'offline'});
  assert.equal(engine.ready,false);assert.equal(previous.terminated,true);
  engine.cancel();assert.notEqual(engine.worker,previous);assert.equal(engine.ready,false);
  engine.worker.emit({type:'ready'});assert.equal(engine.ready,true);
  assert.deepEqual(statuses,['loading','error','loading','ready']);
  engine.worker.terminate();clearTimeout(engine.bootTimer);
});
