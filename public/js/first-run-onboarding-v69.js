(() => {
  const KEY='hc:first-run-onboarding:v1';
  if(new URLSearchParams(location.search).get('admin')==='1'||new URLSearchParams(location.search).get('staff')==='1') return;
  try{if(localStorage.getItem(KEY)==='done')return}catch{}

  const slides=[
    {icon:'✦',kicker:'Добро пожаловать',title:'Ваша уборка — в одном приложении',text:'Оформляйте уборку за несколько минут, выбирайте удобную дату и держите всё под рукой.'},
    {icon:'⌁',kicker:'Просто и быстро',title:'Запись без звонков',text:'Выберите тип уборки, площадь, дополнительные услуги, дату и время. Перед отправкой вы увидите предварительную стоимость.'},
    {icon:'✓',kicker:'Всё под контролем',title:'Следите за заявками',text:'В разделе «Заявки» можно посмотреть статус и детали заказа. Если планы изменились — доступна отмена по правилам сервиса.'},
    {icon:'★',kicker:'Больше возможностей',title:'Бонусы и абонементы',text:'В профиле доступны уровень лояльности, промокоды и абонементы. А если нужна помощь — напишите менеджеру прямо из приложения.'}
  ];
  let index=0;
  const overlay=document.createElement('div');overlay.className='hc-onboarding-v69';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
  overlay.innerHTML=`<div class="hc-onboarding-card-v69"><button class="hc-onboarding-skip-v69" type="button">Пропустить</button><div class="hc-onboarding-icon-v69"></div><div class="hc-onboarding-kicker-v69"></div><h2></h2><p></p><div class="hc-onboarding-dots-v69"></div><button class="hc-onboarding-next-v69" type="button"></button></div>`;
  const card=overlay.firstElementChild, icon=card.querySelector('.hc-onboarding-icon-v69'), kicker=card.querySelector('.hc-onboarding-kicker-v69'), title=card.querySelector('h2'), text=card.querySelector('p'), dots=card.querySelector('.hc-onboarding-dots-v69'), next=card.querySelector('.hc-onboarding-next-v69');
  const done=()=>{try{localStorage.setItem(KEY,'done')}catch{} overlay.classList.add('is-leaving');setTimeout(()=>overlay.remove(),220)};
  const render=()=>{const s=slides[index];icon.textContent=s.icon;kicker.textContent=s.kicker;title.textContent=s.title;text.textContent=s.text;dots.innerHTML=slides.map((_,i)=>`<span class="${i===index?'active':''}"></span>`).join('');next.textContent=index===slides.length-1?'Начать пользоваться':'Далее';};
  next.addEventListener('click',()=>{if(index<slides.length-1){index++;render()}else done()});
  card.querySelector('.hc-onboarding-skip-v69').addEventListener('click',done);
  let startX=0;card.addEventListener('touchstart',e=>startX=e.touches[0]?.clientX||0,{passive:true});card.addEventListener('touchend',e=>{const dx=(e.changedTouches[0]?.clientX||0)-startX;if(dx<-55&&index<slides.length-1){index++;render()}else if(dx>55&&index>0){index--;render()}},{passive:true});
  render();
  const mount=()=>{document.body.appendChild(overlay);requestAnimationFrame(()=>overlay.classList.add('is-visible'))};
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',mount,{once:true}):mount();
})();
