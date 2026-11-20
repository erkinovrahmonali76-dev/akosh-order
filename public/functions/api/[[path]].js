const PLANS={start:{price:19000,max:20},pro:{price:39000,max:100},business:{price:69000,max:1000}};
const ST=['new','accepted','processing','delivered','cancelled'];
const enc=new TextEncoder();
const J=(d,s=200,h={})=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json',...h}});
const E=(m,s=400)=>J({error:m},s);
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const rnd=n=>hex(crypto.getRandomValues(new Uint8Array(n)));
const sha=async s=>hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));
async function pbk(pw,salt){const k=await crypto.subtle.importKey('raw',enc.encode(pw),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},k,256))}
const str=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max?v.trim():null;
const num=(v,min,max)=>{v=Number(v);return Number.isInteger(v)&&v>=min&&v<=max?v:null};
const active=u=>!!u.plan&&u.plan_until>Date.now();
const KEY=/^[a-f0-9]{24}\.(jpg|png|webp)$/;
async function limit(db,k,max,win){const now=Date.now();const r=await db.prepare('SELECT n,t FROM rl WHERE k=?').bind(k).first();if(!r||now-r.t>win){await db.prepare('INSERT OR REPLACE INTO rl VALUES(?,?,?)').bind(k,1,now).run();return true}if(r.n>=max)return false;await db.prepare('UPDATE rl SET n=n+1 WHERE k=?').bind(k).run();return true}
async function session(db,uid){const t=rnd(32);await db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await sha(t),uid,Date.now()+30*864e5).run();return{'set-cookie':`sid=${t}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`}}
async function getUser(db,req){const c=(req.headers.get('cookie')||'').match(/(?:^|; )sid=([a-f0-9]+)/);if(!c)return null;return await db.prepare('SELECT u.id,u.name,u.email,u.phone,u.role,u.plan,u.plan_until FROM sessions s JOIN users u ON u.id=s.uid WHERE s.h=? AND s.exp>? AND u.blocked=0').bind(await sha(c[1]),Date.now()).first()}

