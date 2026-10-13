import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../plugins/handheldControls.ts',import.meta.url),'utf8');
const code=transformSync(source.slice(source.indexOf('function detectedControllerNames('),source.indexOf('function updateControllerStatus()')),{loader:'ts'}).code;
const names=new Function('padName',code+';return detectedControllerNames;')(id=>id);
const pad=(id,index,connected=true)=>({id,index,connected});
test('connection count includes every connected controller and excludes disconnected or test pads',()=>{
 assert.deepEqual(names([pad('First',0),null,pad('Second',1),pad('Gone',2,false),pad('HH Fake Pad',3)],false),['First','Second']);
});
test('bridge fallback never duplicates browser controllers',()=>{
 assert.deepEqual(names([pad('First',0),pad('First',0)],true),['First']);
 assert.equal(names([],true).length,1);assert.equal(names([],false).length,0);
});
