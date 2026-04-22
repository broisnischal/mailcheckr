# mailcheckr

## 0.2.0

### Minor Changes

- a0e36d1: release in npm

### Patch Changes

- 5f082e9: Adjust SMTP probe behavior so unverifiable SMTP results no longer mark addresses as invalid when MX/domain checks pass.

  Improve reliability by updating tests to use deterministic mocked SMTP outcomes and document the new behavior.
