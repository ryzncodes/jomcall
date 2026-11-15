// SQL fragments the inbox reads to predict a send. They must match the text
// the agent process uses in send_claim (migration
// 20261114120100_whatsapp_worker.sql); a guard test in
// tests/local/whatsapp-inbox.test.mjs fails when the two drift. Aliases: c is
// the conversation, k the contact.

// Latest recorded answer per purpose on the WhatsApp channel.
export const consentServiceSql = `(select g.granted from app.consent_record g where g.org_id=c.org_id and g.contact_id=c.contact_id and g.channel='whatsapp' and g.purpose='service' order by g.created_at desc,g.id desc limit 1)`;
export const consentMarketingSql = `(select g.granted from app.consent_record g where g.org_id=c.org_id and g.contact_id=c.contact_id and g.channel='whatsapp' and g.purpose='marketing' order by g.created_at desc,g.id desc limit 1)`;
// The approved template that asks the customer to reply.
export const fallbackSql = `(select jsonb_build_object('id',f.id,'name',f.name,'language',f.language,'category',f.category,'status',f.status,'variables',f.variables)from app.whatsapp_template f
    where f.org_id=c.org_id and f.channel_id=c.channel_id and f.purpose='reengage' and f.status='approved' and f.category='utility' and f.variables=0
    order by(f.language like coalesce(k.preferred_language,'ms')||'%')desc,f.created_at,f.id limit 1)`;
