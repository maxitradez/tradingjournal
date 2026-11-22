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

async function loadFeedback(){
 var list=document.getElementById('feedback-list');
 var count=document.getElementById('feedback-count');
 if(!list||!count)return;
 list.textContent='Loading feedback…';
 try{
  var result=await client.functions.invoke('pipbook-feedback',{body:{action:'list'}});
  if(result.error){
   var detail=result.data&&result.data.error?result.data.error:result.error.message;
   throw new Error(detail||'Could not load feedback.');
  }
  var reports=result.data&&result.data.reports?result.data.reports:[];
  count.textContent=reports.length+' report'+(reports.length===1?'':'s');
  list.replaceChildren();
  if(!reports.length){var empty=document.createElement('p');empty.className='muted';empty.textContent='No feedback submitted yet. Reports from your testers will appear here.';list.appendChild(empty);return;}
  reports.forEach(function(report){
   var card=document.createElement('article');card.className='feedback-item';
   var head=document.createElement('div');head.className='feedback-item-head';
   var titleWrap=document.createElement('div');
   var title=document.createElement('h3');title.textContent=report.title||'Untitled report';
   var meta=document.createElement('p');meta.className='muted small';meta.textContent=(report.category==='bug'?'Bug report':report.category==='idea'?'Improvement idea':'Other feedback')+' · '+(report.area||'General')+' · '+fmtDate(report.created_at);
   titleWrap.appendChild(title);titleWrap.appendChild(meta);
   var email=document.createElement('span');email.className='feedback-reporter';email.textContent=report.user_email||'Unknown user';
   head.appendChild(titleWrap);head.appendChild(email);card.appendChild(head);
   var details=document.createElement('p');details.className='feedback-description';details.textContent=report.description||'';card.appendChild(details);
   var controls=document.createElement('div');controls.className='feedback-controls';
   var statusLabel=document.createElement('label');statusLabel.textContent='Status';
   var status=document.createElement('select');status.className='feedback-status';
   [['new','New'],['in_progress','In progress'],['resolved','Resolved'],['closed','Closed']].forEach(function(option){var o=document.createElement('option');o.value=option[0];o.textContent=option[1];status.appendChild(o);});
   status.value=report.status||'new';statusLabel.appendChild(status);controls.appendChild(statusLabel);
   var noteLabel=document.createElement('label');noteLabel.textContent='Private admin note';
   var note=document.createElement('textarea');note.rows=2;note.maxLength=1000;note.placeholder='Optional internal note…';note.value=report.admin_note||'';noteLabel.appendChild(note);controls.appendChild(noteLabel);
   var actionRow=document.createElement('div');actionRow.className='feedback-save-row';
   var save=document.createElement('button');save.type='button';save.className='quiet';save.textContent='Save update';
   var feedbackStatus=document.createElement('span');feedbackStatus.className='muted small';
   save.addEventListener('click',async function(){
    save.disabled=true;feedbackStatus.textContent='Saving…';
    try{
     var update=await client.functions.invoke('pipbook-feedback',{body:{action:'update',id:report.id,status:status.value,admin_note:note.value}});
     if(update.error){var msg=update.data&&update.data.error?update.data.error:update.error.message;throw new Error(msg||'Update failed.');}
     if(!update.data||!update.data.success)throw new Error((update.data&&update.data.error)||'Update failed.');
     feedbackStatus.textContent='Saved';
     report.status=status.value;report.admin_note=note.value;
    }catch(error){feedbackStatus.textContent=error.message||'Could not save.';}
    finally{save.disabled=false;}
   });
   actionRow.appendChild(save);actionRow.appendChild(feedbackStatus);controls.appendChild(actionRow);
   card.appendChild(controls);list.appendChild(card);
  });
 }catch(error){
  count.textContent='Unavailable';
  list.replaceChildren();
  var failed=document.createElement('p');failed.className='muted';failed.textContent=error.message||'Could not load feedback reports.';list.appendChild(failed);
 }
}

