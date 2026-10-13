import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../plugins/handheldControls.ts',import.meta.url),'utf8');
const code=transformSync(source.slice(source.indexOf('let extPad:'),source.indexOf('let errorCount = 0;')),{loader:'ts'}).code;
function setup(){
    const window={},document={hasFocus:()=>true};
    const input=new Function('window','document','navigator','performance','settings',code+';return {getPad,sampleControllerInput};')(window,document,{getGamepads:()=>[]},{now:()=>100},{store:{stickDeadzone:.2}});
    const send=(button=null,axes=[0,0,0,0])=>{const b=Array(17).fill(0);if(button!==null)b[button]=1;window.__hhExtPadSet({b,a:axes});};
    return {...input,send,window,document};
}
test('quick press/release pairs between frames remain separate presses',()=>{
    const p=setup();p.send();p.sampleControllerInput();p.send(13);p.send();p.send(13);p.send();
    const states=[];for(let i=0;i<4;i++){p.sampleControllerInput();states.push(p.getPad().buttons[13].pressed);}
    assert.deepEqual(states,[true,false,true,false]);
});
test('UI gamepad reads never consume input transitions',()=>{
    const p=setup();p.send();p.sampleControllerInput();p.send(0);p.send();
    for(let i=0;i<20;i++)assert.equal(p.getPad().buttons[0].pressed,false);
    p.sampleControllerInput();assert.equal(p.getPad().buttons[0].pressed,true);
});
test('analog updates coalesce without losing directional release/repress',()=>{
    const p=setup();p.send(null,[0,.6,0,0]);for(let i=0;i<100;i++)p.send(null,[0,.7+i*.001,0,0]);p.send();p.send(null,[0,.8,0,0]);
    p.sampleControllerInput();assert.ok(p.getPad().axes[1]>.7);
    p.sampleControllerInput();assert.equal(p.getPad().axes[1],0);
    p.sampleControllerInput();assert.equal(p.getPad().axes[1],.8);
});
test('background and native-dialog input does not replay into Discord',()=>{
    const p=setup();p.send(0);p.document.hasFocus=()=>false;p.send();p.document.hasFocus=()=>true;p.sampleControllerInput();assert.equal(p.getPad().buttons[0].pressed,false);
    p.window.__hhNativeFileChooser=true;p.send(1);p.send();p.window.__hhNativeFileChooser=false;p.sampleControllerInput();assert.equal(p.getPad().buttons[1].pressed,false);
});
