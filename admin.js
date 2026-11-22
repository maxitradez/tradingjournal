(function(){
'use strict';
var client=window.maxiSupabase;
var loginPanel=document.getElementById('login-panel');
var dashboard=document.getElementById('dashboard');
var statusEl=document.getElementById('status');
var loginMessage=document.getElementById('login-message');
var signout=document.getElementById('signout');
var loginForm=document.getElementById('login-form');
var loginSubmit=document.getElementById('login-submit');
var refreshButton=document.getElementById('refresh');
function message(el,text,isError){el.textContent=text||'';el.style.color=isError?'#fb7185':'';}
function showLogin(text,isError){dashboard.hidden=true;loginPanel.hidden=false;signout.hidden=true;if(text)message(loginMessage,text,isError);}
function showDashboard(){loginPanel.hidden=true;dashboard.hidden=false;signout.hidden=false;}
function fmtDate(value){if(!value)return '—';var d=new Date(value);return isNaN(d.getTime())?'—':d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});}
function escapeText(value){return String(value==null?'':value);}
async function loadOverview(){
 if(!client){message(statusEl,'Account service unavailable. Please try again later.',true);return;}
 refreshButton.disabled=true;message(statusEl,'Verifying administrator permission…');
 try{
  var sessionResult=await client.auth.getSession();
  var session=sessionResult.data&&sessionResult.data.session;
  if(!session){showLogin('Sign in with your existing PIPBOOK admin account.');return;}
  var result=await client.functions.invoke('pipbook-admin-overview',{body:{}});
  if(result.error){var detail=result.data&&result.data.error?result.data.error:result.error.message;throw new Error(detail||'Admin request failed.');}
  var data=result.data||{};
  if(!data.success||!data.metrics)throw new Error(data.error||'Could not verify administrator access.');
  showDashboard();message(statusEl,'Securely connected · Last updated '+new Date(data.generatedAt).toLocaleTimeString());
  document.getElementById('users').textContent=Number(data.metrics.totalUsers||0).toLocaleString();
  document.getElementById('trades').textContent=Number(data.metrics.totalTrades||0).toLocaleString();
  document.getElementById('accounts').textContent=Number(data.metrics.totalAccounts||0).toLocaleString();
  document.getElementById('metrics').hidden=false;
  var body=document.getElementById('recent-users');body.replaceChildren();
  (data.recentUsers||[]).forEach(function(user){
   var tr=document.createElement('tr');
   [escapeText(user.email),fmtDate(user.createdAt),user.confirmed?'Verified':'Pending'].forEach(function(value,index){
    var td=document.createElement('td');td.textContent=value;
    if(index===2)td.className=user.confirmed?'verified':'pending';
    tr.appendChild(td);
   });body.appendChild(tr);
  });
  if(!body.children.length){var empty=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=3;cell.textContent='No registered users yet.';cell.className='muted';empty.appendChild(cell);body.appendChild(empty);}
 }catch(error){message(statusEl,error.message||'Could not load admin data.',true);if(/not authorized|invalid|sign in|jwt/i.test(error.message||''))showLogin('This account does not have an active admin session. Sign in again or contact the administrator.',true);}
 finally{refreshButton.disabled=false;}
}
if(!client){showLogin('Could not connect to PIPBOOK account services.',true);return;}
loginForm.addEventListener('submit',async function(event){
 event.preventDefault();loginSubmit.disabled=true;message(loginMessage,'Signing in…');
 try{
  var result=await client.auth.signInWithPassword({email:document.getElementById('email').value.trim(),password:document.getElementById('password').value});
  if(result.error)throw result.error;
  document.getElementById('password').value='';
  await loadOverview();
 }catch(error){message(loginMessage,error.message||'Sign-in failed.',true);}
 finally{loginSubmit.disabled=false;}
});
signout.addEventListener('click',async function(){
 signout.disabled=true;var result=await client.auth.signOut();signout.disabled=false;
 if(result.error){message(statusEl,'Could not sign out. Please try again.',true);return;}
 showLogin('You are signed out.');
});
refreshButton.addEventListener('click',loadOverview);
client.auth.onAuthStateChange(function(){setTimeout(loadOverview,0);});
loadOverview();
})();