export async function onRequest({request,env}){
  const url=new URL(request.url),p=url.pathname.replace(/^\/api\//,'').split('/').filter(Boolean),m=request.method,db=env.DB;
  const ip=request.headers.get('cf-connecting-ip')||'x';
  try{
    if(m!=='GET'){const o=request.headers.get('origin');if(o&&o!==url.origin)return E('Ruxsat yo\'q',403)}
    const body=async()=>{try{return await request.json()}catch{return{}}};
    const [a,b,c]=p;
    if(a==='config')return J({card:env.CARD});
    if(a==='img'&&b&&KEY.test(b)){const o=await env.BUCKET.get(b);if(!o)return E('Topilmadi',404);return new Response(o.body,{headers:{'content-type':o.httpMetadata?.contentType||'image/jpeg','cache-control':'public,max-age=86400','x-content-type-options':'nosniff'}})}
    if(a==='register'&&m==='POST'){
      if(!await limit(db,'reg'+ip,10,36e5))return E('Juda ko\'p urinish',429);
      const d=await body(),name=str(d.name,2,60),email=str(d.email,5,100)?.toLowerCase(),phone=str(d.phone,9,16),pw=str(d.password,8,100);
      if(!name||!email||!/^\S+@\S+\.\S+$/.test(email)||!phone||!/^\+?\d{9,15}$/.test(phone)||!pw)return E('Ma\'lumotlar noto\'g\'ri (parol kamida 8 belgi)');
      const salt=rnd(16);
      try{const r=await db.prepare('INSERT INTO users(name,email,phone,pass,salt,created) VALUES(?,?,?,?,?,?)').bind(name,email,phone,await pbk(pw,salt),salt,Date.now()).run();return J({ok:1},200,await session(db,r.meta.last_row_id))}
      catch{return E('Bu email yoki telefon band')}
    }
    if(a==='login'&&m==='POST'){
      if(!await limit(db,'log'+ip,10,9e5))return E('Juda ko\'p urinish, 15 daqiqadan keyin urining',429);
      const d=await body(),l=str(d.login,3,100)?.toLowerCase(),pw=str(d.password,1,100);
      const u=l&&pw?await db.prepare('SELECT * FROM users WHERE email=? OR phone=?').bind(l,l).first():null;
      if(!u||u.blocked||await pbk(pw,u.salt)!==u.pass)return E('Login yoki parol xato',401);
      return J({ok:1},200,await session(db,u.id));
    }
    if(a==='logout'){const c=(request.headers.get('cookie')||'').match(/sid=([a-f0-9]+)/);if(c)await db.prepare('DELETE FROM sessions WHERE h=?').bind(await sha(c[1])).run();return J({ok:1},200,{'set-cookie':'sid=; Max-Age=0; Path=/'})}
    // PUBLIC STOREFRONT
    if(a==='s'&&b){
      const sh=await db.prepare('SELECT s.*,u.plan,u.plan_until FROM shops s JOIN users u ON u.id=s.uid WHERE s.slug=? AND u.blocked=0').bind(b).first();
      if(!sh)return E('Do\'kon topilmadi',404);
      if(c==='order'&&m==='POST'){
        if(!await limit(db,'ord'+ip,20,36e5))return E('Juda ko\'p urinish',429);
        if(!active(sh))return E('Do\'kon hozir buyurtma qabul qilmaydi',403);
        const d=await body(),name=str(d.name,2,60),phone=str(d.phone,7,20),address=str(d.address,3,200),note=str(d.note||'-',1,300)||'-';
        if(!name||!phone||!address||!Array.isArray(d.items)||!d.items.length||d.items.length>50)return E('Ma\'lumotlar to\'liq emas');
        let total=0;const items=[],st=[];
        for(const it of d.items){const q=num(it.qty,1,100),pr=await db.prepare('SELECT * FROM products WHERE id=? AND shop_id=? AND active=1').bind(Number(it.id),sh.id).first();
          if(!q||!pr)return E('Mahsulot topilmadi');if(pr.stock<q)return E(pr.name+': omborda yetarli emas');
          total+=pr.price*q;items.push({id:pr.id,name:pr.name,price:pr.price,qty:q});
          st.push(db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').bind(q,pr.id,q))}
        st.push(db.prepare('INSERT INTO orders(shop_id,name,phone,address,note,total,items,created) VALUES(?,?,?,?,?,?,?,?)').bind(sh.id,name,phone,address,note,total,JSON.stringify(items),Date.now()));
        await db.batch(st);return J({ok:1,total});
      }
      const pr=await db.prepare('SELECT id,name,description,price,category,stock,image FROM products WHERE shop_id=? AND active=1 AND stock>0 ORDER BY id DESC').bind(sh.id).all();
      return J({shop:{name:sh.name,description:sh.description,phone:sh.phone,telegram:sh.telegram,address:sh.address,logo:sh.logo,open:active(sh),badge:sh.plan!=='business'},products:pr.results});
    }
    const u=await getUser(db,request);
    if(a==='me')return u?J({user:u}):E('Kirmagan',401);
    if(!u)return E('Avval tizimga kiring',401);
    const shop=await db.prepare('SELECT * FROM shops WHERE uid=?').bind(u.id).first();
    if(a==='profile'&&m==='PUT'){const d=await body(),name=str(d.name,2,60);if(!name)return E('Ism noto\'g\'ri');let q='UPDATE users SET name=?';const v=[name];if(d.password){const pw=str(d.password,8,100);if(!pw)return E('Parol kamida 8 belgi');const s=rnd(16);q+=',pass=?,salt=?';v.push(await pbk(pw,s),s)}await db.prepare(q+' WHERE id=?').bind(...v,u.id).run();return J({ok:1})}
    if(a==='upload'&&m==='POST'){
      if(!await limit(db,'up'+u.id,40,36e5))return E('Juda ko\'p yuklash',429);
      const f=(await request.formData()).get('file');
      const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[f?.type];
      if(!ext||f.size>1500000)return E('Faqat JPG/PNG/WEBP, 1.5MB gacha');
      const key=rnd(12)+'.'+ext;await env.BUCKET.put(key,f.stream(),{httpMetadata:{contentType:f.type}});return J({key});
    }
    if(a==='shop'){
      if(m==='GET')return J({shop});
      if(m==='PUT'){const d=await body(),name=str(d.name,2,60);if(!name)return E('Do\'kon nomi kerak');
        const f=[name,str(d.description||'',0,500)??'',str(d.phone||'',0,20)??'',str(d.telegram||'',0,50)??'',str(d.address||'',0,200)??'',d.logo&&KEY.test(d.logo)?d.logo:(shop?.logo||'')];
        if(shop)await db.prepare('UPDATE shops SET name=?,description=?,phone=?,telegram=?,address=?,logo=? WHERE id=?').bind(...f,shop.id).run();
        else{const slug=(name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'shop')+'-'+rnd(2);await db.prepare('INSERT INTO shops(uid,slug,name,description,phone,telegram,address,logo) VALUES(?,?,?,?,?,?,?,?)').bind(u.id,slug,...f).run()}
        return J({shop:await db.prepare('SELECT * FROM shops WHERE uid=?').bind(u.id).first()});}
    }
    if(a==='pay'){
      if(m==='GET'){return J({payments:(await db.prepare('SELECT * FROM payments WHERE uid=? ORDER BY id DESC').bind(u.id).all()).results})}
      const d=await body();if(!PLANS[d.plan]||!KEY.test(d.receipt||''))return E('Tarif va chek rasmi kerak');
      const n=await db.prepare("SELECT COUNT(*) n FROM payments WHERE uid=? AND status='pending'").bind(u.id).first();if(n.n>=3)return E('Kutilayotgan to\'lovlar ko\'p');
      await db.prepare('INSERT INTO payments(uid,plan,amount,receipt,created) VALUES(?,?,?,?,?)').bind(u.id,d.plan,PLANS[d.plan].price,d.receipt,Date.now()).run();return J({ok:1});
    }
    if(u.role==='admin'&&a==='admin'){
      if(b==='stats'){const q=async s=>(await db.prepare(s).first()).n;return J({users:await q('SELECT COUNT(*) n FROM users'),shops:await q('SELECT COUNT(*) n FROM shops'),orders:await q('SELECT COUNT(*) n FROM orders'),pending:await q("SELECT COUNT(*) n FROM payments WHERE status='pending'"),revenue:await q("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE status='approved'")})}
      if(b==='users'&&!c)return J({users:(await db.prepare('SELECT u.id,u.name,u.email,u.phone,u.role,u.blocked,u.plan,u.plan_until,s.slug FROM users u LEFT JOIN shops s ON s.uid=u.id ORDER BY u.id DESC LIMIT 200').all()).results});
      if(b==='users'&&c&&m==='POST'){const d=await body(),id=Number(c);
        if(d.password){const pw=str(d.password,8,100);if(!pw)return E('Parol kamida 8 belgi');const s=rnd(16);await db.prepare('UPDATE users SET pass=?,salt=? WHERE id=?').bind(await pbk(pw,s),s,id).run();await db.prepare('DELETE FROM sessions WHERE uid=?').bind(id).run()}
        if(d.blocked!==undefined&&id!==u.id){await db.prepare('UPDATE users SET blocked=? WHERE id=?').bind(d.blocked?1:0,id).run();if(d.blocked)await db.prepare('DELETE FROM sessions WHERE uid=?').bind(id).run()}
        if(PLANS[d.plan])await db.prepare('UPDATE users SET plan=?,plan_until=? WHERE id=?').bind(d.plan,Date.now()+30*864e5,id).run();
        return J({ok:1})}
      if(b==='payments'&&!c)return J({payments:(await db.prepare('SELECT p.*,u.name,u.phone FROM payments p JOIN users u ON u.id=p.uid ORDER BY p.id DESC LIMIT 200').all()).results});
      if(b==='payments'&&c&&m==='POST'){const d=await body(),p=await db.prepare("SELECT * FROM payments WHERE id=? AND status='pending'").bind(Number(c)).first();if(!p)return E('Topilmadi');
        if(d.action==='approve'){const us=await db.prepare('SELECT plan,plan_until FROM users WHERE id=?').bind(p.uid).first();const base=us.plan===p.plan&&us.plan_until>Date.now()?us.plan_until:Date.now();
          await db.batch([db.prepare("UPDATE payments SET status='approved' WHERE id=?").bind(p.id),db.prepare('UPDATE users SET plan=?,plan_until=? WHERE id=?').bind(p.plan,base+30*864e5,p.uid)])}
        else await db.prepare("UPDATE payments SET status='rejected' WHERE id=?").bind(p.id).run();
        return J({ok:1})}
    }
    if(!shop&&['products','orders','stats'].includes(a))return E('Avval do\'kon yarating',400);
    if(a==='products'){
      if(m==='GET')return J({products:(await db.prepare('SELECT * FROM products WHERE shop_id=? ORDER BY id DESC').bind(shop.id).all()).results,max:active(u)?PLANS[u.plan].max:0});
      if(m==='POST'||m==='PUT'){
        const d=await body(),name=str(d.name,2,100),price=num(d.price,0,1e9),stock=num(d.stock,0,1e6);
        if(!name||price===null||stock===null)return E('Nom, narx va miqdor to\'g\'ri emas');
        const f=[name,str(d.description||'',0,1000)??'',price,str(d.category||'',0,40)??'',stock,d.image&&KEY.test(d.image)?d.image:'',d.active===0?0:1];
        if(m==='POST'){if(!active(u))return E('Mahsulot qo\'shish uchun tarif tanlang',403);
          const n=await db.prepare('SELECT COUNT(*) n FROM products WHERE shop_id=?').bind(shop.id).first();if(n.n>=PLANS[u.plan].max)return E(`Tarifingiz limiti: ${PLANS[u.plan].max} ta mahsulot. Tarifni yangilang`,403);
          await db.prepare('INSERT INTO products(shop_id,name,description,price,category,stock,image,active,created) VALUES(?,?,?,?,?,?,?,?,?)').bind(shop.id,...f,Date.now()).run()}
        else await db.prepare('UPDATE products SET name=?,description=?,price=?,category=?,stock=?,image=?,active=? WHERE id=? AND shop_id=?').bind(...f,Number(b),shop.id).run();
        return J({ok:1})}
      if(m==='DELETE'){await db.prepare('DELETE FROM products WHERE id=? AND shop_id=?').bind(Number(b),shop.id).run();return J({ok:1})}
    }
    if(a==='orders'){
      if(m==='GET')return J({orders:(await db.prepare('SELECT * FROM orders WHERE shop_id=? ORDER BY id DESC LIMIT 300').bind(shop.id).all()).results});
      if(m==='PUT'){const d=await body();if(!ST.includes(d.status))return E('Status xato');await db.prepare('UPDATE orders SET status=? WHERE id=? AND shop_id=?').bind(d.status,Number(b),shop.id).run();return J({ok:1})}
    }
    if(a==='stats'){
      const o=(await db.prepare('SELECT total,status,phone,created FROM orders WHERE shop_id=?').bind(shop.id).all()).results;
      const pc=await db.prepare('SELECT COUNT(*) n FROM products WHERE shop_id=?').bind(shop.id).first();
      const day=new Date().setHours(0,0,0,0),days=[];
      for(let i=6;i>=0;i--){const s=day-i*864e5;days.push({d:new Date(s).toISOString().slice(5,10),n:o.filter(x=>x.created>=s&&x.created<s+864e5).length})}
      const last=(await db.prepare('SELECT id,name,total,status FROM orders WHERE shop_id=? ORDER BY id DESC LIMIT 5').bind(shop.id).all()).results;
      return J({today:o.filter(x=>x.created>=day).length,total:o.length,revenue:o.filter(x=>x.status==='delivered').reduce((s,x)=>s+x.total,0),products:pc.n,customers:new Set(o.map(x=>x.phone)).size,chart:active(u)&&u.plan!=='start'?days:null,last});
    }
    return E('Topilmadi',404);
  }catch(e){return E('Server xatosi',500)}
}
