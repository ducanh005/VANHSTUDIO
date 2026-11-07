import React, {useEffect,useState} from 'react';

export default function PiperRuntimeStatus() {
  const [message,setMessage]=useState('Đang kiểm tra runtime Piper đã cài...');
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;
    setMessage('Đang kiểm tra runtime Piper đã cài...');
    void(async()=>{
      try {
        const api=window.vanhsub?.aiStudio?.getPiperStatus;
        if(!api)throw new Error('Bản app này chưa hỗ trợ kiểm tra Piper.');
        const result=await api();
        if(active)setMessage(result.ready?'Runtime/model Piper tiếng Việt đã được kiểm tra. Không tự cài hoặc mở server.':result.reason||'Piper chưa sẵn sàng.');
      }catch{if(active)setMessage('Không kiểm tra được Piper; hãy kiểm tra runtime đã cài.');}
    })();
    return()=>{active=false;};
  },[retry]);
  return <div className="mt-2 text-xs text-text-muted" role="status">{message}
    <button type="button" className="ml-2 underline" onClick={()=>setRetry(v=>v+1)}>Kiểm tra lại Piper</button>
  </div>;
}
