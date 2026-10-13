import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../plugins/handheldControls.ts',import.meta.url),'utf8');
const code=transformSync(source.slice(source.indexOf('function editorText('),source.indexOf('const escapeSuggestion =')),{loader:'ts'}).code;
const read=new Function(code+';return editorText;')();
const text=value=>({nodeType:3,textContent:value});
function el(tag,attrs={},...children){return {nodeType:1,childNodes:children,getAttribute:k=>attrs[k]??null,value:attrs.value,matches(selector){return selector.split(',').some(part=>{const s=part.trim();if(!s.startsWith('['))return s===tag;const m=/^\[([^=*]+)(\*)?(?:="([^"]*)")?\]$/.exec(s);return m&&m[1] in attrs&&(m[3]===undefined||(m[2]?attrs[m[1]].includes(m[3]):attrs[m[1]]===m[3]));});}};}
test('mention preview excludes hidden username tooltip and Slate spacer',()=>{
 const mention=el('span',{'data-slate-void':'true'},el('span',{},text('@VisibleName')),el('span',{class:'hiddenVisually_hash'},text('hidden_username')),el('span',{'data-slate-spacer':'true'},text('\uFEFF')));
 assert.equal(read(el('div',{},mention,text(' '))),'@VisibleName ');
});
test('inline command metadata and accessibility duplicates never become draft text',()=>{
 assert.equal(read(el('div',{},text('/command '),el('span',{'aria-hidden':'true'},text('duplicate command')),el('span',{'role':'tooltip'},text('description')),text('argument'))),'/command argument');
});
test('paragraphs, emoji labels and form field values remain readable',()=>{
 assert.equal(read(el('div',{},el('div',{},text('first')),el('div',{},text('second '),el('img',{alt:':smile:'})))),'first\nsecond :smile:');
 assert.equal(read(el('input',{value:'a normal field'})),'a normal field');
});
test('caret fragments use the same filtered text representation',()=>{
 const fragment={nodeType:11,childNodes:[el('span',{},text('@Name')),el('span',{class:'sr-only'},text('hidden username')),text(' next')]};assert.equal(read(fragment),'@Name next');
});
