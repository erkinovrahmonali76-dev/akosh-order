AKOSH ORDER - JOYLASH (Cloudflare)
1) Kompyuterda Node.js o'rnating. Papka ichida terminal oching:
   npm i -g wrangler
   wrangler login
2) Baza va fayl ombori:
   wrangler d1 create akosh-db        (chiqqan database_id ni wrangler.toml ga qo'ying)
   wrangler r2 bucket create akosh-files
3) Jadvallarni yaratish:
   wrangler d1 execute akosh-db --remote --file=schema.sql
4) Deploy:
   wrangler pages deploy public --project-name akosh-order
5) Admin bo'lish: sayt orqali ro'yxatdan o'ting, keyin:
   wrangler d1 execute akosh-db --remote --command "UPDATE users SET role='admin' WHERE email='SIZNING@EMAIL'"
   (Pages > Settings > Functions da D1 va R2 binding ham wrangler.toml orqali ulanadi)
