(function(){
'use strict';
var client=window.maxiSupabase,openButton=document.getElementById('announcements-open');
if(!client||!openButton)return;
var overlay=document.createElement('div');overlay.className='pipbook-announcement-overlay';overlay.hidden=true;
overlay.innerHTML='<section class="pipbook-announcement-dialog" role="dialog" aria-modal="true" aria-labelledby="pipbook-announcement-heading"><header class="pipbook-announcement-head"><div><p class="eyebrow">PIPBOOK UPDATES</p><h2 id="pipbook-announcement-heading">Announcements</h2><p class="pipbook-announcement-subtitle">News and updates from the PIPBOOK team.</p></div><button type="button" class="xbtn" id="pipbook-announcement-close" aria-label="Close announcements">×</button></header><div id="pipbook-announcement-list" class="pipbook-announcement-list"><p class="muted">Loading announcements…</p></div></section>';
document.body.appendChild(overlay);
var closeButton=overlay.querySelector('#pipbook-announcement-close'),list=overlay.querySelector('#pipbook-announcement-list'),announcements=[];
var unreadBadge=document.createElement('span');unreadBadge.className='announcement-unread-count';unreadBadge.id='announcements-unread-count';unreadBadge.hidden=true;openButton.appendChild(unreadBadge);
function fmtDate(value){var d=new Date(value);return isNaN(d.getTime())?'':d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});}
function setUnread(count){unreadBadge.textContent=count>99?'99+':String(count);unreadBadge.hidden=!count;openButton.setAttribute('aria-label',count?count+' unread PIPBOOK updates':'PIPBOOK updates');}
async function invoke(body){var result=await client.functions.invoke('pipbook-announcements',{body:body});if(result.error)throw new Error(result.data&&result.data.error?result.data.error:result.error.message||'Request failed.');if(!result.data||!result.data.success)throw new Error(result.data&&result.data.error?result.data.error:'Request failed.');return result.data;}
function render(){
 list.replaceChildren();setUnread(announcements.filter(function(a){return !a.read_at;}).length);
 if(!announcements.length){var empty=document.createElement('p');empty.className='muted';empty.textContent='No announcements yet. New PIPBOOK updates will appear here.';list.appendChild(empty);return;}
 announcements.forEach(function(item){
  var card=document.createElement('article');card.className='pipbook-announcement-card'+(item.read_at?' is-read':' is-unread');
  var toggle=document.createElement('button');toggle.type='button';toggle.className='pipbook-announcement-toggle';
  var dot=document.createElement('span');dot.className='pipbook-announcement-dot';dot.setAttribute('aria-hidden','true');
  var heading=document.createElement('span');heading.className='pipbook-announcement-title';heading.textContent=item.title;
  var date=document.createElement('span');date.className='pipbook-announcement-date';date.textContent=fmtDate(item.published_at);
  toggle.appendChild(dot);toggle.appendChild(heading);toggle.appendChild(date);
  var message=document.createElement('p');message.className='pipbook-announcement-message';message.textContent=item.message;message.hidden=true;
  toggle.addEventListener('click',async function(){message.hidden=!message.hidden;if(!message.hidden&&!item.read_at){try{await invoke({action:'mark_read',announcement_id:item.id});item.read_at=new Date().toISOString();card.classList.remove('is-unread');card.classList.add('is-read');setUnread(announcements.filter(function(a){return !a.read_at;}).length);}catch(error){var note=document.createElement('p');note.className='pipbook-announcement-error';note.textContent='Could not mark this update as read. '+error.message;card.appendChild(note);}}});
  card.appendChild(toggle);card.appendChild(message);list.appendChild(card);
 });
}
async function load(){list.textContent='Loading announcements…';try{var data=await invoke({action:'list_for_user'});announcements=data.announcements||[];render();}catch(error){list.replaceChildren();var failed=document.createElement('p');failed.className='pipbook-announcement-error';failed.textContent=error.message||'Could not load announcements.';list.appendChild(failed);}}
async function refreshUnread(){try{var data=await invoke({action:'list_for_user'});announcements=data.announcements||[];setUnread(announcements.filter(function(a){return !a.read_at;}).length);}catch(e){setUnread(0);}}
function show(){overlay.hidden=false;load();}function hide(){overlay.hidden=true;}
openButton.addEventListener('click',show);closeButton.addEventListener('click',hide);overlay.addEventListener('click',function(e){if(e.target===overlay)hide();});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!overlay.hidden)hide();});
client.auth.onAuthStateChange(function(event,session){if(session&&session.user)refreshUnread();else{announcements=[];setUnread(0);hide();}});
client.auth.getSession().then(function(result){if(result.data&&result.data.session)refreshUnread();});
document.addEventListener('visibilitychange',function(){if(!document.hidden&&overlay.hidden)refreshUnread();});
})();