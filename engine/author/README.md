# engine/author — WP-08 authoring verification

Deterministic citation checking (AD-1) with a .docx round-trip (AD-2). The
full contract — grammar, verdict rules, limits — is documented in
`docs/AUTHORING.md`. No network, no model, no wall clock in this directory:
the `r10-author-deterministic` gate fails CI on any of them.
