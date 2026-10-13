import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../plugins/handheldControls.ts',import.meta.url),'utf8');
const helpers=transformSync(source.slice(source.indexOf('const escapeSuggestion ='),source.indexOf('let suggestions: string[] = [];')),{loader:'ts'}).code;
function setup(){
 const attrs=new Map(),root={querySelectorAll:()=>[],setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
 const item=(label,disabled=false)=>({textContent:label,isConnected:true,getAttribute:k=>k==='aria-disabled'&&disabled?'true':null,closest:()=>null,matches:()=>false,contains:()=>false,querySelector:()=>null,click(){this.clicks=(this.clicks??0)+1;}});
 const rows=[item('/command'),item('nested argument'),item('disabled',true)];
 const list={isConnected:true,matches:()=>true,getAttribute:()=>null,closest:()=>root,querySelectorAll:selector=>selector.includes("aria-controls")?[]:rows};
 const editor={closest:()=>null,getAttribute:k=>k==='aria-controls'?'native-popup':null};
 const document={getElementById:id=>id==='native-popup'?list:null};
 const api=new Function('document','kbTarget','isVisible',`let controllerActive=true,kbEl={};${helpers};return {readDiscordSuggestions,releaseAutocomplete,escapeSuggestion,setActive:v=>controllerActive=v};`)(document,()=>editor,()=>true);
 return {...api,attrs,rows,list,editor,document};
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
 const target={isConnected:true,matches:()=>false,click:()=>clicks++};
 const accept=new Function('discordSuggestions','scheduleSuggestions','updateSuggestions',`let suggIndex=0;${acceptCode};return acceptSuggestion;`)([{target}],()=>scheduled++,()=>{});
 accept();assert.equal(clicks,1);assert.equal(scheduled,1);
 target.isConnected=false;accept();assert.equal(clicks,1);
});

test('slash command lists inside the editor form work without aria-controls',()=>{
 const p=setup();p.editor.getAttribute=()=>null;p.editor.closest=()=>({querySelector:()=>p.list});assert.equal(p.readDiscordSuggestions().length,2);assert.ok(p.attrs.has('data-hh-autocomplete-mirror'));
});

test('owned nested popups are mirrored and restored when their trigger closes',()=>{
 const p=setup(),attrs=new Map();
 const child={textContent:'Nested value',isConnected:true,getAttribute:()=>null,closest:()=>null,matches:()=>false,contains:()=>false,querySelector:()=>null};
 const popup={querySelector:()=>child,querySelectorAll:s=>s.includes('aria-controls')?[]:[child],setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
 let expanded=true;const trigger={getAttribute:k=>k==='aria-controls'?'nested':k==='aria-expanded'?(expanded?'true':'false'):null};
 const original=p.document.getElementById;p.document.getElementById=id=>id==='nested'?popup:original(id);
 p.list.querySelectorAll=s=>s.includes('aria-controls')?[trigger]:p.rows;
 assert.equal(p.readDiscordSuggestions().length,3);assert.ok(attrs.has('data-hh-autocomplete-mirror'));
 expanded=false;assert.equal(p.readDiscordSuggestions().length,2);assert.equal(attrs.size,0);
});
