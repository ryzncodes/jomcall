-- Allow locking a pending contact to return an explicit conflict; WITH CHECK still blocks all edits.
alter policy contact_update on app.contact using(org_id=nullif(current_setting('app.org_id',true),'')::uuid and app_private.active_role(org_id)is not null);