async function announcementRequest(payload){
 var result=await client.functions.invoke('pipbook-announcements',{body:payload});
 if(result.error)throw new Error(result.data&&result.data.error?result.data.error:result.error.message||'Announcement request failed.');
 if(!result.data||!result.data.success)throw new Error(result.data&&result.data.error?result.data.error:'Announcement request failed.');
 return result.data;
}
async function processAnnouncementEmails(id,statusNode){
 var rounds=0,last=null;
 while(rounds<10){
  rounds++;last=await announcementRequest({action:'send_batch',announcement_id:id});
  statusNode.textContent='Email delivery: '+last.sent+'/'+last.total+' sent · '+last.failed+' failed'+(last.remaining?' · '+last.remaining+' remaining':'');
  if(!last.remaining)break;
 }
 await loadAnnouncements();
 if(last&&last.remaining)statusNode.textContent+=' · Select Continue in the history to resume.';
 return last;
}
async function loadAnnouncements(){
 var list=document.getElementById('announcement-history'),count=document.getElementById('announcement-count');
 if(!list||!count)return;
 list.textContent='Loading announcements…';
 try{
  var data=await announcementRequest({action:'admin_list'}),items=data.announcements||[];
  count.textContent=items.length+' announcement'+(items.length===1?'':'s');list.replaceChildren();
  if(!items.length){var empty=document.createElement('p');empty.className='muted';empty.textContent='No announcements yet. Your published updates will appear here.';list.appendChild(empty);return;}
  items.forEach(function(item){
   var card=document.createElement('article');card.className='announcement-admin-item';
   var title=document.createElement('h4');title.textContent=item.title||'Untitled announcement';card.appendChild(title);
   var meta=document.createElement('div');meta.className='announcement-admin-meta';var q=item.email_queue||{};
   meta.textContent=fmtDate(item.published_at)+' · Email: '+(q.sent||0)+' sent, '+(q.queued||0)+' queued, '+(q.failed||0)+' failed';card.appendChild(meta);
   var message=document.createElement('p');message.textContent=item.message||'';card.appendChild(message);
   var actions=document.createElement('div');actions.className='announcement-admin-actions';
   var status=document.createElement('span');status.className='announcement-admin-status';
   status.textContent=item.archived_at?'Archived':item.email_status==='completed'?'Email delivery complete':item.email_status==='completed_with_errors'?'Email delivery finished with errors':item.email_status==='sending'?'Email delivery in progress':'Email delivery pending';
   actions.appendChild(status);
   if(!item.archived_at&&q.queued>0){
    var send=document.createElement('button');send.type='button';send.textContent='Continue email sending';
    send.addEventListener('click',async function(){send.disabled=true;status.textContent='Sending email batch…';try{await processAnnouncementEmails(item.id,status);}catch(error){status.textContent=error.message||'Email batch failed.';}finally{send.disabled=false;loadAnnouncements();}});
    actions.appendChild(send);
   }
   if(!item.archived_at&&q.failed>0){
    var retry=document.createElement('button');retry.type='button';retry.textContent='Retry failed emails';
    retry.addEventListener('click',async function(){retry.disabled=true;try{await announcementRequest({action:'retry_failed',announcement_id:item.id});await processAnnouncementEmails(item.id,status);}catch(error){status.textContent=error.message||'Could not retry failed emails.';}finally{retry.disabled=false;loadAnnouncements();}});
    actions.appendChild(retry);
   }
   if(!item.archived_at){
    var archive=document.createElement('button');archive.type='button';archive.textContent='Archive in-app';
    archive.addEventListener('click',async function(){archive.disabled=true;try{await announcementRequest({action:'archive',announcement_id:item.id});status.textContent='Archived';loadAnnouncements();}catch(error){status.textContent=error.message||'Could not archive announcement.';archive.disabled=false;}});
    actions.appendChild(archive);
   }
   card.appendChild(actions);list.appendChild(card);
  });
 }catch(error){count.textContent='Unavailable';list.replaceChildren();var failed=document.createElement('p');failed.className='muted';failed.textContent=error.message||'Could not load announcements.';list.appendChild(failed);}
}
function setupAnnouncementComposer(){
 var form=document.getElementById('announcement-form');if(!form)return;
 var publish=document.getElementById('announcement-publish'),status=document.getElementById('announcement-form-status');
 var testButton=document.getElementById('announcement-test-email');
 testButton.addEventListener('click',async function(){
  var title=document.getElementById('announcement-title').value.trim(),message=document.getElementById('announcement-message').value.trim();
  if(title.length<4||message.length<10){status.textContent='Enter a title and message before sending a test.';return;}
  testButton.disabled=true;status.textContent='Sending a test email only to the administrator…';
  try{var result=await announcementRequest({action:'send_test',title:title,message:message});status.textContent='Test email sent to '+result.sent_to+'. No users were emailed.';}
  catch(error){status.textContent=error.message||'Test email could not be sent.';}
  finally{testButton.disabled=false;}
 });

 form.addEventListener('submit',async function(event){
  event.preventDefault();var title=document.getElementById('announcement-title').value.trim(),message=document.getElementById('announcement-message').value.trim();
  if(title.length<4||message.length<10){status.textContent='Enter a title and a message before publishing.';return;}
  publish.disabled=true;status.textContent='Publishing in PIPBOOK…';
  try{
   var created=await announcementRequest({action:'publish',title:title,message:message});form.reset();
   status.textContent='Published in-app. Starting email delivery to '+created.email_total+' verified accounts…';await loadAnnouncements();
   if(created.email_total>0)await processAnnouncementEmails(created.announcement.id,status);
   else status.textContent='Published in-app. No verified email accounts were found to receive this update.';
  }catch(error){status.textContent=error.message||'Could not publish announcement.';}
  finally{publish.disabled=false;}
 });
}

async function loadOverview(){
 if(!client){message(statusEl,'Account service unavailable. Please try again later.',true);return;}
 refreshButton.disabled=true;message(statusEl,'Verifying administrator permission…');
 try{
  var sessionResult=await client.auth.getSession();
  var session=sessionResult.data&&sessionResult.data.session;
  if(!session){showLogin('Sign in with your existing PIPBOOK admin account.');return;}
  var result=await client.functions.invoke('pipbook-admin-overview',{body:{}});
  if(result.error){
   var responseStatus=result.error.context&&result.error.context.status;
   if(responseStatus===403){
    showLogin('Access denied. This PIPBOOK account does not have administrator permissions. Sign in with the authorized admin account.',true);
    return;
   }
   if(responseStatus===401){
    showLogin('Your session could not be verified. Please sign in again.',true);
    return;
   }
   var detail=result.data&&result.data.error?result.data.error:result.error.message;
   throw new Error(detail||'Admin request failed.');
  }
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
  loadFeedback();
  loadAnnouncements();
 }catch(error){
  showLogin('We could not verify administrator access. '+(error.message||'Please try again.'),true);
 }
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
setupAnnouncementComposer();
client.auth.onAuthStateChange(function(){setTimeout(loadOverview,0);});
loadOverview();
})();