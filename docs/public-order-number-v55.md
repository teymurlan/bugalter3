# Public order number v55

- Technical `order_number` stays unchanged and continues to be used for API callbacks and internal relations.
- Every real order receives a server-owned numeric `public_order_number`.
- `display_number` mirrors the same value for existing client views.
- Visible formatting is `#001`, `#023`, `#105`.
- Existing real orders without a public number are backfilled by `created_at` order.
- Test orders do not consume the real-order sequence.
- Client, admin and HOUSE CLEANING STAFF load the same visible-number bridge.
