(() => {
  let counts = {};
  let loading = null;
  const headers = () => ({'X-Telegram-Init-Data':window.Telegram?.WebApp?.initData || ''});
  async function loadCounts(){
    if(loading) return loading;
    loading=fetch('/api/admin-ultra7',{headers:headers(),cache:'no-store'})
      .then(r=>r.ok?r.json():null).then(d=>{counts=d?.counts||{};return counts}).catch(()=>counts).finally(()=>{loading=null});
    return loading;
  }
  function countFor(segment){
    if(segment==='staff') return Number(counts.staff||0);
    if(segment==='active') return Number(counts.active||0);
    if(segment==='inactive') return Number(counts.inactive||0);
    return Number(counts.all_users ?? counts.all ?? counts.marketing ?? 0);
  }
  async function patchBroadcast(){
    const form=document.querySelector('[data-broadcast-form]');
    if(!form||form.dataset.v69==='1') return;
    form.dataset.v69='1';
    const select=form.querySelector('[name=segment]');
    const counter=document.querySelector('[data-audience-count]');
    const label=counter?.previousElementSibling;
    const note=form.querySelector('.u7-broadcast-safe-v64');
    if(!select) return;
    select.innerHTML='\n<option value="all">Все пользователи бота</option>\n<option value="staff">Все сотрудники</option>\n<option value="active">Клиенты с активным заказом</option>\n<option value="inactive">Клиенты без активного заказа</option>';
    if(label) label.textContent='Получателей в выбранной группе';
    if(note) note.textContent='Рассылка уйдёт только выбранной группе. Недоступные или заблокировавшие бота аккаунты будут показаны как ошибки доставки.';
    await loadCounts();
    const refresh=()=>{if(counter)counter.textContent=String(countFor(select.value));};
    select.addEventListener('change',refresh);
    refresh();
  }
  function patchClient(){
    document.querySelectorAll('.u7-home-help [data-manager]').forEach(button=>{
      if(button.dataset.v69==='1') return;
      button.dataset.v69='1';
      button.textContent='Написать менеджеру';
      button.setAttribute('aria-label','Написать менеджеру');
    });
  }
  function patch(){patchClient();patchBroadcast();}
  const observer=new MutationObserver(patch);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',patch,{once:true});
  patch();
})();
