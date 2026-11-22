(function(){
'use strict';
var client=window.maxiSupabase;
var openButton=document.getElementById('feedback-open');
var modal=document.getElementById('feedback-modal');
var form=document.getElementById('feedback-form');
var closeButton=document.getElementById('feedback-close');
var cancelButton=document.getElementById('feedback-cancel');
var submitButton=document.getElementById('feedback-submit');
var message=document.getElementById('feedback-message');
if(!openButton||!modal||!form)return;
function setMessage(text,type){message.textContent=text||'';message.className='feedback-message'+(type?' is-'+type:'');}
function close(){modal.hidden=true;}
function open(){modal.hidden=false;setMessage('');document.getElementById('feedback-subject').focus();}
openButton.addEventListener('click',open);
closeButton.addEventListener('click',close);
cancelButton.addEventListener('click',close);
modal.addEventListener('click',function(event){if(event.target===modal)close();});
document.addEventListener('keydown',function(event){if(event.key==='Escape'&&!modal.hidden)close();});
form.addEventListener('submit',async function(event){
 event.preventDefault();
 if(!client||!client.functions){setMessage('PIPBOOK services are unavailable. Please try again later.','error');return;}
 submitButton.disabled=true;setMessage('Sending your feedback…');
 try{
  var sessionResult=await client.auth.getSession();
  if(sessionResult.error)throw sessionResult.error;
  if(!sessionResult.data||!sessionResult.data.session){setMessage('Your session has expired. Please sign in again.','error');return;}
  var result=await client.functions.invoke('pipbook-feedback',{body:{
   action:'submit',
   category:document.getElementById('feedback-category').value,
   area:document.getElementById('feedback-area').value,
   title:document.getElementById('feedback-subject').value.trim(),
   description:document.getElementById('feedback-details').value.trim()
  }});
  if(result.error){
   var detail=result.data&&result.data.error?result.data.error:result.error.message;
   throw new Error(detail||'Your feedback could not be sent.');
  }
  if(!result.data||!result.data.success)throw new Error((result.data&&result.data.error)||'Your feedback could not be sent.');
  form.reset();
  setMessage('Thanks — your feedback has been submitted. We appreciate you helping us improve PIPBOOK.','success');
 }catch(error){setMessage(error.message||'Your feedback could not be sent. Please try again.','error');}
 finally{submitButton.disabled=false;}
});
})();