import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../plugins/handheldControls.ts',import.meta.url),'utf8');
const helpers=transformSync(source.slice(source.indexOf('const escapeSuggestion ='),source.indexOf('let suggestions: string[] = [];')),{loader:'ts'}).code;
function setup(){
 const attrs=new Map(),root={setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
 const item=(label,disabled=false)=>({textContent:label,isConnected:true,getAttribute:k=>k==='aria-disabled'&&disabled?'true':null,closest:()=>null,querySelector:()=>null,click(){this.clicks=(this.clicks??0)+1;}});
 const rows=[item('/command'),item('nested argument'),item('disabled',true)];
 const list={isConnected:true,matches:()=>true,getAttribute:()=>null,closest:()=>root,querySelectorAll:()=>rows};
 const editor={getAttribute:k=>k==='aria-controls'?'native-popup':null};
 const document={getElementById:id=>id==='native-popup'?list:null};
 const api=new Function('document','kbTarget','isVisible',`let controllerActive=true,kbEl={};${helpers};return {readDiscordSuggestions,releaseAutocomplete,escapeSuggestion,setActive:v=>controllerActive=v};`)(document,()=>editor,()=>true);
 return {...api,attrs,rows,list,editor};
}
test('native choices come only from the editor-owned popup and disabled choices are omitted',()=>{
 const p=setup();assert.deepEqual(p.readDiscordSuggestions().map(r=>r.label),['/command','nested argument']);assert.ok(p.attrs.has('data-hh-autocomplete-mirror'));
 p.editor.getAttribute=()=>null;assert.deepEqual(p.readDiscordSuggestions(),[]);assert.equal(p.attrs.size,0);
});
test('native re-renders and nested command choices are read fresh',()=>{
 const p=setup();p.readDiscordSuggestions();p.rows[0].textContent='argument value';assert.equal(p.readDiscordSuggestions()[0].label,'argument value');
});
test('mouse/keyboard mode and closed popups restore native appearance',()=>{
 const p=setup();p.readDiscordSuggestions();p.setActive(false);assert.deepEqual(p.readDiscordSuggestions(),[]);assert.equal(p.attrs.size,0);
});
test('native suggestion names are escaped for mirrored HTML',()=>{
 const p=setup();assert.equal(p.escapeSuggestion('<name & value>'),'&lt;name &amp; value&gt;');
});
const acceptCode=transformSync(source.slice(source.indexOf('function acceptSuggestion('),source.indexOf('// Stick calibration')),{loader:'ts'}).code;
test('native suggestion activation uses Discord action without word replacement or sending',()=>{
 let clicks=0,scheduled=0;
 const target={isConnected:true,click:()=>clicks++};
 const accept=new Function('discordSuggestions','scheduleSuggestions','updateSuggestions',`let suggIndex=0;${acceptCode};return acceptSuggestion;`)([{target}],()=>scheduled++,()=>{});
 accept();assert.equal(clicks,1);assert.equal(scheduled,1);
 target.isConnected=false;accept();assert.equal(clicks,1);
});
