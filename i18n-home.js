/* Our Love Hub home language, no modification to unlock/date requirements */
(()=>{'use strict';
const TEXTS={"只属于我们的":{"zh":"只属于我们的","en":"Only Ours","my":"ကိုယ်တို့နှစ်ယောက်အတွက်ပဲ"},"小小世界":{"zh":"小小世界","en":"Little World","my":"ကမ္ဘာငယ်လေး"},"有些日子，值得记一辈子。":{"zh":"有些日子，值得记一辈子。","en":"Some days are worth remembering forever.","my":"တချို့နေ့ရက်လေးတွေက တစ်သက်လုံး မှတ်မိနေချင်စရာပါ။"},"用我们的纪念日，打开藏着回忆的小宇宙。":{"zh":"用我们的纪念日，打开藏着回忆的小宇宙。","en":"Use our special date to open our world of memories.","my":"ကိုယ်တို့နှစ်ယောက်ရဲ့ အမှတ်တရနေ့လေးနဲ့ အမှတ်တရတွေ သိမ်းထားတဲ့ ကမ္ဘာငယ်လေးကို ဖွင့်လိုက်ပါနော်။"},"我们在一起的那一天":{"zh":"我们在一起的那一天","en":"The Day We Became Us","my":"ကိုယ်တို့နှစ်ယောက် စချစ်ခဲ့တဲ့နေ့"},"选择正确的年、月、日，就能进入 ♡":{"zh":"选择正确的年、月、日，就能进入 ♡","en":"Choose the right day, month and year to enter ♡","my":"မှန်ကန်တဲ့ ရက်၊ လ၊ နှစ်ကို ရွေးပြီး ဝင်လိုက်ပါနော် ♡"},"打开我们的世界":{"zh":"打开我们的世界","en":"Open Our World","my":"ကိုယ်တို့နှစ်ယောက်ရဲ့ ကမ္ဘာလေးကို ဖွင့်မယ်"},"From our first day · to forever":{"zh":"From our first day · to forever","en":"From our first day · to forever","my":"ပထမဆုံးနေ့လေးကနေ ထာဝရအထိ"},"Our Love Hub 爱心 Logo":{"zh":"Our Love Hub 爱心 Logo","en":"Our Love Hub heart logo","my":"Our Love Hub အချစ်အမှတ်တံဆိပ်"},"Our Love Hub · 只属于我们的世界 ♡":{"zh":"Our Love Hub · 只属于我们的世界 ♡","en":"Our Love Hub · Our Little World ♡","my":"Our Love Hub · ကိုယ်တို့နှစ်ယောက်ရဲ့ ကမ္ဘာလေး ♡"},"先选择我们在一起的日期哦 ♡":{"zh":"先选择我们在一起的日期哦 ♡","en":"Choose our special date first ♡","my":"ကိုယ်တို့နှစ်ယောက်ရဲ့ နေ့လေးကို အရင်ရွေးပေးပါနော် ♡"},"好像不是那一天，再想想我们的故事 ♡":{"zh":"好像不是那一天，再想想我们的故事 ♡","en":"That does not seem to be our day. Try remembering our story ♡","my":"ဒီနေ့လေး မဟုတ်သေးဘူးထင်တယ်။ ကိုယ်တို့ရဲ့ ဇာတ်လမ်းလေးကို ပြန်စဉ်းစားကြည့်ပါဦးနော် ♡"}};

 function makeBinder(messages,selectId,titleKey){
   const KEY='olh_language',allowed=['my','zh','en'];
   const sel=document.getElementById(selectId),items=[],attrs=[];
   const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
   while(walker.nextNode()){
     const node=walker.currentNode,el=node.parentElement;
     if(!el||el.closest('script,style,select,option,textarea'))continue;
     const source=node.textContent.trim();
     if(!Object.prototype.hasOwnProperty.call(messages,source))continue;
     const text=node.textContent;
     items.push({node,left:(text.match(/^\s*/)||[''])[0],right:(text.match(/\s*$/)||[''])[0],source});
   }
   for(const el of document.querySelectorAll('[aria-label],[alt],[title]')){
     for(const name of ['aria-label','alt','title']){
       const source=el.getAttribute(name);
       if(source&&Object.prototype.hasOwnProperty.call(messages,source))attrs.push({el,name,source});
     }
   }
   let current='my';try{let s=localStorage.getItem(KEY);if(allowed.includes(s))current=s;}catch(_){}
   function apply(lang){
     if(!allowed.includes(lang))return;
     current=lang;document.documentElement.lang=lang==='zh'?'zh-CN':lang;
     if(sel)sel.value=lang;
     for(const item of items)if(item.node.isConnected)item.node.textContent=item.left+messages[item.source][lang]+item.right;
     for(const attr of attrs)if(attr.el.isConnected)attr.el.setAttribute(attr.name,messages[attr.source][lang]);
     if(titleKey&&messages[titleKey])document.title=messages[titleKey][lang];
     try{localStorage.setItem(KEY,lang)}catch(_){}
     document.dispatchEvent(new CustomEvent('olh:languagechange',{detail:{language:lang}}));
   }
   if(sel)sel.addEventListener('change',()=>apply(sel.value));
   window.addEventListener('storage',e=>{if(e.key===KEY&&allowed.includes(e.newValue))apply(e.newValue)});
   apply(current);
   return ()=>current;
 }

function init(){
  const current=makeBinder(TEXTS,'olhRootLanguage','Our Love Hub · 只属于我们的世界 ♡');
  window.OLHRootLanguage={error(type){const source=type==='empty'?'先选择我们在一起的日期哦 ♡':'好像不是那一天，再想想我们的故事 ♡';return TEXTS[source][current()]}};
  document.addEventListener('olh:languagechange',()=>{
    const error=document.getElementById('error');if(!error||!error.textContent)return;
    for(const src of ['先选择我们在一起的日期哦 ♡','好像不是那一天，再想想我们的故事 ♡']){
      if(Object.values(TEXTS[src]).includes(error.textContent)){error.textContent=TEXTS[src][current()];break}
    }
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
