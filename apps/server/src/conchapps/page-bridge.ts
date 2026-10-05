/** The sealed page side of ADR 0092. It only calls its own host bridge. */
export const PAGE_DATA_BRIDGE = String.raw`
var observers=[];
function unwrap(r){
  if(!r.ok)return r;
  var s=r.json;
  if(!s||!s.value)return {ok:false,reason:'error',message:'No saved result yet.',empty:true};
  if(!s.value.ok)return {ok:false,reason:'error',message:s.value.text||'The query failed.',at:s.at,stale:true};
  if(s.value.json&&s.value.json.setup_required)return {ok:false,reason:'missing-settings',message:s.value.json.message||'Add this app’s settings in Apps.'};
  return Object.assign({},s.value,{at:s.at,stale:s.stale});
}
function query(tool,input,options){
  return q('__query',{tool:tool,input:input||{},mode:options&&options.mode||'read'}).then(unwrap);
}
var state=Object.freeze({
  get:function(key){return q('__state',{op:'get',key:key}).then(function(r){if(!r.ok)throw new Error(r.message);return r.json});},
  set:function(key,value){return q('__state',{op:'set',key:key,value:value}).then(function(r){if(!r.ok)throw new Error(r.message);});},
  delete:function(key){return q('__state',{op:'delete',key:key}).then(function(r){if(!r.ok)throw new Error(r.message);});}
});
function observe(tool,input,options,callback){
  if(typeof options==='function'){callback=options;options={};}
  options=options||{};
  if(typeof callback!=='function')throw new Error('Give conch.observe a callback.');
  var stopped=false,busy=false,again=false,queuedForce=false,timer,last,failures=0;
  var every=Math.max(15,Math.min(86400,Number(options.every)||60))*1000;
  function visible(){return document.visibilityState!=='hidden';}
  function emit(value){if(!stopped){last=value;try{callback(value)}catch(e){}}}
  function schedule(){clearTimeout(timer);if(!stopped&&visible())timer=setTimeout(function(){load(false);},Math.min(every*Math.pow(2,failures),Math.max(every,900000)));}
  function load(force){
    if(stopped||!visible())return;
    if(busy){again=true;queuedForce=queuedForce||force;return;}
    busy=true;
    query(tool,input,{mode:'peek'}).then(function(cached){
      if(stopped||!visible())return;
      if(cached.ok)emit(Object.assign({},cached,{refreshing:force||cached.stale}));
      if(!cached.ok&&(cached.reason==='off'||cached.reason==='missing-settings'||cached.reason==='confirm'))return cached;
      if(cached.ok&&!cached.stale&&!force)return cached;
      return query(tool,input,{mode:force?'refresh':'read'});
    }).then(function(fresh){
      if(stopped||!fresh)return;
      if(fresh.ok){failures=0;emit(Object.assign({},fresh,{refreshing:false}));}
      else{
        failures=Math.min(failures+1,5);
        if(fresh.reason==='off'||fresh.reason==='missing-settings'||fresh.reason==='confirm')emit(fresh);
        else if(last&&last.ok)emit(Object.assign({},last,{stale:true,refreshing:false,error:fresh.message||'The update failed.'}));
        else emit(fresh);
      }
    }).catch(function(){failures=Math.min(failures+1,5);emit({ok:false,reason:'error',message:'The query could not be loaded.'});}).finally(function(){
      busy=false;if(again){again=false;var forceNext=queuedForce;queuedForce=false;load(forceNext);}else schedule();
    });
  }
  function wake(){if(visible())load(false);else clearTimeout(timer);}
  document.addEventListener('visibilitychange',wake);
  window.addEventListener('focus',wake);
  var entry={wake:wake};observers.push(entry);load(false);
  return Object.freeze({
    refresh:function(){load(true);},
    stop:function(){stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);observers=observers.filter(function(x){return x!==entry;});}
  });
}
function refreshQueries(){observers.forEach(function(x){x.wake();});}
`;
