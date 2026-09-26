-- Extend the existing deal diff only. Owner, ACL, trigger and event vocabulary stay unchanged.
CREATE OR REPLACE FUNCTION nora_private.audit_deal_changes(
    p_old public.deals,
    p_new public.deals
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    v jsonb := '{}'::jsonb;
    part jsonb;
BEGIN
    part := nora_private.audit_json_field(to_jsonb(p_old.name), to_jsonb(p_new.name), 'name');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('name', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.company_id), to_jsonb(p_new.company_id), 'company_id');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('company_id', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.contact_ids), to_jsonb(p_new.contact_ids), 'contact_ids');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('contact_ids', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.stage), to_jsonb(p_new.stage), 'stage');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('stage', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.category), to_jsonb(p_new.category), 'category');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('category', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.amount), to_jsonb(p_new.amount), 'amount');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('amount', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.expected_closing_date), to_jsonb(p_new.expected_closing_date), 'expected_closing_date');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('expected_closing_date', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.sales_id), to_jsonb(p_new.sales_id), 'sales_id');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('sales_id', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.archived_at), to_jsonb(p_new.archived_at), 'archived_at');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('archived_at', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.description), to_jsonb(p_new.description), 'description');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('description', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.site_street), to_jsonb(p_new.site_street), 'site_street');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('site_street', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.site_city), to_jsonb(p_new.site_city), 'site_city');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('site_city', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.site_floor), to_jsonb(p_new.site_floor), 'site_floor');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('site_floor', part); END IF;
    part := nora_private.audit_json_field(to_jsonb(p_old.site_tenant_name), to_jsonb(p_new.site_tenant_name), 'site_tenant_name');
    IF part IS NOT NULL THEN v := v || jsonb_build_object('site_tenant_name', part); END IF;
    RETURN v;
END;
$$;
