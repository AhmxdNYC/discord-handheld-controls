import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../plugins/handheldControls.ts',import.meta.url),'utf8');
const code=transformSync(source.slice(source.indexOf('let controllerActive = false;'),source.indexOf('export default definePlugin({')),{loader:'ts'}).code;
function setup(){
 const overlays=[{hidden:false}],styleEl={disabled:false},varsEl={disabled:false},attrs=new Set(['data-hh-btns','data-hh-menu-style']);
 const document={querySelectorAll:q=>q==='[data-hh-held]'?[]:overlays,documentElement:{removeAttribute:a=>attrs.delete(a)}};
 const window={};
 const prelude=`let prevPressed=[],extTransitions=[],sampledExtPad,extPad=null,calibEl=null,calib=null,adjustMode=false,typingMode=false,heldDir=null,holdState=new Map(),section=null,sectionKey='',mode='sections',innerMsg=null,returnStack=[],nativePickerLock=null,composerSendEl=null,lastPadUse=0; const noop=()=>{};const closeKeyboard=noop,closeDrawer=noop,toggleHelp=noop,togglePanel=noop,setItem=noop,shiftTitle=noop,bumpChecks=noop;`;
 const pad={buttons:[{pressed:true,value:1}],axes:[0,0,0,0]};
 const methods=new Function('window','document','styleEl','varsEl','getPad','stickDir','settings',prelude+code+`;return {activateController,usePointerKeyboard,onPointerDown,onPointerMove,onKeyboardInput,onWheelInput,controllerActivity,active:()=>controllerActive,baseline:()=>lastControllerActivity};`)(window,document,styleEl,varsEl,()=>pad,()=>null,{store:{stickDeadzone:.2}});
 return {...methods,styleEl,varsEl,attrs,overlays,pad};
}
test('real mouse, keyboard and scrolling input removes all controller presentation',()=>{
 for(const [handler,event] of [['onPointerDown',{}],['onPointerMove',{movementX:1}],['onKeyboardInput',{}],['onWheelInput',{deltaY:1}]]){
  const p=setup();p.activateController();p[handler]({isTrusted:true,...event});
  assert.equal(p.active(),false);assert.equal(p.styleEl.disabled,true);assert.equal(p.varsEl.disabled,true);assert.equal(p.overlays[0].hidden,true);assert.equal(p.attrs.size,0);
 }
});
test('controller-generated synthetic clicks and keys do not exit controller mode',()=>{
 const p=setup();p.activateController();p.onPointerDown({isTrusted:false});p.onKeyboardInput({isTrusted:false});assert.equal(p.active(),true);
});
test('switch captures held controller input and can restore styles on fresh controller use',()=>{
 const p=setup();p.activateController();p.usePointerKeyboard();assert.equal(p.baseline(),p.controllerActivity(p.pad));p.activateController();assert.equal(p.styleEl.disabled,false);assert.equal(p.varsEl.disabled,false);assert.equal(p.overlays[0].hidden,false);
});
