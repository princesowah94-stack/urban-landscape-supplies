-- Test invoices were generated during development; restart numbering so the
-- client's first real invoice is INV-0001. Safe on fresh clones (already at 1).
select setval('public.invoice_number_seq', 1, false);
