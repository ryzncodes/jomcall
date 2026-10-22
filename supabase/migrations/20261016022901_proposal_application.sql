-- Contact erasure cascades through both sessions/proposals and bookings in one transaction.
-- Validate this link at commit so cascade trigger order cannot block erasure.
alter table app.test_proposal alter constraint test_proposal_org_id_applied_booking_id_fkey deferrable initially deferred;
create unique index one_proposal_per_booking on app.test_proposal(org_id,applied_booking_id)where applied_booking_id is not null;
